'use strict';

/**
 * Computer vision back end for Module 5.
 *
 * ---------------------------------------------------------------------------
 * This is real inference. Two independent kinds of evidence are extracted
 * from the actual pixels of the submitted image:
 *
 *   1. A trained convolutional network — MobileNetV2 (width 1.0, 224×224),
 *      the ImageNet checkpoint published by Google, run through TensorFlow.js.
 *      It produces a genuine 1000-way probability distribution over the
 *      ImageNet-1k vocabulary.
 *
 *   2. Colour and texture statistics computed over every pixel — vegetation
 *      indices, HSV occupancy fractions, flame chromaticity, hue entropy.
 *      These are the classical descriptors used in plant phenotyping and in
 *      rule-based fire detection.
 *
 * Neither is a stand-in. Change the image and both change. `ai-inference`
 * maps them onto the task vocabularies.
 *
 * ---------------------------------------------------------------------------
 * Runtime
 * ---------------------------------------------------------------------------
 * TensorFlow.js runs on its WebAssembly backend: ~30–80 ms per image on a
 * laptop CPU, against ~2 s for the pure-JavaScript backend, with bit-identical
 * output and no native compilation step. If WebAssembly cannot initialise the
 * service falls back to the JavaScript backend and says so in the log.
 *
 * The checkpoint (~14 MB) is fetched once from TensorFlow Hub and cached under
 * `backend/.cache/mobilenet-v2/`. Every later start loads it from disk with no
 * network at all. `warmUp()` does this in the background at boot so the first
 * real request does not pay for it.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const dns = require('dns').promises;
const net = require('net');
const path = require('path');
const tf = require('@tensorflow/tfjs');
const { IMAGENET_CLASSES } = require('@tensorflow-models/mobilenet/dist/imagenet_classes');
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');

const logger = require('../utils/logger');
const ApiError = require('../utils/ApiError');

/** TF Hub checkpoint. `?tfjs-format=file` returns the raw artefacts. */
const MODEL_BASE = 'https://tfhub.dev/google/imagenet/mobilenet_v2_100_224/classification/2';
const CACHE_DIR = path.resolve(__dirname, '../../.cache/mobilenet-v2');

/** Recorded on every detection so a result stays traceable to its weights. */
const MODEL_CARD = {
  name: 'MobileNetV2 1.0 (ImageNet-1k)',
  version: 'tfhub:imagenet/mobilenet_v2_100_224/classification/2',
  inputSize: 224,
  source: 'Google, via TensorFlow Hub',
};

const INPUT_SIZE = 224;
/** Largest image accepted, to bound memory and time. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 3;
/** Pixels are sampled on a stride so statistics cost is bounded on huge photos. */
const MAX_STAT_SAMPLES = 240_000;
/** Longest side of the copy that is stored and served back to the browser. */
const STORED_MAX_SIDE = 640;

// ---------------------------------------------------------------------------
// Backend selection and model loading
// ---------------------------------------------------------------------------

let backendPromise = null;

/** Prefer WebAssembly; fall back to the JavaScript CPU backend. */
function initBackend() {
  if (backendPromise) return backendPromise;

  backendPromise = (async () => {
    try {
      require('@tensorflow/tfjs-backend-wasm');
      if (await tf.setBackend('wasm')) {
        await tf.ready();
        return tf.getBackend();
      }
    } catch (err) {
      logger.warn(`TensorFlow.js WebAssembly backend unavailable (${err.message}); using the slower CPU backend.`);
    }
    await tf.setBackend('cpu');
    await tf.ready();
    return tf.getBackend();
  })();

  return backendPromise;
}

let modelPromise = null;
let modelStatus = { state: 'idle', loadedAt: null, source: null, error: null };

/** Download `model.json` and every weight shard into the cache directory. */
async function downloadCheckpoint() {
  await fsp.mkdir(CACHE_DIR, { recursive: true });

  const res = await fetch(`${MODEL_BASE}/model.json?tfjs-format=file`);
  if (!res.ok) throw new Error(`model.json responded ${res.status}`);
  const modelJson = await res.json();

  const shards = modelJson.weightsManifest.flatMap((group) => group.paths);
  for (const shard of shards) {
    const shardRes = await fetch(`${MODEL_BASE}/${shard}?tfjs-format=file`);
    if (!shardRes.ok) throw new Error(`${shard} responded ${shardRes.status}`);
    await fsp.writeFile(path.join(CACHE_DIR, shard), Buffer.from(await shardRes.arrayBuffer()));
  }

  // Written last, so an interrupted download is never mistaken for a cache hit.
  await fsp.writeFile(path.join(CACHE_DIR, 'model.json'), JSON.stringify(modelJson));
  logger.info(`Vision model cached (${shards.length} shards) → ${CACHE_DIR}`);
}

/**
 * An `io.IOHandler` that reads the cached graph model off disk.
 * TensorFlow.js ships filesystem handlers only in `tfjs-node`, which needs a
 * native build; this is the small piece of it we actually need.
 */
function diskHandler(dir) {
  return {
    load: async () => {
      const modelJson = JSON.parse(await fsp.readFile(path.join(dir, 'model.json'), 'utf8'));

      const weightSpecs = [];
      const buffers = [];
      for (const group of modelJson.weightsManifest) {
        weightSpecs.push(...group.weights);
        for (const shard of group.paths) {
          buffers.push(await fsp.readFile(path.join(dir, shard)));
        }
      }

      const merged = new Uint8Array(buffers.reduce((n, b) => n + b.length, 0));
      let offset = 0;
      for (const b of buffers) {
        merged.set(new Uint8Array(b), offset);
        offset += b.length;
      }

      return { modelTopology: modelJson.modelTopology, weightSpecs, weightData: merged.buffer };
    },
  };
}

const isCached = () => fs.existsSync(path.join(CACHE_DIR, 'model.json'));

/**
 * Load the classifier once per process. Concurrent callers share the promise.
 * @returns {Promise<import('@tensorflow/tfjs').GraphModel>}
 */
function loadModel() {
  if (modelPromise) return modelPromise;

  modelPromise = (async () => {
    const startedAt = Date.now();
    modelStatus = { ...modelStatus, state: 'loading', error: null };

    try {
      await initBackend();

      const cached = isCached();
      if (!cached) {
        logger.info('Vision model not cached — downloading MobileNetV2 (~14 MB, once)…');
        await downloadCheckpoint();
      }

      const model = await tf.loadGraphModel(diskHandler(CACHE_DIR));

      modelStatus = {
        state: 'ready',
        loadedAt: new Date().toISOString(),
        source: cached ? 'disk cache' : 'downloaded from TensorFlow Hub',
        error: null,
      };
      logger.success(
        `Vision model ready in ${Date.now() - startedAt} ms (${modelStatus.source}, backend: ${tf.getBackend()})`
      );
      return model;
    } catch (err) {
      modelStatus = { state: 'failed', loadedAt: null, source: null, error: err.message };
      modelPromise = null; // allow a later retry
      throw err;
    }
  })();

  return modelPromise;
}

/** Kick the model load off in the background; never rejects into the caller. */
function warmUp() {
  loadModel().catch((err) => {
    logger.warn(`Vision model could not be preloaded: ${err.message}`);
    logger.warn('Image analysis will retry on the first request.');
  });
}

const modelState = () => ({ ...modelStatus, cached: isCached(), backend: tf.getBackend() || null, card: MODEL_CARD });

// ---------------------------------------------------------------------------
// Image input — uploads (data URLs) and remote URLs
// ---------------------------------------------------------------------------

/**
 * True for addresses a server-side fetch must never reach: loopback, private
 * ranges, link-local (cloud metadata lives at 169.254.169.254), CGNAT,
 * multicast and unspecified.
 */
function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  const lower = address.toLowerCase();
  if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice(7));
  return (
    lower === '::' || lower === '::1' ||
    lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80') ||
    lower.startsWith('ff')
  );
}

/** Reject URLs whose host resolves to an internal address. */
async function assertPublicUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw ApiError.badRequest('`imageUrl` is not a valid URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw ApiError.badRequest('`imageUrl` must be an http(s) URL or an uploaded image');
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  let addresses;
  try {
    addresses = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  } catch {
    throw ApiError.badRequest(`The image host '${host}' could not be resolved`);
  }
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw ApiError.badRequest('Images can only be fetched from public internet addresses');
  }
  return parsed;
}

/**
 * Pull an image over HTTP with a timeout, a size ceiling and redirect
 * re-validation (a public URL must not be allowed to redirect inwards).
 * @returns {Promise<Buffer>}
 */
async function fetchImage(url) {
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicUrl(current);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(current, {
        signal: controller.signal,
        redirect: 'manual',
        headers: { 'User-Agent': 'GreenPulse/1.0 (urban ecology monitoring; academic project)' },
      });

      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        current = new URL(res.headers.get('location'), current).toString();
        continue;
      }
      if (!res.ok) {
        throw ApiError.badRequest(`The image URL responded ${res.status} ${res.statusText}`);
      }
      if (Number(res.headers.get('content-length') || 0) > MAX_IMAGE_BYTES) {
        throw ApiError.badRequest(`The image is larger than the ${MAX_IMAGE_BYTES / 1024 / 1024} MB limit`);
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length > MAX_IMAGE_BYTES) {
        throw ApiError.badRequest(`The image is larger than the ${MAX_IMAGE_BYTES / 1024 / 1024} MB limit`);
      }
      if (buffer.length === 0) throw ApiError.badRequest('The image URL returned an empty body');
      return buffer;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw ApiError.badRequest(
        err.name === 'AbortError'
          ? `The image could not be downloaded within ${FETCH_TIMEOUT_MS / 1000} seconds`
          : `The image could not be downloaded: ${err.message}`
      );
    } finally {
      clearTimeout(timer);
    }
  }

  throw ApiError.badRequest(`The image URL redirected more than ${MAX_REDIRECTS} times`);
}

/** Decode a `data:image/…;base64,…` URL. */
function decodeDataUrl(dataUrl) {
  const match = /^data:image\/[a-z0-9.+-]+;base64,([a-z0-9+/=\s]+)$/i.exec(dataUrl);
  if (!match) throw ApiError.badRequest('The uploaded image is not a valid base64 data URL');
  const buffer = Buffer.from(match[1], 'base64');
  if (buffer.length === 0) throw ApiError.badRequest('The uploaded image is empty');
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw ApiError.badRequest(`The image is larger than the ${MAX_IMAGE_BYTES / 1024 / 1024} MB limit`);
  }
  return buffer;
}

/** Resolve an image reference — upload or URL — to raw bytes. */
async function loadImageBytes(input) {
  if (typeof input !== 'string' || !input.trim()) throw ApiError.badRequest('An image is required');
  const trimmed = input.trim();
  return trimmed.startsWith('data:') ? decodeDataUrl(trimmed) : fetchImage(trimmed);
}

/**
 * Decode JPEG or PNG into tightly packed RGB bytes.
 * Format is detected from the magic number, not the URL extension or the
 * declared content type — both lie often enough to matter.
 *
 * @returns {{data: Uint8Array, width: number, height: number, format: string}}
 */
function decodeImage(buffer) {
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8;
  const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;

  if (!isJpeg && !isPng) {
    const head = buffer.slice(0, 64).toString('utf8').trim();
    throw ApiError.badRequest(
      `Only JPEG and PNG images can be analysed${head.startsWith('<') ? ' (that URL returned a web page)' : ''}`
    );
  }

  try {
    if (isJpeg) {
      const raw = jpeg.decode(buffer, { useTArray: true, formatAsRGBA: false, maxMemoryUsageInMB: 512 });
      return { data: raw.data, width: raw.width, height: raw.height, format: 'jpeg' };
    }

    const png = PNG.sync.read(buffer); // RGBA
    const rgb = new Uint8Array((png.data.length / 4) * 3);
    for (let i = 0, j = 0; i < png.data.length; i += 4, j += 3) {
      rgb[j] = png.data[i];
      rgb[j + 1] = png.data[i + 1];
      rgb[j + 2] = png.data[i + 2];
    }
    return { data: rgb, width: png.width, height: png.height, format: 'png' };
  } catch (err) {
    throw ApiError.badRequest(`The image could not be decoded: ${err.message}`);
  }
}

/**
 * Bilinear resample of packed RGB so the longest side is at most `maxSide`.
 * Returns the input untouched when it is already small enough.
 */
function resizeRgb({ data, width, height }, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  if (scale === 1) return { data, width, height };

  const outW = Math.max(1, Math.round(width * scale));
  const outH = Math.max(1, Math.round(height * scale));
  const out = new Uint8Array(outW * outH * 3);
  const xRatio = (width - 1) / Math.max(1, outW - 1);
  const yRatio = (height - 1) / Math.max(1, outH - 1);

  for (let y = 0; y < outH; y += 1) {
    const sy = y * yRatio;
    const y0 = Math.floor(sy);
    const y1 = Math.min(height - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < outW; x += 1) {
      const sx = x * xRatio;
      const x0 = Math.floor(sx);
      const x1 = Math.min(width - 1, x0 + 1);
      const fx = sx - x0;
      for (let c = 0; c < 3; c += 1) {
        const tl = data[(y0 * width + x0) * 3 + c];
        const tr = data[(y0 * width + x1) * 3 + c];
        const bl = data[(y1 * width + x0) * 3 + c];
        const br = data[(y1 * width + x1) * 3 + c];
        const top = tl + (tr - tl) * fx;
        const bottom = bl + (br - bl) * fx;
        out[(y * outW + x) * 3 + c] = Math.round(top + (bottom - top) * fy);
      }
    }
  }

  return { data: out, width: outW, height: outH };
}

/** Encode packed RGB as a baseline JPEG. */
function encodeJpeg({ data, width, height }, quality = 82) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
    rgba[j] = data[i];
    rgba[j + 1] = data[i + 1];
    rgba[j + 2] = data[i + 2];
    rgba[j + 3] = 255;
  }
  return jpeg.encode({ data: rgba, width, height }, quality).data;
}

// ---------------------------------------------------------------------------
// Colour and texture descriptors
// ---------------------------------------------------------------------------

/** RGB (0–255) → HSV with H in degrees, S and V in [0, 1]. */
function rgbToHsv(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  return [h, max === 0 ? 0 : delta / max, max];
}

/**
 * Per-pixel statistics over the whole frame.
 *
 * Vegetation indices
 *   ExG = 2g − r − b on chromatic coordinates (Woebbecke et al. 1995)
 *   GLI = (2G − R − B) / (2G + R + B)  (Louhaichi et al. 2001)
 * Both rise with green biomass and are the standard cheap proxies for canopy
 * vigour in RGB-only plant phenotyping.
 *
 * Foliage states are disjoint HSV bands — green (healthy), yellow (chlorotic)
 * and brown (necrotic) — so their fractions can be compared directly.
 *
 * Flame chromaticity follows the rule set of Chen, Wu & Chiou (2004):
 * R > G > B with R above a floor, and saturation increasing as R saturates.
 * It is deliberately permissive — orange plumage and sunsets pass it. A
 * stricter variant (bright, saturated, hue ≤ 50°) is reported alongside it,
 * and `ai-inference` uses only that one, and only scaled by the CNN's own
 * fire evidence.
 */
function describePixels(data, width, height) {
  const totalPixels = width * height;
  const stride = Math.max(1, Math.floor(totalPixels / MAX_STAT_SAMPLES));

  let sampled = 0;
  let exgSum = 0;
  let gliSum = 0;
  let valueSum = 0;
  let satSum = 0;
  let healthyGreen = 0;
  let chlorotic = 0;
  let necrotic = 0;
  let flame = 0;
  let strictFlame = 0;
  let smoke = 0;
  let sky = 0;
  const hueHistogram = new Array(36).fill(0);

  for (let i = 0; i < totalPixels; i += stride) {
    const o = i * 3;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    if (r === undefined) break;

    sampled += 1;

    const sum = r + g + b || 1;
    exgSum += (2 * g - r - b) / sum;
    gliSum += (2 * g - r - b) / (2 * g + r + b || 1);

    const [h, s, v] = rgbToHsv(r, g, b);
    valueSum += v;
    satSum += s;
    hueHistogram[Math.min(35, Math.floor(h / 10))] += 1;

    if (h >= 70 && h <= 165 && s >= 0.18 && v >= 0.12) healthyGreen += 1;
    else if (h >= 38 && h < 70 && s >= 0.3 && v >= 0.3) chlorotic += 1;
    else if (h >= 10 && h < 38 && s >= 0.2 && v < 0.55) necrotic += 1;

    if (r > 150 && r > g && g > b && s >= ((255 - r) * 0.2) / 255) flame += 1;
    if (r > 190 && r >= g && g >= b && h <= 50 && s > 0.45 && v > 0.7) strictFlame += 1;
    if (s < 0.12 && v > 0.35 && v < 0.88) smoke += 1;
    if (h >= 185 && h <= 250 && s >= 0.15 && v >= 0.45) sky += 1;
  }

  const fraction = (count) => Math.round((count / sampled) * 10000) / 10000;
  const round = (x) => Math.round(x * 1000) / 1000;

  // Shannon entropy over the 36-bin hue histogram. Foliage and sky are
  // chromatically narrow; scattered litter is not.
  let hueEntropy = 0;
  for (const count of hueHistogram) {
    if (count > 0) {
      const p = count / sampled;
      hueEntropy -= p * Math.log2(p);
    }
  }

  return {
    excessGreen: round(exgSum / sampled),
    greenLeafIndex: round(gliSum / sampled),
    healthyGreenFraction: fraction(healthyGreen),
    chloroticFraction: fraction(chlorotic),
    necroticFraction: fraction(necrotic),
    flameFraction: fraction(flame),
    strictFlameFraction: fraction(strictFlame),
    smokeFraction: fraction(smoke),
    skyFraction: fraction(sky),
    meanValue: round(valueSum / sampled),
    meanSaturation: round(satSum / sampled),
    hueEntropy: round(hueEntropy),
    sampledPixels: sampled,
  };
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/** Numerically stable softmax over a Float32Array of logits. */
function softmaxOf(logits) {
  let max = -Infinity;
  for (const z of logits) if (z > max) max = z;

  const exps = new Float64Array(logits.length);
  let sum = 0;
  for (let i = 0; i < logits.length; i += 1) {
    const e = Math.exp(logits[i] - max);
    exps[i] = e;
    sum += e;
  }
  for (let i = 0; i < exps.length; i += 1) exps[i] /= sum;
  return exps;
}

/**
 * Run MobileNetV2 over decoded pixels.
 * @returns {Promise<Float64Array>} 1000 ImageNet probabilities, index-aligned with IMAGENET_CLASSES
 */
async function classify(model, decoded) {
  const { data, width, height } = decoded;

  const output = tf.tidy(() => {
    const pixels = tf.tensor3d(data, [height, width, 3], 'int32');
    // MobileNetV2 on TF Hub expects float input scaled to [0, 1].
    const batch = tf.image.resizeBilinear(pixels, [INPUT_SIZE, INPUT_SIZE]).toFloat().div(255).expandDims(0);
    return model.predict(batch);
  });

  const logits = await output.data();
  output.dispose();

  // The TF Hub classification head emits 1001 units: index 0 is the
  // "background" class that ImageNet-1k does not have.
  const probs = softmaxOf(logits);
  return logits.length === 1001 ? probs.subarray(1) : probs;
}

/** The `k` most probable ImageNet classes, descending. */
function topClasses(probs, k = 10) {
  const indices = Array.from(probs.keys()).sort((a, b) => probs[b] - probs[a]).slice(0, k);
  return indices.map((index) => ({
    index,
    label: IMAGENET_CLASSES[index],
    probability: Math.round(probs[index] * 100000) / 100000,
  }));
}

/**
 * Full analysis of one image: load, decode, CNN, pixel statistics, and a
 * downscaled JPEG copy suitable for storage.
 *
 * @param {string} input An http(s) URL or a `data:image/…;base64,…` upload
 */
async function describeImage(input) {
  const loadedAt = Date.now();
  const buffer = await loadImageBytes(input);
  const fetchMs = Date.now() - loadedAt;
  return describeBuffer(buffer, { fetchMs });
}

/** As `describeImage`, for bytes already in memory (seed data, tests). */
async function describeBuffer(buffer, { fetchMs = 0 } = {}) {
  const decodedAt = Date.now();
  const decoded = decodeImage(buffer);
  const decodeMs = Date.now() - decodedAt;

  if (decoded.width < 16 || decoded.height < 16) {
    throw ApiError.badRequest('The image is too small to analyse (minimum 16×16)');
  }

  const statsAt = Date.now();
  const stats = describePixels(decoded.data, decoded.width, decoded.height);
  const statsMs = Date.now() - statsAt;

  let model;
  try {
    model = await loadModel();
  } catch (err) {
    throw new ApiError(
      503,
      'The image classifier is unavailable. It downloads once (~14 MB) and is then cached; ' +
        `check the server's network access and try again. (${err.message})`
    );
  }

  const inferAt = Date.now();
  const probabilities = await classify(model, decoded);
  const inferenceMs = Date.now() - inferAt;

  const stored = resizeRgb(decoded, STORED_MAX_SIDE);

  return {
    probabilities,
    imagenet: topClasses(probabilities),
    stats,
    image: { width: decoded.width, height: decoded.height, format: decoded.format, bytes: buffer.length },
    stored: { buffer: encodeJpeg(stored), width: stored.width, height: stored.height },
    model: { ...MODEL_CARD, backend: tf.getBackend() },
    timings: { fetchMs, decodeMs, statsMs, inferenceMs },
  };
}

module.exports = {
  describeImage,
  describeBuffer,
  loadModel,
  warmUp,
  modelState,
  MODEL_CARD,
  // exported for tests and the sample-image script
  isPrivateAddress,
  assertPublicUrl,
  decodeDataUrl,
  decodeImage,
  resizeRgb,
  encodeJpeg,
  rgbToHsv,
  describePixels,
  softmaxOf,
  topClasses,
  INPUT_SIZE,
};

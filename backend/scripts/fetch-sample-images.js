'use strict';

/**
 * Download the labelled wildlife photographs used by the AI module.
 *
 * Every image is a freely licensed file on Wikimedia Commons. Each is stored
 * as a ≤640 px JPEG, and its author, licence and source page are recorded in
 * `attribution.json`, which the API serves alongside the image.
 *
 * `expected` is the label a correct classifier should give for `task`. The
 * same set drives the seeded detections (`use: 'seed'`) and the accuracy
 * report in `scripts/evaluate-vision.js`.
 *
 * The images are committed, so this only needs re-running to change the set:
 *
 *   npm run data:images
 */

const fs = require('fs/promises');
const path = require('path');
const { decodeImage, resizeRgb, encodeJpeg } = require('../src/services/vision.service');

const OUT_DIR = path.resolve(__dirname, '../src/seed/data/sample-images');
const API = 'https://commons.wikimedia.org/w/api.php';
const USER_AGENT = 'ParkEcosystemPortal/1.0 (academic park-ecology project; https://github.com/Dakshata-R/Public-Park-Ecosystem)';
const MAX_SIDE = 640;

const SAMPLES = [
  { file: 'wildlife-indian-pond-heron.jpg', use: 'seed', task: 'wildlife', expected: ['Bird'], title: 'File:Indian pond heron (Ardeola grayii) India.jpg' },
  { file: 'wildlife-green-bee-eater.jpg', use: 'seed', task: 'wildlife', expected: ['Bird'], title: 'File:007 Asian green bee-eater in Jim Corbett National Park Photo by Giles Laurent.jpg' },
  { file: 'wildlife-plain-tiger.jpg', use: 'seed', task: 'wildlife', expected: ['Butterfly or moth'], title: 'File:Danaus chrysippus Female by kadavoor.jpg' },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Strip the HTML Commons embeds in `Artist` so the credit reads as plain text. */
const plain = (html = '') => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

async function fetchWithRetry(url, attempts = 4) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (res.ok) return res;
    if (res.status !== 429 || attempt === attempts) throw new Error(`${url} responded ${res.status}`);
    await sleep(5000 * attempt);
  }
  throw new Error('unreachable');
}

async function describe(title) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    titles: title,
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    iiurlwidth: '960',
    iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist',
  });
  const res = await fetchWithRetry(`${API}?${params}`);
  const page = Object.values((await res.json()).query.pages)[0];
  if (!page.imageinfo) throw new Error(`${title} was not found on Commons`);
  const info = page.imageinfo[0];
  return {
    thumbUrl: info.thumburl,
    sourcePage: info.descriptionurl,
    author: plain(info.extmetadata.Artist?.value) || 'Unknown',
    license: info.extmetadata.LicenseShortName?.value || 'Unknown',
    licenseUrl: info.extmetadata.LicenseUrl?.value || '',
  };
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const attribution = [];

  for (const sample of SAMPLES) {
    const meta = await describe(sample.title);
    const original = Buffer.from(await (await fetchWithRetry(meta.thumbUrl)).arrayBuffer());
    const bytes = encodeJpeg(resizeRgb(decodeImage(original), MAX_SIDE), 85);
    await fs.writeFile(path.join(OUT_DIR, sample.file), bytes);

    attribution.push({
      file: sample.file,
      use: sample.use,
      task: sample.task,
      expected: sample.expected,
      title: sample.title.replace(/^File:/, ''),
      author: meta.author,
      license: meta.license,
      licenseUrl: meta.licenseUrl,
      source: meta.sourcePage,
    });
    console.log(`✓ ${sample.file}  (${Math.round(bytes.length / 1024)} KB, ${meta.license})`);
    await sleep(2000); // stay well inside Wikimedia's request-rate policy
  }

  await fs.writeFile(path.join(OUT_DIR, 'attribution.json'), `${JSON.stringify(attribution, null, 2)}\n`);
  console.log(`\n${attribution.length} images written to ${path.relative(process.cwd(), OUT_DIR)}`);
}

main().catch((err) => {
  console.error(`Sample image download failed: ${err.message}`);
  process.exit(1);
});

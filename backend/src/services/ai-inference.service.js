'use strict';

/**
 * AI Ecosystem Monitoring — Module 5.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS AND IS NOT REAL HERE
 * ---------------------------------------------------------------------------
 * This module implements the *inference contract* of the five vision tasks —
 * preprocessing description, class vocabulary, softmax probability vector,
 * argmax label, severity mapping and recommended action — but the logits are
 * produced by a deterministic hash of the image rather than by a trained
 * convolutional network. This was the scope agreed in the Week-6 assessor
 * review: "AI module descriptions adjusted to explicitly state that
 * mock/simulated responses would be used at the prototype stage."
 *
 * Nothing downstream knows the difference. `runInference` returns exactly the
 * shape a served Keras/PyTorch model would, so replacing the surrogate with a
 * real model is a change to one function — see `callRemoteModel` below, which
 * is already wired to an optional `AI_MODEL_ENDPOINT`.
 *
 * ---------------------------------------------------------------------------
 * The intended production pipeline
 * ---------------------------------------------------------------------------
 *   1. Decode → resize to 224×224 → normalise to ImageNet mean/σ
 *   2. MobileNetV2 backbone (pre-trained), frozen for the first training phase
 *   3. Global average pooling → dropout(0.2) → dense(C) head per task
 *   4. Softmax over the C task classes:
 *
 *        p_i = e^(z_i) ⁄ Σ_j e^(z_j)
 *
 *   5. Prediction = argmax_i p_i, confidence = 100 · max_i p_i
 *
 * Transfer learning is the right choice for this problem: the labelled data a
 * municipal deployment can realistically gather (a few thousand images per
 * task) is far too little to train a network from scratch, but ample for
 * fine-tuning a head on ImageNet features.
 *
 * ---------------------------------------------------------------------------
 * The deterministic surrogate
 * ---------------------------------------------------------------------------
 * Logits are drawn from a SHA-256 digest of the image identifier, then passed
 * through a real softmax with temperature. Determinism matters for a demo:
 * re-uploading the same photo gives the same answer, so a live presentation
 * cannot be derailed by a re-roll, and the seeded records stay stable.
 */

const crypto = require('crypto');

/**
 * Class vocabulary per task, with the severity and remediation each label
 * implies. These were drawn from the module specification in the project
 * report; a trained model would output over exactly this label set.
 */
const TASK_CLASSES = {
  'tree-disease': [
    { label: 'Healthy', severity: 'low', action: 'No action required. Continue routine seasonal inspection.' },
    { label: 'Oak Wilt (Ceratocystis fagacearum)', severity: 'critical', action: 'Immediate arborist assessment. Sever root grafts to neighbouring oaks and schedule sanitation pruning; do not prune during the vector flight season.' },
    { label: 'Anthracnose', severity: 'medium', action: 'Rake and destroy fallen leaves to break the infection cycle. Improve canopy air circulation by thinning.' },
    { label: 'Powdery Mildew', severity: 'low', action: 'Monitor. Treat with horticultural oil only if defoliation exceeds 30 %.' },
    { label: 'Bacterial Leaf Scorch', severity: 'high', action: 'Confirm by ELISA test. Manage with irrigation and growth regulators; the infection is not curable.' },
    { label: 'Root Rot (Armillaria)', severity: 'high', action: 'Assess structural stability before the next storm season. Reduce irrigation and improve drainage.' },
    { label: 'Emerald Ash Borer damage', severity: 'critical', action: 'Report to the municipal quarantine officer. Survey all ash within a 500 m radius.' },
  ],

  'plant-id': [
    { label: 'Common Milkweed (Asclepias syriaca)', severity: 'low', action: 'Protect in place — the obligate host plant of the Monarch. Add to the pollinator corridor layer.' },
    { label: 'Purple Coneflower (Echinacea purpurea)', severity: 'low', action: 'Native pollinator forage. Record in the biodiversity catalogue.' },
    { label: 'Japanese Knotweed (Reynoutria japonica)', severity: 'high', action: 'INVASIVE. Do not cut or mow — fragments propagate. Raise a containment work order and flag the location.' },
    { label: 'Lantana (Lantana camara)', severity: 'high', action: 'INVASIVE and toxic to livestock. Schedule manual removal including the root crown.' },
    { label: 'Neem (Azadirachta indica)', severity: 'low', action: 'Native canopy species in good standing. Add to the tree inventory.' },
    { label: 'Bee Balm (Monarda didyma)', severity: 'low', action: 'Native nectar source. Suitable for expansion of pollinator beds.' },
  ],

  wildlife: [
    { label: 'Red-tailed Hawk (Buteo jamaicensis)', severity: 'low', action: 'Log the observation. An apex predator sighting indicates a functioning food web.' },
    { label: 'Great Blue Heron (Ardea herodias)', severity: 'low', action: 'Log the observation. A wetland indicator species — record water quality alongside it.' },
    { label: 'Gray Fox (Urocyon cinereoargenteus)', severity: 'low', action: 'Log the observation. Advise visitors not to feed wildlife.' },
    { label: 'Monarch Butterfly (Danaus plexippus)', severity: 'medium', action: 'Vulnerable species. Verify milkweed availability within the sighting radius.' },
    { label: 'Indian Peafowl (Pavo cristatus)', severity: 'low', action: 'Log the observation. Monitor for over-population near food kiosks.' },
    { label: 'Stray Dog Pack', severity: 'high', action: 'Not wildlife. Notify animal control — a documented predation risk to ground-nesting birds.' },
  ],

  waste: [
    { label: 'No waste detected', severity: 'low', action: 'Area is clear. No action required.' },
    { label: 'Household litter (scattered)', severity: 'low', action: 'Add to the next scheduled cleaning round.' },
    { label: 'Overflowing bin', severity: 'medium', action: 'Dispatch collection within 24 h. Review the collection frequency for this location.' },
    { label: 'Construction debris pile', severity: 'high', action: 'Open an illegal-dumping incident. Photograph for enforcement and check nearby CCTV.' },
    { label: 'Hazardous / chemical waste', severity: 'critical', action: 'Cordon the area immediately. Notify the hazardous materials team — do not handle.' },
    { label: 'Plastic accumulation in water body', severity: 'high', action: 'Deploy a surface skimmer. Sample the water for microplastics.' },
  ],

  fire: [
    { label: 'No fire detected', severity: 'low', action: 'Area is clear. Continue monitoring.' },
    { label: 'Smoke plume (unconfirmed source)', severity: 'medium', action: 'Dispatch an officer to verify within 15 minutes.' },
    { label: 'Early-stage grass fire', severity: 'critical', action: 'ALERT FIRE SERVICES IMMEDIATELY. Evacuate the trail and close the nearest entrance.' },
    { label: 'Active canopy fire', severity: 'critical', action: 'ALERT FIRE SERVICES IMMEDIATELY. Full park evacuation; notify adjacent residential blocks.' },
    { label: 'Controlled burn / permitted activity', severity: 'low', action: 'Cross-check against the burn permit register before standing down.' },
  ],
};

/** Model card per task — recorded on every detection for traceability. */
const MODEL_CARDS = {
  'tree-disease': { name: 'GreenPulse-TreeHealth', backbone: 'MobileNetV2', version: 'v1.2.0', inputSize: 224 },
  'plant-id':     { name: 'GreenPulse-FloraID',    backbone: 'MobileNetV2', version: 'v1.1.0', inputSize: 224 },
  wildlife:       { name: 'GreenPulse-FaunaID',    backbone: 'EfficientNet-B0', version: 'v1.3.0', inputSize: 224 },
  waste:          { name: 'GreenPulse-WasteNet',   backbone: 'MobileNetV2', version: 'v1.0.0', inputSize: 224 },
  fire:           { name: 'GreenPulse-FireWatch',  backbone: 'MobileNetV2', version: 'v2.0.0', inputSize: 224 },
};

/**
 * Numerically stable softmax with temperature.
 *
 *   p_i = e^((z_i − max z)/T) / Σ_j e^((z_j − max z)/T)
 *
 * Subtracting max(z) prevents overflow without changing the result.
 * T < 1 sharpens the distribution (more confident), T > 1 flattens it.
 *
 * @param {number[]} logits
 * @param {number} [temperature=1]
 * @returns {number[]} probabilities summing to 1
 */
function softmax(logits, temperature = 1) {
  const t = temperature > 0 ? temperature : 1;
  const max = Math.max(...logits);
  const exps = logits.map((z) => Math.exp((z - max) / t));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

/**
 * Derive a deterministic logit vector from an image identifier.
 *
 * A SHA-256 digest of `<task>:<identifier>` supplies the bytes; each class
 * takes two bytes, mapped to roughly [-2, 6]. The asymmetric range makes one
 * class usually dominate, which mirrors how a confident classifier behaves —
 * a uniform range would produce implausibly flat 20 %-across-the-board output.
 *
 * @param {string} task
 * @param {string} identifier Image URL, filename, or content hash
 * @param {number} classCount
 * @returns {number[]}
 */
function deriveLogits(task, identifier, classCount) {
  const digest = crypto.createHash('sha256').update(`${task}:${identifier}`).digest();
  const logits = [];
  for (let i = 0; i < classCount; i += 1) {
    const byte = digest[(i * 2) % digest.length];
    const nextByte = digest[(i * 2 + 1) % digest.length];
    const raw = (byte * 256 + nextByte) / 65535; // [0, 1]
    logits.push(raw * 8 - 2); // [-2, 6]
  }
  return logits;
}

/**
 * Optional escape hatch to a real served model.
 *
 * Set `AI_MODEL_ENDPOINT` and the service POSTs `{task, imageUrl}` there,
 * expecting `{probabilities: [{label, probability}, …]}` back. Any failure
 * falls through to the deterministic surrogate so a demo never breaks because
 * an inference container is down.
 *
 * @returns {Promise<Array<{label:string, probability:number}>|null>}
 */
async function callRemoteModel(task, imageUrl) {
  const endpoint = process.env.AI_MODEL_ENDPOINT;
  if (!endpoint || typeof fetch !== 'function') return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task, imageUrl }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const payload = await res.json();
    return Array.isArray(payload?.probabilities) ? payload.probabilities : null;
  } catch {
    return null; // fall through to the surrogate
  }
}

/**
 * Run one image through a task's classifier.
 *
 * @param {'tree-disease'|'plant-id'|'wildlife'|'waste'|'fire'} task
 * @param {string} imageUrl
 * @param {object} [options]
 * @param {number} [options.temperature=0.6] Softmax temperature
 * @returns {Promise<{task:string, prediction:string, confidence:number,
 *   probabilities:Array<{label:string,probability:number}>, severity:string,
 *   recommendedAction:string, model:object, inferenceMs:number, simulated:boolean}>}
 */
async function runInference(task, imageUrl, options = {}) {
  const classes = TASK_CLASSES[task];
  if (!classes) throw new Error(`Unknown inference task '${task}'`);

  const startedAt = process.hrtime.bigint();
  const card = MODEL_CARDS[task];

  let probabilities = await callRemoteModel(task, imageUrl);
  const simulated = probabilities === null;

  if (simulated) {
    const logits = deriveLogits(task, imageUrl, classes.length);
    const probs = softmax(logits, options.temperature ?? 0.6);
    probabilities = classes.map((c, i) => ({ label: c.label, probability: probs[i] }));
  }

  probabilities.sort((a, b) => b.probability - a.probability);
  const top = probabilities[0];
  const matched = classes.find((c) => c.label === top.label) || classes[0];

  const inferenceMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

  return {
    task,
    prediction: top.label,
    confidence: Math.round(top.probability * 1000) / 10, // one decimal, 0–100
    probabilities: probabilities.map((p) => ({
      label: p.label,
      probability: Math.round(p.probability * 10000) / 10000,
    })),
    severity: matched.severity,
    recommendedAction: matched.action,
    model: card,
    inferenceMs: Math.round(inferenceMs * 100) / 100,
    simulated,
  };
}

/** Labels available for a task — used by the frontend to render the legend. */
function classesFor(task) {
  return (TASK_CLASSES[task] || []).map(({ label, severity }) => ({ label, severity }));
}

module.exports = { runInference, softmax, classesFor, TASK_CLASSES, MODEL_CARDS };

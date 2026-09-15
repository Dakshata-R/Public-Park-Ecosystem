'use strict';

/**
 * AI Ecosystem Monitoring — Module 5.
 *
 * ---------------------------------------------------------------------------
 * How a finding is produced
 * ---------------------------------------------------------------------------
 * `vision.service` runs a trained MobileNetV2 over the image and measures its
 * pixels. This module turns that evidence into each task's vocabulary. No
 * class here is decided by anything other than the submitted image.
 *
 * A general ImageNet network was not trained on park-management categories,
 * so every task is built from signals the network *does* produce reliably:
 *
 *   1. ImageNet classes are pooled into semantic groups by index range —
 *      the 59 bird classes become one "bird" signal, the six butterfly
 *      classes one "butterfly" signal, and so on. A group's evidence is the
 *      total probability the network assigned to its members:
 *
 *          E_g = Σ_{i ∈ g} p_i
 *
 *   2. Where the network has no relevant vocabulary (foliage colour), the
 *      pixel statistics carry the decision, with the network used as a gate.
 *
 *   3. Each class receives a non-negative score built from that evidence, and
 *      scores are normalised into a probability vector:
 *
 *          P(k) = s_k ⁄ Σ_j s_j
 *
 * The weights and exponents below were calibrated against 22 labelled
 * Wikimedia Commons photographs (flames, smoke, sunsets, autumn foliage,
 * chlorotic and dead trees, birds, butterflies, litter). They are stated in
 * the code, returned with every result as `evidence`, and documented in
 * docs/algorithms.md, so every call is inspectable and arguable.
 *
 * ---------------------------------------------------------------------------
 * Known limits (also returned to the client as `notes`)
 * ---------------------------------------------------------------------------
 *   • Species are named at ImageNet granularity — an Indian pond heron is
 *     reported as the nearest ImageNet class ("bittern").
 *   • Mixed dumped waste is outside ImageNet's vocabulary; only discrete
 *     objects (bottles, bags, bins) are recognised.
 *   • Foliage health is a colour measurement, not a disease diagnosis.
 * These are the reasons every detection enters a human review queue, and why
 * only a fire finding may open an incident without review.
 */

const { IMAGENET_CLASSES } = require('@tensorflow-models/mobilenet/dist/imagenet_classes');
const vision = require('./vision.service');

/** Inclusive integer range. */
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/**
 * ImageNet-1k index groups. Ranges were checked against the class list
 * shipped with @tensorflow-models/mobilenet.
 */
const GROUPS = {
  bird: [...range(7, 24), ...range(80, 100), ...range(127, 146)],
  amphibian: range(25, 32),
  reptile: range(33, 68),
  insect: range(300, 320),
  butterfly: range(321, 326),
  invertebrate: [...range(69, 79), ...range(107, 126)],
  wildMammal: [
    ...range(101, 106), ...range(147, 150), ...range(269, 280), ...range(286, 299),
    ...range(330, 338), 340, 342, 343, 344, 347, ...range(349, 353), ...range(355, 388),
  ],
  domesticAnimal: [...range(151, 268), ...range(281, 285), 339, 341, 345, 346, 348, 354],
  fish: [...range(0, 6), ...range(389, 397)],
  flower: [984, 985, 986, 989],
  fruitOrSeed: [...range(936, 946), ...range(948, 957), 987, 988, 990, 998],
  fungus: [947, ...range(991, 997)],
  /** volcano, fire screen, torch, candle, matchstick, lighter */
  fire: [980, 556, 862, 470, 644, 626],
  /** geyser, steam locomotive — the classes that carry rising plumes */
  smoke: [974, 820],
  /** bottles, plastic bag, packet, carton, paper towel, toilet tissue, cup, jug */
  litter: [440, 737, 898, 907, 720, 728, 692, 478, 700, 999, 968, 899],
  /** ashcan, garbage truck */
  bin: [412, 569],
};

const ANIMAL_GROUPS = ['bird', 'amphibian', 'reptile', 'insect', 'butterfly', 'invertebrate', 'wildMammal', 'domesticAnimal', 'fish'];

const round = (x, dp = 4) => Math.round(x * 10 ** dp) / 10 ** dp;
const clamp01 = (x) => Math.min(1, Math.max(0, x));

/** Probability mass the network placed on a group. */
function massOf(probabilities, group) {
  return GROUPS[group].reduce((sum, index) => sum + probabilities[index], 0);
}

/** The single most probable ImageNet class inside a group, for display. */
function bestIn(probabilities, groups, imagenetLabel) {
  let best = null;
  for (const group of groups) {
    for (const index of GROUPS[group]) {
      if (!best || probabilities[index] > probabilities[best]) best = index;
    }
  }
  return best === null ? null : { label: imagenetLabel(best), probability: round(probabilities[best]) };
}

/**
 * Task definitions. `score(evidence)` returns one non-negative score per
 * class, in class order, plus the named signals it used.
 */
const TASKS = {
  'tree-disease': {
    title: 'Tree & foliage health',
    method: 'Colour analysis of foliage pixels (HSV bands) with a CNN subject gate',
    classes: [
      { label: 'Healthy green foliage', severity: 'low', action: 'No action required. Continue routine seasonal inspection.' },
      { label: 'Yellowing foliage (chlorosis)', severity: 'medium', action: 'Check for nutrient deficiency (iron, nitrogen) or waterlogging. Schedule a soil test for the root zone.' },
      { label: 'Browning foliage (necrosis or dieback)', severity: 'medium', action: 'Arborist inspection for dieback, borer damage or root decay. Assess limb safety before the monsoon.' },
      { label: 'No foliage in frame', severity: 'low', action: 'No foliage was found. Photograph the canopy or the affected leaves at closer range.' },
    ],
    score({ stats, mass }) {
      const green = stats.healthyGreenFraction;
      const yellow = stats.chloroticFraction;
      const brown = stats.necroticFraction;
      const vegetation = green + yellow + brown;

      // Foliage must fill a meaningful part of the frame (25 % saturates the
      // presence term), and a photo whose subject is an animal is not a
      // foliage photo however green its background is. The gate only engages
      // above 40 % animal evidence: dense canopy texture alone draws ~50 %
      // onto the monkey classes, and must not suppress itself.
      const animal = ANIMAL_GROUPS.reduce((sum, g) => sum + mass(g), 0);
      const animalGate = clamp01((animal - 0.4) / 0.5);
      const presence = clamp01(vegetation / 0.25) * (1 - 0.8 * animalGate);
      const share = (x) => (vegetation > 0 ? x / vegetation : 0);

      return {
        scores: [presence * share(green), presence * share(yellow), presence * share(brown), 1 - presence],
        signals: { vegetationCover: vegetation, greenShare: share(green), yellowShare: share(yellow), brownShare: share(brown), animalSubject: animal, greenLeafIndex: stats.greenLeafIndex },
      };
    },
  },

  'plant-id': {
    title: 'Plant & fungus recognition',
    method: 'ImageNet botanical classes pooled by group, with pixel vegetation cover',
    classes: [
      { label: 'Flowering plant', severity: 'low', action: 'Record the flowering in the biodiversity catalogue once an ecologist confirms the species.' },
      { label: 'Fruit, seed or vegetable', severity: 'low', action: 'Record for phenology. Fallen fruit on paths is a slip hazard — schedule sweeping if heavy.' },
      { label: 'Fungus or mushroom', severity: 'medium', action: 'Fruiting bodies at a tree base can indicate root or butt rot. Inspect the host tree.' },
      { label: 'Foliage (species outside the model vocabulary)', severity: 'low', action: 'Vegetation is present but the species cannot be named by this model. Send to an ecologist for identification.' },
      { label: 'No plant detected', severity: 'low', action: 'No vegetation was recognised in the image.' },
    ],
    score({ stats, mass }) {
      const flower = mass('flower');
      const fruit = mass('fruitOrSeed');
      const fungus = mass('fungus');
      const botanical = flower + fruit + fungus;
      const cover = clamp01((stats.healthyGreenFraction + stats.chloroticFraction) / 0.4);
      const unexplained = 1 - botanical;

      return {
        scores: [flower, fruit, fungus, unexplained * cover, unexplained * (1 - cover)],
        signals: { flowerEvidence: flower, fruitEvidence: fruit, fungusEvidence: fungus, vegetationCover: cover },
      };
    },
  },

  wildlife: {
    title: 'Wildlife recognition',
    method: 'ImageNet animal classes pooled by taxonomic group',
    classes: [
      { label: 'Bird', group: ['bird'], severity: 'low', action: 'Log the sighting. Verified records feed the biodiversity indices.' },
      { label: 'Butterfly or moth', group: ['butterfly'], severity: 'low', action: 'Log the sighting. Butterfly counts track the health of the pollinator beds.' },
      { label: 'Other insect or invertebrate', group: ['insect', 'invertebrate'], severity: 'low', action: 'Log the sighting if the species can be confirmed.' },
      { label: 'Reptile or amphibian', group: ['reptile', 'amphibian'], severity: 'medium', action: 'Keep visitors at a distance. If a snake is on a path, call the wildlife rescue helpline rather than handling it.' },
      { label: 'Wild mammal', group: ['wildMammal'], severity: 'low', action: 'Log the sighting. Remind visitors not to feed wildlife, including monkeys.' },
      { label: 'Domestic or stray animal', group: ['domesticAnimal'], severity: 'medium', action: 'Not wildlife. Notify animal control if strays are present — they prey on ground-nesting birds.' },
      { label: 'No animal detected', group: [], severity: 'low', action: 'No animal was recognised. An animal outside the model vocabulary may still be present.' },
    ],
    score({ mass }) {
      const groups = [
        mass('bird'),
        mass('butterfly'),
        mass('insect') + mass('invertebrate'),
        mass('reptile') + mass('amphibian'),
        mass('wildMammal'),
        mass('domesticAnimal'),
      ];
      const animal = groups.reduce((a, b) => a + b, 0) + mass('fish');
      return {
        scores: [...groups, Math.max(0, 1 - animal)],
        signals: { animalEvidence: animal },
      };
    },
  },

  waste: {
    title: 'Litter detection',
    method: 'ImageNet litter-object and bin classes pooled by group',
    classes: [
      { label: 'Litter recognised (bottles, bags, packaging)', severity: 'medium', action: 'Add to the next cleaning round. Repeated finds at one spot warrant an extra bin.' },
      { label: 'Waste bin recognised', severity: 'low', action: 'Check the fill level on site. Review the collection frequency if it is overflowing.' },
      { label: 'No litter objects recognised', severity: 'low', action: 'No discrete litter objects were recognised. Mixed or dumped waste is outside the model vocabulary — review manually.' },
    ],
    score({ mass }) {
      const litter = mass('litter');
      const bin = mass('bin');
      // Sharpened so moderate object evidence is not swamped by the residual.
      return {
        scores: [litter, bin, (1 - clamp01(litter + bin)) ** 4],
        signals: { litterEvidence: litter, binEvidence: bin },
      };
    },
  },

  fire: {
    title: 'Fire & smoke detection',
    method: 'ImageNet fire and plume classes, corroborated by flame and smoke chromaticity',
    classes: [
      { label: 'Flames visible', severity: 'critical', incidentType: 'fire', action: 'ALERT FIRE SERVICES (101) IMMEDIATELY. Clear the area and close the nearest entrance.' },
      { label: 'Smoke visible', severity: 'high', incidentType: 'fire', action: 'Dispatch an officer to locate the source within 15 minutes.' },
      { label: 'No fire or smoke detected', severity: 'low', action: 'No fire or smoke was recognised. Continue monitoring.' },
    ],
    score({ stats, mass, strictFlameFraction }) {
      const fire = mass('fire');
      const smoke = mass('smoke');
      // Colour evidence only counts in proportion to what the network already
      // sees: orange leaves pass every flame-colour rule, but the network puts
      // almost no mass on its fire classes for them.
      const flameColour = strictFlameFraction * clamp01(fire / 0.1);
      const smokeColour = stats.smokeFraction * clamp01(smoke / 0.05);
      return {
        // The residual is sharpened (^6) so a grass fire drawing ~17 % onto
        // the fire and plume classes registers, while sunsets and autumn
        // leaves — under 3 % — still resolve to "no fire" at ≥ 95 %.
        scores: [fire + flameColour, smoke + smokeColour, (1 - clamp01(fire + smoke)) ** 6],
        signals: { fireEvidence: fire, smokeEvidence: smoke, flameColour: strictFlameFraction, smokeColour: stats.smokeFraction },
      };
    },
  },
};

/** Turn scores into a descending probability vector over the class labels. */
function normalise(classes, scores) {
  const total = scores.reduce((a, b) => a + Math.max(0, b), 0) || 1;
  return classes
    .map((c, i) => ({ label: c.label, probability: Math.max(0, scores[i]) / total }))
    .sort((a, b) => b.probability - a.probability);
}

/**
 * Map a vision description onto a task.
 *
 * @param {keyof TASKS} task
 * @param {Awaited<ReturnType<typeof vision.describeBuffer>>} description
 */
function interpret(task, description) {
  const definition = TASKS[task];
  if (!definition) throw new Error(`Unknown inference task '${task}'`);

  const { probabilities, stats } = description;
  const imagenetLabel = (index) => IMAGENET_CLASSES[index];
  const mass = (group) => massOf(probabilities, group);

  const { scores, signals } = definition.score({
    stats,
    mass,
    strictFlameFraction: stats.strictFlameFraction ?? 0,
  });

  const ranked = normalise(definition.classes, scores);
  const top = ranked[0];
  const matched = definition.classes.find((c) => c.label === top.label);

  // For group-based tasks, name the most likely ImageNet member of the
  // winning group ("Bird" → "bee eater"), which is what a reviewer checks.
  let detail = null;
  if (matched.group?.length) {
    const best = bestIn(probabilities, matched.group, imagenetLabel);
    if (best) detail = `Closest ImageNet class: ${best.label.split(',')[0]} (${round(best.probability * 100, 1)} %)`;
  }

  const topImagenet = description.imagenet[0];
  const notes = [];
  if (topImagenet && topImagenet.probability < 0.2 && task !== 'tree-disease') {
    notes.push(
      `The network is unsure what this image shows (its top class, "${topImagenet.label.split(',')[0]}", has ${round(topImagenet.probability * 100, 1)} %). Treat this finding as unconfirmed.`
    );
  }
  if (task === 'tree-disease') notes.push('Foliage health is measured from colour, not diagnosed. Confirm any disease on site.');
  if (task === 'wildlife' && detail) notes.push('Species are named at ImageNet granularity, which does not include most Indian species.');
  if (task === 'waste') notes.push('Only discrete objects are recognised; heaps of mixed waste may be reported as clear.');

  return {
    task,
    title: definition.title,
    method: definition.method,
    prediction: top.label,
    detail,
    confidence: round(top.probability * 100, 1),
    probabilities: ranked.map((p) => ({ label: p.label, probability: round(p.probability) })),
    severity: matched.severity,
    incidentType: matched.incidentType || null,
    recommendedAction: matched.action,
    evidence: Object.fromEntries(Object.entries(signals).map(([k, v]) => [k, round(v)])),
    notes,
  };
}

/**
 * Run one image through a task.
 *
 * @param {keyof TASKS} task
 * @param {string|Buffer} image  An http(s) URL, a data URL, or raw bytes
 */
async function runInference(task, image) {
  if (!TASKS[task]) throw new Error(`Unknown inference task '${task}'`);

  const startedAt = Date.now();
  const description = Buffer.isBuffer(image)
    ? await vision.describeBuffer(image)
    : await vision.describeImage(image);

  const result = interpret(task, description);

  return {
    ...result,
    imagenet: description.imagenet.slice(0, 5).map(({ label, probability }) => ({ label, probability })),
    stats: description.stats,
    image: description.image,
    stored: description.stored,
    model: description.model,
    timings: description.timings,
    inferenceMs: description.timings.inferenceMs,
    totalMs: Date.now() - startedAt,
  };
}

/** Labels, severities and method for every task — the frontend legend. */
function describeTasks() {
  return Object.entries(TASKS).map(([task, t]) => ({
    task,
    title: t.title,
    method: t.method,
    model: vision.MODEL_CARD,
    classes: t.classes.map(({ label, severity }) => ({ label, severity })),
  }));
}

const TASK_KEYS = Object.keys(TASKS);

module.exports = { runInference, interpret, describeTasks, massOf, TASKS, TASK_KEYS, GROUPS };

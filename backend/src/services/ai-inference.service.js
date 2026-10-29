'use strict';

/**
 * AI Ecosystem Monitoring — Module 5: wildlife recognition.
 *
 * ---------------------------------------------------------------------------
 * Two engines, one vocabulary
 * ---------------------------------------------------------------------------
 * Every image is first classified locally by `vision.service`: a trained
 * MobileNetV2 (ImageNet-1k). That is the evidence layer, and it always runs.
 *
 *   • llm-vision — when a language model is configured (GEMINI_API_KEY, free;
 *     or GROQ_API_KEY, LLM_BASE_URL, ANTHROPIC_API_KEY — see
 *     `llm-provider.service`), the stored ≤640 px JPEG and a summary of that
 *     evidence go to a multimodal model (`llm-vision.service`), which names
 *     the animal species (common and scientific) and suggests an action. The
 *     result records the provider and model. Detections stored before
 *     providers were pluggable carry the legacy engine value `claude-vision`.
 *
 *   • mobilenet-fallback — without a key, or when the API call fails or times
 *     out, the network's output is mapped onto the task's labels by the rule
 *     below. It names animals only at ImageNet granularity ("tiger", not
 *     "Bengal tiger"); the result says so.
 *
 * Both engines answer in the same label vocabulary, so the review queue, the
 * probability vector and the precision statistics are the same whichever
 * engine produced a finding. Every result records its `engine`.
 *
 * ---------------------------------------------------------------------------
 * The fallback rule
 * ---------------------------------------------------------------------------
 *   1. ImageNet classes are pooled into taxonomic groups by index range — the
 *      59 bird classes become one "bird" signal, and so on. A group's
 *      evidence is the total probability the network assigned to it:
 *
 *          E_g = Σ_{i ∈ g} p_i
 *
 *   2. "No animal detected" takes the probability left over once every
 *      animal group is counted, and class scores are normalised into a
 *      probability vector, P(k) = s_k ⁄ Σ s_j.
 *
 * The named signals are returned with every result as `evidence`, and every
 * detection — from either engine — waits for a park officer to confirm or
 * correct it.
 */

const { IMAGENET_CLASSES } = require('@tensorflow-models/mobilenet/dist/imagenet_classes');
const vision = require('./vision.service');
const llmVision = require('./llm-vision.service');
const logger = require('../utils/logger');

/** Inclusive integer range. */
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/**
 * ImageNet-1k animal index groups. Ranges were checked against the class list
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
};

/** `legacyClaude` is only ever read back from old detections, never written. */
const ENGINE = { llm: 'llm-vision', fallback: 'mobilenet-fallback', legacyClaude: 'claude-vision' };

const round = (x, dp = 4) => Math.round(x * 10 ** dp) / 10 ** dp;
/** ImageNet labels list synonyms ("tiger, Panthera tigris"); the first is the name. */
const imagenetName = (label) => label.split(',')[0].trim();
const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Probability mass the network placed on a group. */
function massOf(probabilities, group) {
  return GROUPS[group].reduce((sum, index) => sum + probabilities[index], 0);
}

/** The single most probable ImageNet class inside a set of groups. */
function bestIn(probabilities, groups) {
  let best = null;
  for (const group of groups) {
    for (const index of GROUPS[group]) {
      if (best === null || probabilities[index] > probabilities[best]) best = index;
    }
  }
  return best === null ? null : { label: imagenetName(IMAGENET_CLASSES[best]), probability: round(probabilities[best]) };
}

/**
 * Task definitions.
 *
 *   classes   the label vocabulary shared by both engines; `hint` is shown to
 *             the language model, `action` is the fallback recommendation
 *   brief     what the language model is asked to do
 *   score     the fallback: one non-negative score per class, in class
 *             order, plus the named signals used and the species
 */
const TASKS = {
  wildlife: {
    title: 'Wildlife recognition',
    method: 'ImageNet animal classes pooled by taxonomic group',
    llmMethod: 'AI vision (a multimodal language model) names the animal species; MobileNetV2 ImageNet classes are kept as evidence',
    brief: 'Identify the animal in the photograph to species (common and scientific name). If the animal is visibly injured, sick or dead, raise the severity and say so in the recommended action.',
    classes: [
      { label: 'Bird', group: ['bird'], severity: 'low', hint: 'any bird', action: 'Log the sighting. Verified records feed the biodiversity indices.' },
      { label: 'Butterfly or moth', group: ['butterfly'], severity: 'low', hint: 'Lepidoptera, including caterpillars', action: 'Log the sighting. Butterfly counts track the health of the pollinator beds.' },
      { label: 'Other insect or invertebrate', group: ['insect', 'invertebrate'], severity: 'low', hint: 'beetles, bees, dragonflies, spiders, snails…', action: 'Log the sighting if the species can be confirmed.' },
      { label: 'Reptile or amphibian', group: ['reptile', 'amphibian'], severity: 'medium', hint: 'snakes, lizards, turtles, frogs, toads', action: 'Keep visitors at a distance. If a snake is on a path, call the wildlife rescue helpline rather than handling it.' },
      { label: 'Wild mammal', group: ['wildMammal'], severity: 'low', hint: 'monkeys, squirrels, bats, mongooses, big cats, deer…', action: 'Log the sighting. Remind visitors not to feed wildlife, including monkeys.' },
      { label: 'Domestic or stray animal', group: ['domesticAnimal'], severity: 'medium', hint: 'dogs, cats, cattle, goats and other domestic animals', action: 'Not wildlife. Notify animal control if strays are present — they prey on ground-nesting birds.' },
      { label: 'No animal detected', group: [], severity: 'low', hint: 'no animal in the photograph', action: 'No animal was recognised. An animal outside the model vocabulary may still be present.' },
    ],
    score({ mass, probabilities }) {
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
        species(label) {
          const group = TASKS.wildlife.classes.find((c) => c.label === label)?.group;
          return group?.length ? bestIn(probabilities, group) : null;
        },
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

const speciesLine = (species) => (species ? `${species.common}${species.scientific ? ` (${species.scientific})` : ''}` : '');

/**
 * The fallback engine: map a vision description onto a task with the rule
 * above. Also the evidence layer reported alongside an AI vision result.
 *
 * @param {keyof TASKS} task
 * @param {Awaited<ReturnType<typeof vision.describeBuffer>>} description
 */
function interpret(task, description) {
  const definition = TASKS[task];
  if (!definition) throw new Error(`Unknown inference task '${task}'`);

  const { probabilities } = description;
  const mass = (group) => massOf(probabilities, group);
  const outcome = definition.score({ mass, probabilities });

  const ranked = normalise(definition.classes, outcome.scores);
  const top = ranked[0];
  const matched = definition.classes.find((c) => c.label === top.label);

  // The closest ImageNet member of the winning group ("Wild mammal" → "tiger")
  // is the fallback's species name: ImageNet granularity, said so in the notes.
  const best = outcome.species?.(top.label) ?? null;
  const species = best && best.probability >= 0.05
    ? { common: capitalise(best.label), scientific: '', confidence: round(best.probability * 100, 1) }
    : null;

  const notes = [];
  const topImagenet = description.imagenet[0];
  if (topImagenet && topImagenet.probability < 0.2) {
    notes.push(
      `The network is unsure what this image shows (its top class, "${imagenetName(topImagenet.label)}", has ${round(topImagenet.probability * 100, 1)} %). Treat this finding as unconfirmed.`
    );
  }
  if (species) notes.push('The name is the closest ImageNet class, which does not include most Indian species.');

  return {
    task,
    title: definition.title,
    method: definition.method,
    engine: ENGINE.fallback,
    prediction: top.label,
    detail: best ? `ImageNet class: ${best.label} (${round(best.probability * 100, 1)} %)` : null,
    confidence: round(top.probability * 100, 1),
    probabilities: ranked.map((p) => ({ label: p.label, probability: round(p.probability) })),
    severity: matched.severity,
    recommendedAction: matched.action,
    species,
    evidence: Object.fromEntries(Object.entries(outcome.signals).map(([k, v]) => [k, round(v)])),
    notes,
  };
}

/** A compact, human-readable summary of the local evidence, sent to the language model as a hint. */
function evidenceSummary(description) {
  const imagenet = description.imagenet
    .slice(0, 3)
    .map((c) => `${imagenetName(c.label)} ${round(c.probability * 100, 1)}%`)
    .join(', ');
  return `MobileNetV2 (ImageNet) top classes: ${imagenet}.`;
}

/** Combine the language model's answer with the local evidence into one result. */
function fromLlm(task, fallback, llm) {
  const definition = TASKS[task];
  const top = llm.probabilities[0];
  const matched = definition.classes.find((c) => c.label === top.label);

  return {
    ...fallback,
    method: definition.llmMethod,
    engine: ENGINE.llm,
    provider: llm.provider,
    providerLabel: llm.providerLabel,
    prediction: top.label,
    detail: speciesLine(llm.species) || null,
    confidence: round(top.probability * 100, 1),
    probabilities: llm.probabilities,
    severity: llm.severity,
    recommendedAction: llm.recommendedAction || matched.action,
    species: llm.species,
    notes: [
      ...(llm.caveat ? [llm.caveat] : []),
      `Identified by ${llm.providerLabel} vision. The MobileNetV2 classes are shown as supporting evidence; a park officer should confirm before acting.`,
    ],
    engineModel: { name: `${llm.providerLabel} vision`, version: llm.model },
  };
}

/**
 * Decide a task from a vision description: the language model when it is enabled and
 * answers, otherwise the fallback rule — always with the local evidence.
 *
 * @param {keyof TASKS} task
 * @param {Awaited<ReturnType<typeof vision.describeBuffer>>} description
 * @param {{engine?: 'auto' | 'fallback'}} [options] `fallback` skips the language model (seeding, evaluation)
 */
async function decide(task, description, { engine = 'auto' } = {}) {
  const fallback = {
    ...interpret(task, description),
    engineModel: { name: vision.MODEL_CARD.name, version: vision.MODEL_CARD.version },
    provider: '',
  };
  if (engine === 'fallback') return fallback;

  if (!llmVision.isEnabled()) {
    return {
      ...fallback,
      notes: [...fallback.notes, 'Species names need the AI vision engine — set GEMINI_API_KEY on the server (free at https://aistudio.google.com/apikey). This result comes from MobileNetV2 only.'],
    };
  }

  const definition = TASKS[task];
  try {
    const llm = await llmVision.identify({
      task,
      title: definition.title,
      brief: definition.brief,
      labels: definition.classes.map(({ label, hint }) => ({ label, hint })),
      jpeg: description.stored.buffer,
      evidence: evidenceSummary(description),
    });
    return fromLlm(task, fallback, llm);
  } catch (err) {
    const label = llmVision.providerInfo()?.label || 'AI';
    logger.warn(`${label} vision unavailable for '${task}', using the MobileNetV2 fallback: ${err.message}`);
    return {
      ...fallback,
      notes: [...fallback.notes, `${label} vision was unavailable (${err.message}), so this result comes from MobileNetV2, which names animals only at ImageNet granularity.`],
    };
  }
}

/**
 * Run one image through a task.
 *
 * @param {keyof TASKS} task
 * @param {string|Buffer} image  An http(s) URL, a data URL, or raw bytes
 * @param {{engine?: 'auto' | 'fallback'}} [options]
 */
async function runInference(task, image, options = {}) {
  if (!TASKS[task]) throw new Error(`Unknown inference task '${task}'`);

  const startedAt = Date.now();
  const description = Buffer.isBuffer(image)
    ? await vision.describeBuffer(image)
    : await vision.describeImage(image);

  const visionAt = Date.now();
  const result = await decide(task, description, options);

  return {
    ...result,
    imagenet: description.imagenet.slice(0, 5).map(({ label, probability }) => ({ label, probability })),
    image: description.image,
    stored: description.stored,
    model: description.model,
    timings: { ...description.timings, identifyMs: result.engine === ENGINE.llm ? Date.now() - visionAt : 0 },
    inferenceMs: description.timings.inferenceMs,
    totalMs: Date.now() - startedAt,
  };
}

/** Labels, severities, method and active engine for every task — the frontend legend. */
function describeTasks() {
  const provider = llmVision.providerInfo();
  return Object.entries(TASKS).map(([task, t]) => ({
    task,
    title: t.title,
    method: provider ? t.llmMethod : t.method,
    engine: provider ? ENGINE.llm : ENGINE.fallback,
    visionModel: provider ? llmVision.modelId() : null,
    /** e.g. "gemini" / "Gemini"; null when the fallback is in use. */
    visionProvider: provider ? provider.name : null,
    visionProviderLabel: provider ? provider.label : null,
    model: vision.MODEL_CARD,
    classes: t.classes.map(({ label, severity }) => ({ label, severity })),
  }));
}

const TASK_KEYS = Object.keys(TASKS);

module.exports = {
  runInference, decide, interpret, describeTasks, massOf,
  TASKS, TASK_KEYS, GROUPS, ENGINE,
};

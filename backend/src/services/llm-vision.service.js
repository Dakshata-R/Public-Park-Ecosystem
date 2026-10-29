'use strict';

/**
 * AI Monitoring — the language-model vision engine.
 *
 * MobileNetV2 knows the 1,000 ImageNet classes: it can say "tiger" but not
 * "Bengal tiger", and most Indian species are not in its vocabulary at all.
 * When a language model is configured (GEMINI_API_KEY — free — or
 * GROQ_API_KEY, LLM_BASE_URL, ANTHROPIC_API_KEY; see
 * `llm-provider.service.js`), the stored ≤640 px JPEG is sent to a multimodal
 * model, which names the animal species (common and scientific), gives a
 * severity and suggests an action for the park team.
 *
 * The answer is constrained to a JSON schema whose label field is the task's
 * own vocabulary, so the review queue, the probability vector and the
 * precision statistics work exactly as for the fallback. Not every provider
 * enforces schemas, so the parsed output is always validated here as well.
 *
 * Any failure — no key, timeout, refusal, rate limit, malformed output —
 * throws `VisionEngineError`; `ai-inference` then reports the MobileNetV2
 * result instead and says why.
 */

const { z } = require('zod');
const llmProvider = require('./llm-provider.service');

/** Per request. One retry and one repair round fit inside the overall deadline. */
const REQUEST_TIMEOUT_MS = 25_000;
/** The browser gives up on an analysis after 60 s. */
const DEADLINE_MS = 55_000;
const SEVERITIES = ['low', 'medium', 'high', 'critical'];

class VisionEngineError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = 'VisionEngineError';
    if (cause) this.cause = cause;
  }
}

/** True when a language model should identify images. */
const isEnabled = () => llmProvider.isEnabled();

const SYSTEM_PROMPT = `You identify animals from photographs for the Park Ecosystem Portal, a portal used by the officers who manage public parks in Bengaluru, India. Your answer is stored as a finding that a park officer reviews before anyone acts on it.

Identify what is actually visible. Name species as precisely as the photograph supports — to species or subspecies when the diagnostic features are clear (for example "Indian pond heron", Ardeola grayii; "Bengal tiger", Panthera tigris tigris), otherwise to genus or family — and give an honest confidence. Prefer species that occur in South India when the photograph is consistent with them, but never force a local species onto a photograph that shows something else.

Recommended actions are for a Bengaluru park team: practical, specific and safe — for example log the sighting, keep visitors at a distance, call the wildlife rescue helpline for a snake on a path or an injured animal, or notify animal control about strays. One to three sentences.

Severity is operational: low for a routine sighting, medium for an animal that needs managing (a snake near people, stray dogs) or that looks unwell, high for an injured or dead animal or one that endangers visitors, critical only when people are in immediate danger.`;

/**
 * The structured-output schema. `label` is restricted to the task's own
 * labels, so the result always maps onto the review vocabulary.
 */
function outputSchema(labels) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['label_probabilities', 'species', 'severity', 'recommended_action', 'caveat'],
    properties: {
      label_probabilities: {
        type: 'array',
        description: 'Your probability for every label of the task; together they sum to 1.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['label', 'probability'],
          properties: {
            label: { type: 'string', enum: labels },
            probability: { type: 'number', description: 'Between 0 and 1.' },
          },
        },
      },
      species: {
        type: 'object',
        additionalProperties: false,
        required: ['common_name', 'scientific_name', 'confidence'],
        description: 'The main animal in the photograph. Empty names and confidence 0 when none is visible.',
        properties: {
          common_name: { type: 'string' },
          scientific_name: { type: 'string' },
          confidence: { type: 'number', description: 'Between 0 and 1.' },
        },
      },
      severity: { type: 'string', enum: SEVERITIES },
      recommended_action: { type: 'string' },
      caveat: { type: 'string', description: 'One sentence on what limits certainty, or empty.' },
    },
  };
}

/** Validation of the parsed output: the shape (some providers ignore the schema) and the ranges. */
const OutputSchema = z.object({
  label_probabilities: z.array(z.object({ label: z.string(), probability: z.number() })).min(1),
  species: z.object({ common_name: z.string(), scientific_name: z.string(), confidence: z.number() }),
  severity: z.enum(SEVERITIES),
  recommended_action: z.string(),
  caveat: z.string(),
});

const clamp01 = (x) => Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0));
const round = (x, dp = 4) => Math.round(x * 10 ** dp) / 10 ** dp;

/**
 * The text of the user turn (the image goes alongside it): the task, its
 * labels and the evidence the local model measured (offered as a hint, not
 * as ground truth).
 *
 * @param {{title:string, brief:string, labels:{label:string, hint:string}[], evidence:string}} input
 */
function buildPrompt({ title, brief, labels, evidence }) {
  return [
    `Task: ${title}. ${brief}`,
    '',
    'Labels (give a probability for every one):',
    ...labels.map(({ label, hint }) => `- ${label}${hint ? ` — ${hint}` : ''}`),
    '',
    'Output of a separate image classifier (it can be wrong; use it only as a hint):',
    evidence,
  ].join('\n');
}

/**
 * Validate and normalise the model's parsed JSON.
 *
 * @param {string[]} labels the task's labels
 * @param {unknown} raw the parsed reply
 * @param {string} [model] the model that produced it
 * @throws {VisionEngineError} when the output does not match the schema
 */
function parseOutput(labels, raw, model = '') {
  const checked = OutputSchema.safeParse(raw);
  if (!checked.success) {
    const issue = checked.error.issues[0];
    throw new VisionEngineError(`${issue?.path?.join('.') || 'output'}: ${issue?.message}`);
  }
  const out = checked.data;

  // Every label of the task appears exactly once; unknown labels are dropped.
  const mass = new Map(labels.map((label) => [label, 0]));
  for (const { label, probability } of out.label_probabilities) {
    if (mass.has(label)) mass.set(label, mass.get(label) + clamp01(probability));
  }
  const total = [...mass.values()].reduce((a, b) => a + b, 0);
  if (!(total > 0)) throw new VisionEngineError("no probability was given to any of the task's labels");

  // Stable sort: on a tie the earlier label in the task's order wins.
  const probabilities = [...mass.entries()]
    .map(([label, p]) => ({ label, probability: round(p / total) }))
    .sort((a, b) => b.probability - a.probability);

  const common = out.species.common_name.trim();
  const scientific = out.species.scientific_name.trim();

  return {
    probabilities,
    species: common || scientific
      ? { common: common || scientific, scientific, confidence: round(clamp01(out.species.confidence) * 100, 1) }
      : null,
    severity: out.severity,
    recommendedAction: out.recommended_action.trim(),
    caveat: out.caveat.trim(),
    model,
  };
}

/**
 * Identify one image.
 *
 * @param {{task:string, title:string, brief:string, labels:{label:string, hint:string}[], jpeg:Buffer, evidence:string}} input
 * @returns {Promise<ReturnType<typeof parseOutput> & {provider:string, providerLabel:string}>}
 * @throws {VisionEngineError}
 */
async function identify(input) {
  const provider = llmProvider.getProvider();
  if (!provider) throw new VisionEngineError(llmProvider.disabledReason());

  const labels = input.labels.map((l) => l.label);
  const validate = (raw) => {
    try {
      parseOutput(labels, raw);
      return null;
    } catch (err) {
      return err.message;
    }
  };

  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), DEADLINE_MS);
  try {
    const { data, model } = await provider.generateJson({
      system: SYSTEM_PROMPT,
      text: buildPrompt(input),
      imageBase64: input.jpeg.toString('base64'),
      schema: outputSchema(labels),
      schemaName: 'park_image_finding',
      validate,
      timeoutMs: REQUEST_TIMEOUT_MS,
      signal: deadline.signal,
    });
    return {
      ...parseOutput(labels, data, model || provider.visionModel),
      provider: provider.name,
      providerLabel: provider.label,
    };
  } catch (err) {
    if (err instanceof VisionEngineError) throw err;
    const message = deadline.signal.aborted ? `no answer within ${DEADLINE_MS / 1000} s` : err?.message || 'an unknown error';
    throw new VisionEngineError(message, { cause: err });
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  identify,
  isEnabled,
  parseOutput,
  buildPrompt,
  outputSchema,
  VisionEngineError,
  SYSTEM_PROMPT,
  /** The active vision model id, or null. */
  modelId: () => llmProvider.getProvider()?.visionModel ?? null,
  /** { name, label } of the active provider, or null. */
  providerInfo: () => {
    const p = llmProvider.getProvider();
    return p ? { name: p.name, label: p.label } : null;
  },
};

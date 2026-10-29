'use strict';

/**
 * The language-model provider layer.
 *
 * The Eco Assistant (tool use) and AI Monitoring (vision with a JSON schema)
 * talk to "a language model" through this module, never to a vendor SDK
 * directly, so the same code runs on:
 *
 *   gemini             Google AI Studio (GEMINI_API_KEY) — free tier, the recommended default
 *   groq               Groq (GROQ_API_KEY) — free tier, open-weight models
 *   openai-compatible  any OpenAI-style server (LLM_BASE_URL, LLM_API_KEY): Ollama, OpenRouter, LM Studio…
 *   anthropic          Claude through the Anthropic SDK (ANTHROPIC_API_KEY)
 *
 * The first three speak the OpenAI Chat Completions wire format, reached with
 * the global `fetch` (Node ≥ 18) — no extra dependencies.
 *
 * Selection: LLM_PROVIDER when set, otherwise the first key present in the
 * order above; with none, `getProvider()` is null and callers use their
 * built-in fallback engines. ASSISTANT_MODEL and VISION_MODEL override the
 * models of whichever provider is active.
 *
 * A provider exposes:
 *   chat({ system, messages, tools, maxTokens, signal })
 *       → { text, toolCalls: [{ id, name, input }], stopReason, message }
 *     stopReason is 'end' | 'tool_use' | 'max_tokens' | 'refusal'; `message`
 *     is the assistant turn in the provider's own shape, to be appended to
 *     `messages` as-is (it carries provider data such as Gemini's thought
 *     signatures that must be sent back).
 *   toolResultMessages([{ id, name, content, isError }]) → messages to append
 *   generateJson({ system, text, imageBase64, schema, schemaName, validate, maxTokens, signal })
 *       → { data, model }
 *     The reply is parsed and passed to `validate` (which returns a problem
 *     string or null) — providers that ignore the schema are caught here. One
 *     repair round is attempted; after that an `LlmError` is thrown so the
 *     caller can fall back.
 *
 * Transport: every request has a timeout (AbortController), and HTTP 429,
 * 5xx, timeouts and network failures are retried once after a short backoff
 * (honouring Retry-After, capped).
 */

const env = require('../config/env');

/** Defaults per provider. Model ids were checked against the providers' docs (Oct 2026). */
const PROVIDERS = {
  gemini: {
    label: 'Gemini',
    keyName: 'GEMINI_API_KEY',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    // Free of charge on the AI Studio free tier, recommended by Google for new
    // projects and quick (~1.5 s) — gemini-3.8-flash is stronger but was slow or
    // overloaded on the free tier when tested; set VISION_MODEL to try it.
    chatModel: 'gemini-3.5-flash-lite',
    visionModel: 'gemini-3.5-flash-lite',
  },
  groq: {
    label: 'Groq',
    keyName: 'GROQ_API_KEY',
    baseUrl: 'https://api.groq.com/openai/v1',
    // Production model with tool use; the vision model accepts images and JSON schemas.
    chatModel: 'llama-3.3-70b-versatile',
    visionModel: 'qwen/qwen3.8-27b',
  },
  'openai-compatible': {
    label: 'Local model',
    keyName: 'LLM_BASE_URL',
    baseUrl: '',
    // Ollama model names; set ASSISTANT_MODEL / VISION_MODEL for other servers.
    chatModel: 'llama3.2',
    visionModel: 'llama3.2-vision',
  },
  anthropic: {
    label: 'Claude',
    keyName: 'ANTHROPIC_API_KEY',
    baseUrl: '',
    chatModel: 'claude-opus-5-5',
    visionModel: 'claude-opus-5-5',
  },
};

/** Auto-detection order when LLM_PROVIDER is blank. */
const DETECTION_ORDER = ['gemini', 'groq', 'openai-compatible', 'anthropic'];

/** Friendly spellings accepted in LLM_PROVIDER. */
const ALIASES = {
  google: 'gemini',
  'google-ai': 'gemini',
  claude: 'anthropic',
  openai: 'openai-compatible',
  ollama: 'openai-compatible',
  openrouter: 'openai-compatible',
  local: 'openai-compatible',
};

/** Base URLs used when LLM_PROVIDER names a well-known server and LLM_BASE_URL is blank. */
const KNOWN_BASE_URLS = {
  ollama: 'http://localhost:11434/v1',
  openrouter: 'https://openrouter.ai/api/v1',
};

const FREE_KEY_HINT = 'set GEMINI_API_KEY (free at https://aistudio.google.com/apikey)';

/** Models that accept Anthropic's server-side refusal fallback. */
const ANTHROPIC_FALLBACK_CAPABLE = /^claude-(opus-5|fable-5|sonnet-5-5)/;

const timing = { timeoutMs: 30_000, retryDelayMs: 1_000, maxRetryDelayMs: 8_000 };

class LlmError extends Error {
  constructor(message, { status, cause } = {}) {
    super(message);
    this.name = 'LlmError';
    if (status) this.status = status;
    if (cause) this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/**
 * Work out which provider the configuration asks for.
 *
 * @param {object} [e] the env object (tests pass their own)
 * @returns {{config: object|null, reason: string}} `reason` explains a null config
 */
function selectProvider(e = env) {
  const keys = {
    gemini: e.geminiApiKey,
    groq: e.groqApiKey,
    'openai-compatible': e.llmBaseUrl,
    anthropic: e.anthropicApiKey,
  };
  const requested = String(e.llmProvider || '').trim().toLowerCase();

  if (['none', 'off', 'disabled', 'false'].includes(requested)) {
    return { config: null, reason: `LLM_PROVIDER is '${requested}', so the built-in engines answer` };
  }

  let name = requested ? ALIASES[requested] || requested : DETECTION_ORDER.find((n) => keys[n]);
  if (!name) {
    return { config: null, reason: `no language-model API key is set — ${FREE_KEY_HINT}` };
  }
  const defaults = PROVIDERS[name];
  if (!defaults) {
    return { config: null, reason: `LLM_PROVIDER '${requested}' is not one of ${Object.keys(PROVIDERS).join(', ')}` };
  }

  let baseUrl = defaults.baseUrl;
  if (name === 'openai-compatible') {
    baseUrl = String(e.llmBaseUrl || KNOWN_BASE_URLS[requested] || '').trim().replace(/\/+$/, '');
    if (!baseUrl) return { config: null, reason: `LLM_PROVIDER is '${requested}' but LLM_BASE_URL is not set` };
  } else if (!keys[name]) {
    return { config: null, reason: `LLM_PROVIDER is '${requested}' but ${defaults.keyName} is not set` };
  }

  const openRouter = /openrouter\.ai/i.test(baseUrl);
  let label = defaults.label;
  if (name === 'openai-compatible') label = openRouter ? 'OpenRouter' : /api\.openai\.com/i.test(baseUrl) ? 'OpenAI' : 'Local model';

  const chatDefault = openRouter ? 'openrouter/auto' : defaults.chatModel;
  const visionDefault = openRouter ? 'openrouter/auto' : defaults.visionModel;
  const assistantModel = String(e.assistantModel || '').trim();
  const visionModel = String(e.visionModel || '').trim();

  return {
    config: {
      name,
      label,
      baseUrl,
      apiKey: name === 'openai-compatible' ? String(e.llmApiKey || '').trim() : keys[name],
      chatModel: assistantModel || chatDefault,
      // Every Claude model reads images, so ASSISTANT_MODEL also applies to vision there;
      // elsewhere a chat model may be text-only, so the vision default stands.
      visionModel: visionModel || (name === 'anthropic' && assistantModel) || visionDefault,
    },
    reason: '',
  };
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

let fetchImpl = (...args) => globalThis.fetch(...args);

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new LlmError('the request was cancelled'));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new LlmError('the request was cancelled'));
    }, { once: true });
  });

/** Seconds (or an HTTP date) from Retry-After, as a capped delay in ms. */
function retryDelay(header) {
  let ms = timing.retryDelayMs;
  if (header) {
    const seconds = Number(header);
    const at = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
    if (Number.isFinite(at) && at > 0) ms = at;
  }
  return Math.min(ms, timing.maxRetryDelayMs);
}

/** The message inside an OpenAI-style (or Gemini array-wrapped) error body. */
function errorDetail(text) {
  try {
    const body = JSON.parse(text);
    const error = (Array.isArray(body) ? body[0] : body)?.error;
    return String(error?.message || error || '').slice(0, 300);
  } catch {
    return String(text || '').slice(0, 300);
  }
}

function describeStatus(status, label, detail) {
  const suffix = detail ? ` (${detail})` : '';
  if (status === 400) return `the ${label} API rejected the request${suffix}`;
  if (status === 401) return `the ${label} API key was rejected`;
  if (status === 403) return `the ${label} API key may not use this model${suffix}`;
  if (status === 404) return `the ${label} model was not found${suffix}`;
  if (status === 429) return `the ${label} rate limit or free-tier quota was reached`;
  return `the ${label} API responded ${status}${suffix}`;
}

/**
 * POST JSON with a timeout, retrying once on 429, 5xx, a timeout or a network
 * failure. Throws `LlmError`.
 */
async function postJson(url, body, { apiKey, label, signal, timeoutMs = timing.timeoutMs }) {
  const headers = { 'content-type': 'application/json', accept: 'application/json' };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  for (let attempt = 0; ; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });

    let outcome; // { error, retry, delay }
    try {
      const res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
      const text = await res.text();
      if (res.ok) {
        try {
          return JSON.parse(text);
        } catch {
          outcome = { error: new LlmError(`the ${label} API returned a response that is not JSON`), retry: false };
        }
      } else {
        outcome = {
          error: new LlmError(describeStatus(res.status, label, errorDetail(text)), { status: res.status }),
          retry: res.status === 429 || res.status >= 500,
          delay: retryDelay(res.headers?.get?.('retry-after')),
        };
      }
    } catch (err) {
      if (signal?.aborted) throw new LlmError('the request was cancelled', { cause: err });
      const error = controller.signal.aborted
        ? new LlmError(`the ${label} request timed out after ${Math.round(timeoutMs / 1000)} s`, { cause: err })
        : new LlmError(`the ${label} API could not be reached`, { cause: err });
      outcome = { error, retry: true, delay: timing.retryDelayMs };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }

    if (!outcome.retry || attempt >= 1) throw outcome.error;
    await sleep(outcome.delay, signal);
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** `system` may be a string or [{ text, cache? }]; OpenAI-style servers get one string. */
const systemText = (system) =>
  Array.isArray(system) ? system.map((p) => (typeof p === 'string' ? p : p.text)).filter(Boolean).join('\n\n') : String(system || '');

/** Reasoning models (Qwen, DeepSeek…) on some servers prefix their reply with a <think> block. */
const stripThinking = (text) => String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

/**
 * Parse a JSON object out of a model reply: tolerates code fences, a
 * <think> block or prose around the object.
 *
 * @returns {{ok: true, value: any} | {ok: false}}
 */
function extractJson(text) {
  const cleaned = stripThinking(text).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const candidates = [cleaned];
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(cleaned.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === 'object') return { ok: true, value };
    } catch {
      // try the next candidate
    }
  }
  return { ok: false };
}

/**
 * Gemini's OpenAI layer translates schemas into its own subset, which has
 * historically rejected `additionalProperties`. Our own validation enforces
 * the shape anyway, so the keyword is dropped for Gemini.
 */
function stripAdditionalProperties(schema) {
  if (Array.isArray(schema)) return schema.map(stripAdditionalProperties);
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key !== 'additionalProperties') out[key] = stripAdditionalProperties(value);
  }
  return out;
}

/**
 * Ask for JSON, check it, and give the model one chance to repair it.
 * Shared by every provider; each supplies `complete(request)` → { text, stopReason, model }.
 */
async function generateJson(provider, request) {
  let reply = await provider.complete(request);
  for (let attempt = 0; ; attempt += 1) {
    if (reply.stopReason === 'refusal') throw new LlmError(`${provider.label} declined to analyse this image`);
    if (reply.stopReason === 'max_tokens') throw new LlmError(`${provider.label} ran out of output tokens before finishing`);

    const parsed = extractJson(reply.text);
    const problem = parsed.ok ? (request.validate ? request.validate(parsed.value) : null) : 'it is not valid JSON';
    if (!problem) return { data: parsed.value, model: reply.model };
    if (attempt >= 1) {
      throw new LlmError(`${provider.label} returned output that ${parsed.ok ? `does not match the schema (${problem})` : 'is not JSON'}`);
    }
    reply = await provider.complete({ ...request, repair: { previous: reply.text, problem } });
  }
}

const repairInstruction = (problem) =>
  `That reply could not be used: ${problem}. Reply again with only the corrected JSON object, exactly matching the schema — no prose and no code fences.`;

// ---------------------------------------------------------------------------
// OpenAI Chat Completions (Gemini, Groq, Ollama, OpenRouter…)
// ---------------------------------------------------------------------------

function openAiCompatible(config) {
  const url = `${config.baseUrl}/chat/completions`;
  const gemini = config.name === 'gemini';
  const schemaFor = gemini ? stripAdditionalProperties : (s) => s;
  // Gemini thinks by default; low effort keeps latency and free-tier quota down.
  const extra = gemini ? { reasoning_effort: 'low' } : {};
  const send = (body, signal, timeoutMs) => postJson(url, body, { apiKey: config.apiKey, label: config.label, signal, timeoutMs });
  // Set once the server has rejected `json_schema`; later calls go straight to JSON mode.
  let schemaUnsupported = false;

  const toTool = ({ name, description, input_schema: parameters }) => ({
    type: 'function',
    function: { name, description, parameters: schemaFor(parameters || { type: 'object', properties: {} }) },
  });

  const textOf = (content) =>
    stripThinking(Array.isArray(content) ? content.map((p) => p?.text || '').join('') : content);

  const parseArguments = (args) => {
    if (args && typeof args === 'object') return args;
    try {
      const value = JSON.parse(args || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch {
      return {};
    }
  };

  async function chat({ system, messages, tools = [], maxTokens = 8192, signal }) {
    const json = await send({
      model: config.chatModel,
      max_tokens: maxTokens,
      messages: [{ role: 'system', content: systemText(system) }, ...messages],
      ...(tools.length ? { tools: tools.map(toTool), tool_choice: 'auto' } : {}),
      ...extra,
    }, signal);

    const choice = json?.choices?.[0];
    if (!choice) throw new LlmError(`the ${config.label} API returned no answer`);
    const msg = choice.message || {};
    const rawCalls = (msg.tool_calls || []).filter((t) => t?.function?.name);
    // Keep each call whole (Gemini attaches `extra_content.google.thought_signature`,
    // which must be echoed back); only make sure it has an id.
    const calls = rawCalls.map((t, i) => ({ ...t, type: 'function', id: t.id || `call_${i + 1}` }));
    const toolCalls = calls.map((t) => ({ id: t.id, name: t.function.name, input: parseArguments(t.function.arguments) }));
    const text = textOf(msg.content);

    let stopReason = 'end';
    if (choice.finish_reason === 'length') stopReason = 'max_tokens';
    else if (toolCalls.length) stopReason = 'tool_use';
    else if (choice.finish_reason === 'content_filter' || msg.refusal) stopReason = 'refusal';

    const message = { role: 'assistant' };
    // `content` may be omitted on a turn that only calls tools.
    if (msg.content || !calls.length) message.content = msg.content || '';
    if (calls.length) message.tool_calls = calls;

    return { text, toolCalls, stopReason, message, model: json.model || config.chatModel };
  }

  const toolResultMessages = (results) =>
    results.map((r) => ({
      role: 'tool',
      tool_call_id: r.id,
      name: r.name,
      content: r.isError ? `Error: ${r.content}` : r.content,
    }));

  /** One JSON-producing call: json_schema first, JSON mode if the server rejects schemas. */
  async function complete({ system, text, imageBase64, schema, schemaName = 'result', maxTokens = 8192, signal, repair, timeoutMs }) {
    const build = (mode) => {
      const prompt = mode === 'json_schema'
        ? text
        : `${text}\n\nReply with a single JSON object that matches this JSON Schema:\n${JSON.stringify(schema)}`;
      const messages = [
        { role: 'system', content: systemText(system) },
        {
          role: 'user',
          content: [
            ...(imageBase64 ? [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }] : []),
            { type: 'text', text: prompt },
          ],
        },
      ];
      if (repair) {
        messages.push({ role: 'assistant', content: String(repair.previous || '') });
        messages.push({ role: 'user', content: repairInstruction(repair.problem) });
      }
      return {
        model: config.visionModel,
        max_tokens: maxTokens,
        messages,
        response_format: mode === 'json_schema'
          ? { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema: schemaFor(schema) } }
          : { type: 'json_object' },
        ...extra,
      };
    };

    let json;
    if (!schemaUnsupported) {
      try {
        json = await send(build('json_schema'), signal, timeoutMs);
      } catch (err) {
        if (err.status !== 400) throw err;
        schemaUnsupported = true; // this server or model does not take JSON schemas
      }
    }
    if (!json) json = await send(build('json_object'), signal, timeoutMs);

    const choice = json?.choices?.[0];
    if (!choice) throw new LlmError(`the ${config.label} API returned no answer`);
    const msg = choice.message || {};
    let stopReason = 'end';
    if (choice.finish_reason === 'length') stopReason = 'max_tokens';
    else if (choice.finish_reason === 'content_filter' || (msg.refusal && !msg.content)) stopReason = 'refusal';
    return { text: textOf(msg.content), stopReason, model: json.model || config.visionModel };
  }

  const provider = { ...publicInfo(config), chat, toolResultMessages, complete };
  provider.generateJson = (request) => generateJson(provider, request);
  return provider;
}

// ---------------------------------------------------------------------------
// Anthropic (Claude) through the official SDK
// ---------------------------------------------------------------------------

function anthropic(config, injectedClient) {
  let client = injectedClient || null;
  const getClient = () => {
    if (!client) {
      const Anthropic = require('@anthropic-ai/sdk').default;
      client = new Anthropic({ apiKey: config.apiKey, maxRetries: 1, timeout: timing.timeoutMs });
    }
    return client;
  };
  const fallback = (model) =>
    ANTHROPIC_FALLBACK_CAPABLE.test(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {};

  /** A short, user-facing reason for an SDK failure. */
  function wrap(err) {
    if (err instanceof LlmError) return err;
    const status = err?.status;
    let message = err?.message || 'an unknown error';
    if (err?.name === 'APIConnectionTimeoutError') message = `the Claude request timed out after ${timing.timeoutMs / 1000} s`;
    else if (err?.name === 'APIConnectionError') message = 'the Claude API could not be reached';
    else if (status) message = describeStatus(status, 'Claude', err.message);
    return new LlmError(message, { status, cause: err });
  }

  const systemBlocks = (system) =>
    Array.isArray(system)
      ? system.map((p) => (typeof p === 'string' ? { type: 'text', text: p } : { type: 'text', text: p.text, ...(p.cache ? { cache_control: { type: 'ephemeral' } } : {}) }))
      : system;

  async function chat({ system, messages, tools = [], maxTokens = 16000, signal }) {
    let response;
    try {
      response = await getClient().beta.messages.create({
        model: config.chatModel,
        max_tokens: maxTokens,
        output_config: { effort: 'low' },
        // On a safety decline the API re-runs the request on a suitable model.
        ...fallback(config.chatModel),
        system: systemBlocks(system),
        tools,
        messages,
      }, signal ? { signal } : undefined);
    } catch (err) {
      throw wrap(err);
    }
    const content = response.content || [];
    const toolCalls = content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, input: b.input || {} }));
    const text = content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    const stopReason = { refusal: 'refusal', max_tokens: 'max_tokens' }[response.stop_reason]
      || (response.stop_reason === 'tool_use' && toolCalls.length ? 'tool_use' : 'end');
    // The full content (thinking blocks included) goes back on the next round.
    return { text, toolCalls, stopReason, message: { role: 'assistant', content }, model: response.model || config.chatModel };
  }

  // All results go back in one user message so parallel calls keep working.
  const toolResultMessages = (results) => [{
    role: 'user',
    content: results.map((r) => ({
      type: 'tool_result',
      tool_use_id: r.id,
      content: r.content,
      ...(r.isError ? { is_error: true } : {}),
    })),
  }];

  async function complete({ system, text, imageBase64, schema, maxTokens = 16000, signal, repair }) {
    const messages = [{
      role: 'user',
      content: [
        ...(imageBase64 ? [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } }] : []),
        { type: 'text', text },
      ],
    }];
    if (repair) {
      messages.push({ role: 'assistant', content: String(repair.previous || '') || '{}' });
      messages.push({ role: 'user', content: repairInstruction(repair.problem) });
    }
    let response;
    try {
      response = await getClient().beta.messages.create({
        model: config.visionModel,
        max_tokens: maxTokens,
        output_config: { effort: 'low', format: { type: 'json_schema', schema } },
        ...fallback(config.visionModel),
        system: systemText(system),
        messages,
      }, signal ? { signal } : undefined);
    } catch (err) {
      throw wrap(err);
    }
    const out = (response?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    const stopReason = { refusal: 'refusal', max_tokens: 'max_tokens' }[response?.stop_reason] || 'end';
    return { text: out, stopReason, model: response?.model || config.visionModel };
  }

  const provider = { ...publicInfo(config), chat, toolResultMessages, complete };
  provider.generateJson = (request) => generateJson(provider, request);
  return provider;
}

// ---------------------------------------------------------------------------
// The active provider
// ---------------------------------------------------------------------------

const publicInfo = (config) => ({
  name: config.name,
  label: config.label,
  chatModel: config.chatModel,
  visionModel: config.visionModel,
  baseUrl: config.baseUrl,
});

/**
 * Build a provider from a resolved config.
 *
 * @param {object} config from `selectProvider`
 * @param {{anthropicClient?: object}} [options]
 */
function createProvider(config, { anthropicClient } = {}) {
  if (!config) return null;
  return config.name === 'anthropic' ? anthropic(config, anthropicClient) : openAiCompatible(config);
}

let active; // undefined until first use; null when no provider is configured
let activeReason = '';
let injected = false;

function resolve() {
  if (active === undefined) {
    const { config, reason } = selectProvider(env);
    active = createProvider(config);
    activeReason = reason;
  }
  return active;
}

/** The configured provider, or null. Not used under NODE_ENV=test unless a test configured one. */
const getProvider = () => {
  const provider = resolve();
  return provider && (injected || !env.isTest) ? provider : null;
};

/** True when a language model should answer. */
const isEnabled = () => Boolean(getProvider());

/** Why no provider is active (for logs and the UI). */
const disabledReason = () => {
  if (getProvider()) return '';
  if (resolve() && env.isTest) return 'language models are switched off under NODE_ENV=test';
  return activeReason || `no language-model API key is set — ${FREE_KEY_HINT}`;
};

/** { name, label, chatModel, visionModel } of the active provider, or null. */
const describe = () => {
  const provider = getProvider();
  return provider ? { name: provider.name, label: provider.label, chatModel: provider.chatModel, visionModel: provider.visionModel } : null;
};

/**
 * Test seam. `_configure({ env: {...}, fetch, anthropicClient, timing })`
 * selects a provider from the given settings even under NODE_ENV=test;
 * `_configure(null)` restores the real configuration.
 */
function _configure(options) {
  if (!options) {
    active = undefined;
    activeReason = '';
    injected = false;
    fetchImpl = (...args) => globalThis.fetch(...args);
    Object.assign(timing, { timeoutMs: 30_000, retryDelayMs: 1_000, maxRetryDelayMs: 8_000 });
    return null;
  }
  if (options.fetch) fetchImpl = options.fetch;
  if (options.timing) Object.assign(timing, options.timing);
  const { config, reason } = selectProvider({ ...env, ...(options.env || {}) });
  active = createProvider(config, { anthropicClient: options.anthropicClient });
  activeReason = reason;
  injected = true;
  return active;
}

module.exports = {
  PROVIDERS,
  DETECTION_ORDER,
  FREE_KEY_HINT,
  LlmError,
  selectProvider,
  createProvider,
  getProvider,
  isEnabled,
  disabledReason,
  describe,
  extractJson,
  generateJson,
  _configure,
};

'use strict';

/**
 * The provider layer: which provider the configuration selects, the
 * OpenAI-compatible wire format, retries and timeouts — all against a mocked
 * `fetch`, so no API key or network connection is needed.
 */

process.env.NODE_ENV = 'test'; // never use a real key from backend/.env
process.env.LOG_LEVEL = 'silent';

const test = require('node:test');
const assert = require('node:assert/strict');

const llmProvider = require('../../src/services/llm-provider.service');
const { fakeFetch, chatReply, toolCall } = require('../helpers/fake-llm');

const { selectProvider, createProvider } = llmProvider;

/** An env with no LLM settings, plus the given overrides. */
const blank = (overrides = {}) => ({
  llmProvider: '', geminiApiKey: '', groqApiKey: '', llmBaseUrl: '', llmApiKey: '', anthropicApiKey: '',
  assistantModel: '', visionModel: '', ...overrides,
});

const TIMING = { retryDelayMs: 1, maxRetryDelayMs: 5 };
const configure = (env, fetch, timing = TIMING) => llmProvider._configure({ env: blank(env), fetch, timing });

test.afterEach(() => llmProvider._configure(null));

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

test('no key → no provider, and the reason points at the free Gemini key', () => {
  const { config, reason } = selectProvider(blank());
  assert.equal(config, null);
  assert.match(reason, /GEMINI_API_KEY/);
  assert.match(reason, /aistudio\.google\.com\/apikey/);
});

test('auto-detection follows the key that is present, Gemini first', () => {
  assert.equal(selectProvider(blank({ geminiApiKey: 'g' })).config.name, 'gemini');
  assert.equal(selectProvider(blank({ groqApiKey: 'q' })).config.name, 'groq');
  assert.equal(selectProvider(blank({ llmBaseUrl: 'http://localhost:11434/v1' })).config.name, 'openai-compatible');
  assert.equal(selectProvider(blank({ anthropicApiKey: 'a' })).config.name, 'anthropic');
  assert.equal(selectProvider(blank({ anthropicApiKey: 'a', groqApiKey: 'q', geminiApiKey: 'g' })).config.name, 'gemini');
  assert.equal(selectProvider(blank({ anthropicApiKey: 'a', groqApiKey: 'q' })).config.name, 'groq');
});

test('LLM_PROVIDER wins over auto-detection, and needs its own key', () => {
  assert.equal(selectProvider(blank({ llmProvider: 'groq', geminiApiKey: 'g', groqApiKey: 'q' })).config.name, 'groq');
  assert.equal(selectProvider(blank({ llmProvider: 'claude', anthropicApiKey: 'a', geminiApiKey: 'g' })).config.name, 'anthropic');

  const missing = selectProvider(blank({ llmProvider: 'groq', geminiApiKey: 'g' }));
  assert.equal(missing.config, null);
  assert.match(missing.reason, /GROQ_API_KEY is not set/);

  const off = selectProvider(blank({ llmProvider: 'none', geminiApiKey: 'g' }));
  assert.equal(off.config, null);
  assert.match(off.reason, /built-in/);

  assert.match(selectProvider(blank({ llmProvider: 'mystery' })).reason, /not one of/);
});

test('provider defaults: endpoints, labels and models', () => {
  const g = selectProvider(blank({ geminiApiKey: 'g' })).config;
  assert.equal(g.baseUrl, 'https://generativelanguage.googleapis.com/v1beta/openai');
  assert.equal(g.label, 'Gemini');
  assert.equal(g.apiKey, 'g');
  assert.equal(g.chatModel, 'gemini-3.5-flash-lite');
  assert.equal(g.visionModel, 'gemini-3.5-flash-lite');

  const q = selectProvider(blank({ groqApiKey: 'q' })).config;
  assert.equal(q.baseUrl, 'https://api.groq.com/openai/v1');
  assert.equal(q.chatModel, 'llama-3.3-70b-versatile');
  assert.equal(q.visionModel, 'qwen/qwen3.8-27b');

  const ollama = selectProvider(blank({ llmProvider: 'ollama' })).config;
  assert.equal(ollama.name, 'openai-compatible');
  assert.equal(ollama.baseUrl, 'http://localhost:11434/v1');
  assert.equal(ollama.label, 'Local model');
  assert.equal(ollama.apiKey, '');

  const router = selectProvider(blank({ llmBaseUrl: 'https://openrouter.ai/api/v1/', llmApiKey: 'or' })).config;
  assert.equal(router.label, 'OpenRouter');
  assert.equal(router.baseUrl, 'https://openrouter.ai/api/v1');
  assert.equal(router.apiKey, 'or');
});

test('ASSISTANT_MODEL and VISION_MODEL override whichever provider is active', () => {
  const g = selectProvider(blank({ geminiApiKey: 'g', assistantModel: 'gemini-2.5-flash', visionModel: 'gemini-3.8-flash' })).config;
  assert.equal(g.chatModel, 'gemini-2.5-flash');
  assert.equal(g.visionModel, 'gemini-3.8-flash');
  // A text-only chat model must not become the vision model…
  assert.equal(selectProvider(blank({ groqApiKey: 'q', assistantModel: 'llama-3.1-8b-instant' })).config.visionModel, 'qwen/qwen3.8-27b');
  // …but every Claude model reads images, as before.
  assert.equal(selectProvider(blank({ anthropicApiKey: 'a', assistantModel: 'claude-x' })).config.visionModel, 'claude-x');
});

test('the active provider is off under NODE_ENV=test unless a test configures one', () => {
  assert.equal(llmProvider.isEnabled(), false);
  assert.equal(llmProvider.describe(), null);
  configure({ geminiApiKey: 'g' }, fakeFetch([]));
  assert.deepEqual(llmProvider.describe(), { name: 'gemini', label: 'Gemini', chatModel: 'gemini-3.5-flash-lite', visionModel: 'gemini-3.5-flash-lite' });
});

// ---------------------------------------------------------------------------
// Wire format
// ---------------------------------------------------------------------------

test('chat: system, tools and tool calls in the OpenAI shape; results go back as tool messages', async () => {
  const fetch = fakeFetch([chatReply('Checking.', { toolCalls: [toolCall('c1', 'get_alerts', { park: 'cubbon' })] })]);
  const provider = configure({ groqApiKey: 'gk' }, fetch);

  const reply = await provider.chat({
    system: [{ text: 'stable', cache: true }, { text: 'per user' }],
    messages: [{ role: 'user', content: 'alerts?' }],
    tools: [{ name: 'get_alerts', description: 'Alerts', input_schema: { type: 'object', properties: { park: { type: 'string' } }, additionalProperties: false } }],
  });

  const [{ url, headers, body }] = fetch.calls;
  assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(headers.authorization, 'Bearer gk');
  assert.equal(body.model, 'llama-3.3-70b-versatile');
  assert.deepEqual(body.messages[0], { role: 'system', content: 'stable\n\nper user' });
  assert.deepEqual(body.tools[0], {
    type: 'function',
    function: { name: 'get_alerts', description: 'Alerts', parameters: { type: 'object', properties: { park: { type: 'string' } }, additionalProperties: false } },
  });
  assert.equal(body.reasoning_effort, undefined, 'only Gemini gets reasoning_effort');

  assert.equal(reply.stopReason, 'tool_use');
  assert.equal(reply.text, 'Checking.');
  assert.deepEqual(reply.toolCalls, [{ id: 'c1', name: 'get_alerts', input: { park: 'cubbon' } }]);
  assert.equal(reply.message.role, 'assistant');
  assert.equal(reply.message.tool_calls[0].id, 'c1');

  assert.deepEqual(provider.toolResultMessages([{ id: 'c1', name: 'get_alerts', content: '{"n":1}' }, { id: 'c2', name: 'x', content: 'nope', isError: true }]), [
    { role: 'tool', tool_call_id: 'c1', name: 'get_alerts', content: '{"n":1}' },
    { role: 'tool', tool_call_id: 'c2', name: 'x', content: 'Error: nope' },
  ]);
});

test('chat: Gemini tool schemas drop additionalProperties; missing call ids are filled in', async () => {
  const fetch = fakeFetch([chatReply(null, { toolCalls: [{ type: 'function', function: { name: 'find_parks', arguments: '{}' } }] })]);
  const provider = configure({ geminiApiKey: 'g' }, fetch);
  const reply = await provider.chat({
    system: 's',
    messages: [{ role: 'user', content: 'q' }],
    tools: [{ name: 'find_parks', description: 'd', input_schema: { type: 'object', properties: {}, additionalProperties: false } }],
  });
  assert.deepEqual(fetch.calls[0].body.tools[0].function.parameters, { type: 'object', properties: {} });
  assert.equal(reply.toolCalls[0].id, 'call_1');
  assert.equal(reply.message.tool_calls[0].id, 'call_1');
  assert.equal(reply.message.content, undefined, 'a tool-only turn carries no empty content');
});

test('chat: finish reasons map onto stop reasons; <think> blocks are stripped', async () => {
  const fetch = fakeFetch([
    chatReply('<think>hmm</think>Answer.'),
    chatReply('cut', { finishReason: 'length', toolCalls: [toolCall('t', 'get_alerts')] }),
    chatReply(null, { finishReason: 'content_filter' }),
  ]);
  const provider = configure({ llmBaseUrl: 'http://localhost:11434/v1' }, fetch);
  const a = await provider.chat({ system: 's', messages: [] });
  assert.equal(a.text, 'Answer.');
  assert.equal(a.stopReason, 'end');
  assert.equal((await provider.chat({ system: 's', messages: [] })).stopReason, 'max_tokens', 'a truncated tool call is never run');
  assert.equal((await provider.chat({ system: 's', messages: [] })).stopReason, 'refusal');
  assert.equal(fetch.calls[0].url, 'http://localhost:11434/v1/chat/completions');
  assert.equal(fetch.calls[0].headers.authorization, undefined, 'no key → no Authorization header');
  assert.equal(fetch.calls[0].body.model, 'llama3.2');
});

test('generateJson: image as a data URL, strict json_schema, validated result', async () => {
  const fetch = fakeFetch([chatReply('{"ok": true}', { model: 'gemini-3.5-flash-lite-001' })]);
  const provider = configure({ geminiApiKey: 'g' }, fetch);
  const schema = { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' } } };
  const out = await provider.generateJson({
    system: 'sys', text: 'look', imageBase64: 'QUJD', schema, schemaName: 'probe',
    validate: (v) => (typeof v.ok === 'boolean' ? null : 'ok must be a boolean'),
  });
  assert.deepEqual(out, { data: { ok: true }, model: 'gemini-3.5-flash-lite-001' });
  const { body } = fetch.calls[0];
  assert.deepEqual(body.messages[1].content[0], { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUJD' } });
  assert.deepEqual(body.response_format, {
    type: 'json_schema',
    json_schema: { name: 'probe', strict: true, schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } } },
  });
});

test('generateJson: one repair attempt, then an LlmError the caller can fall back on', async () => {
  const fetch = fakeFetch([chatReply('nope'), chatReply('still nope')]);
  const provider = configure({ geminiApiKey: 'g' }, fetch);
  await assert.rejects(
    provider.generateJson({ system: 's', text: 't', schema: { type: 'object' } }),
    (err) => err instanceof llmProvider.LlmError && /is not JSON/.test(err.message)
  );
  assert.equal(fetch.calls.length, 2);
});

test('extractJson tolerates fences, think blocks and surrounding prose', () => {
  assert.deepEqual(llmProvider.extractJson('```json\n{"a":1}\n```').value, { a: 1 });
  assert.deepEqual(llmProvider.extractJson('<think>x</think> Sure! {"a":2} Hope that helps.').value, { a: 2 });
  assert.equal(llmProvider.extractJson('no json here').ok, false);
  assert.equal(llmProvider.extractJson('42').ok, false, 'a bare number is not an object');
});

// ---------------------------------------------------------------------------
// Transport: retries and timeouts
// ---------------------------------------------------------------------------

test('HTTP 429 is retried once after the Retry-After delay (capped)', async () => {
  const fetch = fakeFetch([
    { status: 429, body: [{ error: { code: 429, message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' } }], headers: { 'retry-after': '30' } },
    chatReply('ok'),
  ]);
  const provider = configure({ geminiApiKey: 'g' }, fetch, { retryDelayMs: 1, maxRetryDelayMs: 20 });
  const started = Date.now();
  const reply = await provider.chat({ system: 's', messages: [] });
  assert.equal(reply.text, 'ok');
  assert.equal(fetch.calls.length, 2);
  assert.ok(Date.now() - started < 1000, 'Retry-After is capped by maxRetryDelayMs');
});

test('a second 429 gives up with a clear quota message; 4xx errors are not retried', async () => {
  const quota = { status: 429, body: { error: { message: 'Quota exceeded' } } };
  const fetch = fakeFetch([quota, quota]);
  const provider = configure({ geminiApiKey: 'g' }, fetch);
  await assert.rejects(provider.chat({ system: 's', messages: [] }), (err) => err.status === 429 && /free-tier quota/.test(err.message));
  assert.equal(fetch.calls.length, 2);

  const auth = fakeFetch([{ status: 400, body: [{ error: { message: 'API key not valid. Please pass a valid API key.' } }] }]);
  const p2 = configure({ geminiApiKey: 'bad' }, auth);
  await assert.rejects(p2.chat({ system: 's', messages: [] }), /Gemini API rejected the request \(API key not valid/);
  assert.equal(auth.calls.length, 1);
});

test('5xx and network failures are retried once', async () => {
  const fetch = fakeFetch([new TypeError('fetch failed'), { status: 500, body: 'oops' }]);
  const provider = configure({ groqApiKey: 'q' }, fetch);
  await assert.rejects(provider.chat({ system: 's', messages: [] }), /Groq API responded 500/);
  assert.equal(fetch.calls.length, 2);

  const recovered = fakeFetch([{ status: 503, body: 'busy' }, chatReply('fine')]);
  assert.equal((await configure({ groqApiKey: 'q' }, recovered).chat({ system: 's', messages: [] })).text, 'fine');
});

test('a hung request is aborted by the timeout, retried, then reported', async () => {
  // Never resolves until its signal aborts.
  const hang = async (url, init) => {
    hang.calls += 1;
    return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  };
  hang.calls = 0;
  const provider = llmProvider._configure({ env: blank({ geminiApiKey: 'g' }), fetch: hang, timing: { timeoutMs: 20, retryDelayMs: 1 } });
  await assert.rejects(provider.chat({ system: 's', messages: [] }), /timed out/);
  assert.equal(hang.calls, 2);
});

test('a caller abort stops at once, without a retry', async () => {
  const controller = new AbortController();
  let calls = 0;
  const fetch = async (url, init) => {
    calls += 1;
    controller.abort();
    if (init.signal.aborted) throw new DOMException('aborted', 'AbortError');
    return new Promise(() => {});
  };
  const provider = llmProvider._configure({ env: blank({ geminiApiKey: 'g' }), fetch, timing: TIMING });
  await assert.rejects(provider.chat({ system: 's', messages: [], signal: controller.signal }), /cancelled/);
  assert.equal(calls, 1);
});

test('createProvider builds an Anthropic provider without touching the network', () => {
  const p = createProvider(selectProvider(blank({ anthropicApiKey: 'a' })).config);
  assert.equal(p.name, 'anthropic');
  assert.equal(p.label, 'Claude');
  assert.equal(typeof p.chat, 'function');
  assert.equal(typeof p.generateJson, 'function');
});

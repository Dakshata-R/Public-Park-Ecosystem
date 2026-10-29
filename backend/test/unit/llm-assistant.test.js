'use strict';

/**
 * The language-model assistant's conversation loop, driven by a mocked
 * transport (OpenAI-compatible fetch for Gemini/Groq, a fake SDK client for
 * Claude), so the suite needs neither a network connection nor an API key.
 */

process.env.NODE_ENV = 'test'; // never use a real key from backend/.env
process.env.LOG_LEVEL = 'silent';

const test = require('node:test');
const assert = require('node:assert/strict');

const llm = require('../../src/services/llm-assistant.service');
const llmProvider = require('../../src/services/llm-provider.service');
const tools = require('../../src/services/assistant-tools.service');
const { fakeFetch, chatReply, toolCall, fakeAnthropic } = require('../helpers/fake-llm');

const TIMING = { retryDelayMs: 1, maxRetryDelayMs: 5 };

/** A Gemini provider over a scripted fetch. */
function gemini(replies) {
  const fetch = fakeFetch(replies);
  const provider = llmProvider._configure({ env: { llmProvider: 'gemini', geminiApiKey: 'test-key' }, fetch, timing: TIMING });
  return { fetch, provider };
}

/** A Claude provider over a fake SDK client. */
function claude(responses) {
  const client = fakeAnthropic(responses);
  const provider = llmProvider._configure({ env: { llmProvider: 'anthropic', anthropicApiKey: 'test-key' }, anthropicClient: client });
  return { client, provider };
}

test.afterEach(() => llmProvider._configure(null));

const OFFICER = {
  access: 'officer',
  user: { id: '64b000000000000000000001', name: 'Priya Nair', role: 'officer' },
  homePark: { _id: '64b0000000000000000000aa', name: 'Lalbagh Botanical Garden', slug: 'lalbagh-botanical-garden' },
};
const CITIZEN = {
  access: 'citizen',
  user: { id: '64b000000000000000000002', name: 'Rohan Shetty', role: 'citizen' },
  homePark: null,
};
const GUEST = { access: 'guest', user: null, homePark: null };

/** Replace a tool handler for one test. */
async function withHandler(name, impl, fn) {
  const original = tools.HANDLERS[name];
  tools.HANDLERS[name] = impl;
  try {
    return await fn();
  } finally {
    tools.HANDLERS[name] = original;
  }
}

// ---------------------------------------------------------------------------
// OpenAI-compatible providers (Gemini, Groq, Ollama…)
// ---------------------------------------------------------------------------

test('looks facts up through a tool, then answers in context (Gemini)', async () => {
  const signature = { google: { thought_signature: 'sig-abc' } };
  const { fetch } = gemini([
    chatReply(null, { toolCalls: [toolCall('call_1', 'find_parks', { query: 'cubbon' }, { extra_content: signature })] }),
    chatReply('Cubbon Park scores **69.5** out of 100.', { model: 'gemini-3.5-flash-lite' }),
  ]);

  await withHandler(
    'find_parks',
    async (input) => {
      assert.deepEqual(input, { query: 'cubbon' }, 'tool arguments are parsed from the JSON string');
      return {
        data: { parks: [{ name: 'Cubbon Park', ecosystemHealth: 69.5 }] },
        citations: [{ label: 'Cubbon Park', entity: 'Park', entityId: 'p1', score: 1 }],
      };
    },
    async () => {
      const history = [
        { role: 'assistant', content: 'Welcome!' }, // a leading assistant turn must be dropped
        { role: 'user', content: 'Which parks do you monitor?' },
        { role: 'assistant', content: 'Six parks in Bengaluru.' },
      ];
      const result = await llm.ask('Which one is healthiest?', history, { context: GUEST });

      assert.equal(result.answer, 'Cubbon Park scores **69.5** out of 100.');
      assert.deepEqual(result.toolsUsed, ['find_parks']);
      assert.equal(result.citations.length, 1);
      assert.equal(result.provider, 'gemini');
      assert.equal(result.providerLabel, 'Gemini');
      assert.equal(result.model, 'gemini-3.5-flash-lite');

      const [first, second] = fetch.calls.map((c) => c.body);
      assert.equal(fetch.calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
      assert.equal(first.model, 'gemini-3.5-flash-lite');
      assert.equal(first.messages[0].role, 'system');
      assert.match(first.messages[0].content, /Park Ecosystem Portal Eco Assistant/);
      assert.equal(first.messages[1].role, 'user', 'conversation must start with a user turn');
      assert.equal(first.messages.at(-1).content, 'Which one is healthiest?');
      assert.equal(first.messages.length, 4, 'system + earlier turns + the question');
      assert.equal(first.tool_choice, 'auto');
      const conditions = first.tools.find((t) => t.function.name === 'get_park_conditions');
      assert.equal(conditions.type, 'function');
      assert.equal(conditions.function.parameters.type, 'object');

      // Round two: the assistant turn is echoed back whole (thought signature included),
      // then the tool result as a `tool` message.
      const echoed = second.messages.at(-2);
      assert.equal(echoed.role, 'assistant');
      assert.equal(echoed.tool_calls[0].id, 'call_1');
      assert.deepEqual(echoed.tool_calls[0].extra_content, signature);
      const toolResult = second.messages.at(-1);
      assert.equal(toolResult.role, 'tool');
      assert.equal(toolResult.tool_call_id, 'call_1');
      assert.equal(toolResult.name, 'find_parks');
      assert.match(toolResult.content, /69\.5/);
    }
  );
});

test('the system prompt names the user, role and home park; tools follow the role', async () => {
  const officer = gemini([chatReply('ok')]);
  await llm.ask('What are my tasks?', [], { context: OFFICER });
  const req = officer.fetch.calls[0].body;
  const system = req.messages[0].content;
  assert.match(system, /Priya Nair/);
  assert.match(system, /park officer/);
  assert.match(system, /Lalbagh Botanical Garden/);
  assert.doesNotMatch(system, /ecologist/i);
  const officerTools = req.tools.map((t) => t.function.name);
  assert.ok(officerTools.includes('get_my_tasks'));
  assert.ok(officerTools.includes('get_pending_reviews'));

  const guest = gemini([chatReply('ok')]);
  await llm.ask('What are my tasks?', [], { context: GUEST });
  const guestReq = guest.fetch.calls[0].body;
  const guestTools = guestReq.tools.map((t) => t.function.name);
  assert.ok(!guestTools.includes('get_my_tasks'));
  assert.ok(!guestTools.includes('get_pending_reviews'));
  assert.match(guestReq.messages[0].content, /not signed in/);
});

test('a restricted tool requested by the model is refused by the tool layer', async () => {
  let ran = false;
  const { fetch } = gemini([
    chatReply(null, { toolCalls: [toolCall('tu_5', 'get_pending_reviews')] }),
    chatReply('That is for staff only.'),
  ]);
  await withHandler(
    'get_pending_reviews',
    async () => {
      ran = true;
      return { data: { total: 99 }, citations: [] };
    },
    () => llm.ask('How many pending reviews?', [], { context: CITIZEN })
  );
  assert.equal(ran, false, 'the handler must not run for a citizen');
  const toolResult = fetch.calls[1].body.messages.at(-1);
  assert.equal(toolResult.role, 'tool');
  assert.match(toolResult.content, /^Error: .*park staff/);
});

test('parallel tool calls are answered in order, one tool message each', async () => {
  const { fetch } = gemini([
    chatReply(null, { toolCalls: [toolCall('a', 'get_ecosystem_health', { park: 'cubbon' }), toolCall('b', 'get_alerts')] }),
    chatReply('Done.'),
  ]);
  await withHandler('get_ecosystem_health', async () => ({ data: { score: 70 }, citations: [] }), () =>
    withHandler('get_alerts', async () => ({ data: { activeAlerts: 2 }, citations: [] }), () =>
      llm.ask('Health and alerts?', [], { context: GUEST })
    )
  );
  const results = fetch.calls[1].body.messages.slice(-2);
  assert.deepEqual(results.map((r) => r.tool_call_id), ['a', 'b']);
  assert.match(results[1].content, /activeAlerts/);
});

test('unparseable tool arguments and unknown tools become error results, not crashes', async () => {
  const { fetch } = gemini([
    chatReply(null, { toolCalls: [{ id: 'x', type: 'function', function: { name: 'no_such_tool', arguments: '{not json' } }] }),
    chatReply('I could not find that.'),
  ]);
  const result = await llm.ask('Anything?', [], { context: GUEST });
  const toolResult = fetch.calls[1].body.messages.at(-1);
  assert.match(toolResult.content, /^Error: Unknown tool/);
  assert.equal(result.answer, 'I could not find that.');
});

test('a 429 from the provider is retried once, then the answer goes through', async () => {
  const { fetch } = gemini([
    { status: 429, body: { error: { message: 'Resource exhausted' } }, headers: { 'retry-after': '0' } },
    chatReply('Hello.'),
  ]);
  const result = await llm.ask('Hi', [], { context: GUEST });
  assert.equal(result.answer, 'Hello.');
  assert.equal(fetch.calls.length, 2);
});

test('a provider failure is thrown so the controller can fall back to the built-in engine', async () => {
  gemini([
    { status: 503, body: { error: { message: 'overloaded' } } },
    { status: 503, body: { error: { message: 'overloaded' } } },
  ]);
  await assert.rejects(llm.ask('Hi', [], { context: GUEST }), /Gemini API responded 503/);
});

test('a content-filtered answer is declined politely', async () => {
  gemini([chatReply(null, { finishReason: 'content_filter' })]);
  const result = await llm.ask('Something off-topic', [], { context: GUEST });
  assert.match(result.answer, /parks/);
});

test('without a provider the assistant is off and says how to enable it', async () => {
  assert.equal(llm.isEnabled(), false);
  // No key at all (independent of whatever backend/.env holds on this machine).
  llmProvider._configure({ env: { llmProvider: '', geminiApiKey: '', groqApiKey: '', llmBaseUrl: '', anthropicApiKey: '' } });
  assert.equal(llm.isEnabled(), false);
  await assert.rejects(llm.ask('Hi', [], { context: GUEST }), /GEMINI_API_KEY/);
});

// ---------------------------------------------------------------------------
// Anthropic (Claude) — the SDK path keeps working
// ---------------------------------------------------------------------------

test('Claude: tool use round trip in the Messages API shape, with the cached system prompt', async () => {
  const { client } = claude([
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu_1', name: 'find_parks', input: {} }] },
    { stop_reason: 'end_turn', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'Cubbon Park scores 69.5 out of 100.' }] },
  ]);
  await withHandler(
    'find_parks',
    async () => ({ data: { parks: [{ name: 'Cubbon Park', ecosystemHealth: 69.5 }] }, citations: [] }),
    async () => {
      const result = await llm.ask('Which one is healthiest?', [], { context: OFFICER });
      assert.equal(result.answer, 'Cubbon Park scores 69.5 out of 100.');
      assert.equal(result.provider, 'anthropic');
      assert.equal(result.providerLabel, 'Claude');
    }
  );
  const [first, second] = client.requests;
  assert.equal(first.model, 'claude-opus-5-5');
  assert.ok(first.system[0].cache_control, 'the stable prompt is cached');
  assert.doesNotMatch(first.system[0].text, /Priya/, 'per-user text stays after the cache breakpoint');
  assert.match(first.system[1].text, /Priya Nair/);
  assert.ok(first.tools.some((t) => t.name === 'get_park_conditions' && t.input_schema));
  const toolResult = second.messages.at(-1).content[0];
  assert.equal(toolResult.type, 'tool_result');
  assert.equal(toolResult.tool_use_id, 'tu_1');
  assert.match(toolResult.content, /69\.5/);
});

test('Claude: parallel results go back in one user message; errors are flagged', async () => {
  const { client } = claude([
    {
      stop_reason: 'tool_use',
      content: [
        { type: 'tool_use', id: 'a', name: 'get_alerts', input: {} },
        { type: 'tool_use', id: 'b', name: 'no_such_tool', input: {} },
      ],
    },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] },
  ]);
  await withHandler('get_alerts', async () => ({ data: { activeAlerts: 2 }, citations: [] }), () =>
    llm.ask('Alerts?', [], { context: GUEST })
  );
  const results = client.requests[1].messages.at(-1).content;
  assert.deepEqual(results.map((r) => r.tool_use_id), ['a', 'b']);
  assert.equal(results[1].is_error, true);
});

test('Claude: a refusal is answered politely', async () => {
  claude([{ stop_reason: 'refusal', content: [] }]);
  const result = await llm.ask('Something off-topic', [], { context: GUEST });
  assert.match(result.answer, /parks/);
});

test('is switched off under test unless a test configures a provider', () => {
  assert.equal(llm.isEnabled(), false);
  gemini([]);
  assert.equal(llm.isEnabled(), true);
});

'use strict';

/**
 * The Claude-backed assistant's conversation loop, driven by a fake API client
 * so the suite needs neither a network connection nor an API key.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const llm = require('../../src/services/llm-assistant.service');

/** A fake client that replays scripted responses and records each request. */
function fakeClient(responses) {
  const requests = [];
  return {
    requests,
    beta: {
      messages: {
        create: async (params) => {
          requests.push(structuredClone(params));
          const next = responses.shift();
          if (!next) throw new Error('No scripted response left');
          return next;
        },
      },
    },
  };
}

test('looks facts up through a tool, then answers in context', async () => {
  const original = llm.HANDLERS.list_parks;
  llm.HANDLERS.list_parks = async () => ({
    data: { parks: [{ name: 'Cubbon Park', ecosystemHealth: 69.5 }] },
    citations: [{ label: 'Cubbon Park', entity: 'Park', entityId: 'p1', score: 1 }],
  });
  const client = fakeClient([
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu_1', name: 'list_parks', input: {} }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Cubbon Park scores 69.5 out of 100.' }] },
  ]);
  llm._setClient(client);

  try {
    const history = [
      { role: 'assistant', content: 'Welcome!' }, // a leading assistant turn must be dropped
      { role: 'user', content: 'Which parks do you monitor?' },
      { role: 'assistant', content: 'Six parks in Bengaluru.' },
    ];
    const result = await llm.ask('Which one is healthiest?', history);

    assert.equal(result.answer, 'Cubbon Park scores 69.5 out of 100.');
    assert.deepEqual(result.toolsUsed, ['list_parks']);
    assert.equal(result.citations.length, 1);

    const [first, second] = client.requests;
    assert.equal(first.messages[0].role, 'user', 'conversation must start with a user turn');
    assert.equal(first.messages.at(-1).content, 'Which one is healthiest?');
    assert.equal(first.messages.length, 3, 'earlier turns are sent for context');
    assert.ok(first.tools.some((t) => t.name === 'get_live_conditions'));

    const toolResult = second.messages.at(-1).content[0];
    assert.equal(toolResult.type, 'tool_result');
    assert.equal(toolResult.tool_use_id, 'tu_1');
    assert.match(toolResult.content, /69\.5/);
  } finally {
    llm.HANDLERS.list_parks = original;
  }
});

test('reports a failed lookup to the model as an error result', async () => {
  const client = fakeClient([
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu_9', name: 'no_such_tool', input: {} }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'I could not find that.' }] },
  ]);
  llm._setClient(client);

  const result = await llm.ask('Anything?');
  const toolResult = client.requests[1].messages.at(-1).content[0];
  assert.equal(toolResult.is_error, true);
  assert.equal(result.answer, 'I could not find that.');
});

test('answers politely when the request is declined', async () => {
  llm._setClient(fakeClient([{ stop_reason: 'refusal', content: [] }]));
  const result = await llm.ask('Something off-topic');
  assert.match(result.answer, /parks/);
});

test('is switched off under test even with a key set', () => {
  assert.equal(llm.isEnabled(), false);
});

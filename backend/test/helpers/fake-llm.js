'use strict';

/**
 * Mocks for the language-model layer: a scripted `fetch` that speaks the
 * OpenAI Chat Completions format (Gemini, Groq, Ollama…), and a fake
 * Anthropic SDK client. No test ever reaches a real API.
 */

/**
 * A fake `fetch` that records every request and replays scripted replies.
 *
 * Each reply is a response body (an object, sent as JSON with status 200),
 * `{ status, body, headers }` for an HTTP error, an `Error` to throw (a
 * network failure), or a function `(body, call) => reply`.
 */
function fakeFetch(replies) {
  const calls = [];
  const queue = Array.isArray(replies) ? [...replies] : null;
  const fn = async (url, init = {}) => {
    const body = JSON.parse(init.body);
    calls.push({ url, headers: init.headers, body: structuredClone(body), signal: init.signal });
    let next = queue ? queue.shift() : replies;
    if (typeof next === 'function') next = next(body, calls.length);
    if (next === undefined) throw new Error('No scripted reply left');
    if (next instanceof Error) throw next;
    const isEnvelope = next && typeof next === 'object' && 'status' in next && 'body' in next;
    const status = isEnvelope ? next.status : 200;
    const payload = isEnvelope ? next.body : next;
    const headers = new Map(Object.entries((isEnvelope && next.headers) || {}));
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
      text: async () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
    };
  };
  fn.calls = calls;
  return fn;
}

/** A Chat Completions response. */
function chatReply(content, { toolCalls, finishReason, model = 'test-model', extra = {} } = {}) {
  return {
    id: 'chatcmpl-test',
    model,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content,
        ...(toolCalls ? { tool_calls: toolCalls } : {}),
        ...extra,
      },
      finish_reason: finishReason || (toolCalls ? 'tool_calls' : 'stop'),
    }],
  };
}

/** One OpenAI-style tool call. */
const toolCall = (id, name, args = {}, extra = {}) => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
  ...extra,
});

/** A fake Anthropic client that replays scripted Messages API responses. */
function fakeAnthropic(responses) {
  const requests = [];
  return {
    requests,
    beta: {
      messages: {
        create: async (params) => {
          requests.push(structuredClone(params));
          const next = typeof responses === 'function' ? responses(params) : responses.shift();
          if (!next) throw new Error('No scripted response left');
          if (next instanceof Error) throw next;
          return next;
        },
      },
    },
  };
}

module.exports = { fakeFetch, chatReply, toolCall, fakeAnthropic };

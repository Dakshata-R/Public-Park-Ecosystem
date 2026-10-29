'use strict';

/**
 * Module 11 — AI Environmental Assistant, language-model engine.
 *
 * A language model answers the question in context (including the earlier
 * turns of the conversation) and looks facts up through the read-only tools
 * in `assistant-tools.service.js`, which read the same database the
 * dashboards do. Which tools are offered — and what each returns — depends on
 * the signed-in user's role; that is enforced in the tool layer, not by
 * asking the model nicely.
 *
 * The model is whichever provider `llm-provider.service.js` selects — Gemini
 * (GEMINI_API_KEY, free), Groq, an OpenAI-compatible server such as Ollama,
 * or Claude. Without one — or if the API cannot be reached — the controller
 * falls back to the built-in engine in `assistant.service.js`, so the
 * assistant always answers.
 */

const llmProvider = require('./llm-provider.service');
const tools = require('./assistant-tools.service');

/** Upper bound on tool round trips for one question. */
const MAX_TOOL_ROUNDS = 8;

/** How many earlier messages of the conversation are sent for context. */
const HISTORY_MESSAGES = 12;

/** The browser gives up after 60 s; leave time to fall back to the built-in engine. */
const DEADLINE_MS = 50_000;

/** True when the language-model engine should answer. */
const isEnabled = () => llmProvider.isEnabled();

const SYSTEM_PROMPT = `You are the Park Ecosystem Portal Eco Assistant, built into a portal that monitors the ecological health of public parks in Bengaluru, India. People use you instead of clicking through the portal's tabs, so answer the question directly from the data.

You can look up parks, current weather and air quality, park sensor readings, ecosystem health scores, biodiversity and species, alerts, incidents, maintenance work orders, the review queues, and the user's own tasks and reports — whichever of these the user's role allows; the tools you have are exactly the ones they may use. Every figure you state must come from a tool result in this conversation. If a tool says the information is restricted or unavailable, tell the user plainly and, where useful, say who can see it. Never guess a number.

Resolve references before calling tools: park names can be partial or misspelt ("cubbon" means Cubbon Park), "my park" is the user's home park, and "me", "my" or "I" is the signed-in user described below. Use the earlier turns to resolve follow-ups ("what about Lalbagh?", "only the critical ones"). For "high priority", ask the tools for priority high and above.

Answer like a helpful colleague: lead with the answer (the count, the reading, the list), then the few details that matter. Use short bullet lists for several items and **bold** for the key figure. No headings, tables or code blocks. Name the park and, for live readings, the time of the reading. Keep it under about 150 words unless the user asks for more. Air quality uses India's CPCB AQI scale. You may add a line of general ecological context when it helps, kept clearly separate from the park data. Politely decline requests unrelated to the parks, the environment or this portal.`;

/** The per-user part of the system prompt. */
function describeUser(ctx) {
  if (!ctx.user) {
    return 'The user is not signed in. They can see public park data only; if they ask about tasks, reports or review queues, explain that they need to sign in.';
  }
  const role = {
    admin: 'an administrator (can see all records, including other staff members\' tasks)',
    officer: 'a park officer (sees operational records, their own assigned tasks and the review queues)',
    citizen: 'a member of the public (sees public park data and the status of their own reports; incidents and work orders are shown only as counts)',
  }[ctx.access];
  const park = ctx.homePark ? ` Their home park is ${ctx.homePark.name}.` : ' No home park is set on their account.';
  return `The signed-in user is ${ctx.user.name}, ${role}.${park}`;
}

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------

/**
 * Answer a question with the configured language model.
 *
 * @param {string} question
 * @param {{role:'user'|'assistant', content:string}[]} [history] earlier turns, oldest first
 * @param {object} [options]
 * @param {object|null} [options.user] the signed-in User document, or null for a guest
 * @param {object} [options.context] a pre-built tool context (see assistant-tools `buildContext`)
 * @param {object} [options.provider] a provider from `llm-provider` (tests pass one); default: the active one
 * @returns {Promise<{answer:string, citations:object[], toolsUsed:string[], latencyMs:number, provider:string, providerLabel:string, model:string}>}
 */
async function ask(question, history = [], { user = null, context, provider: injected } = {}) {
  const startedAt = Date.now();
  const provider = injected || llmProvider.getProvider();
  if (!provider) throw new Error(llmProvider.disabledReason());
  const ctx = context || (await tools.buildContext(user));
  const toolList = tools.toolsFor(ctx);

  // Earlier turns as plain text. Some APIs require the first message to be
  // from the user and roles to alternate, so drop a leading assistant message
  // and merge any repeated roles.
  const prior = [];
  for (const m of history.slice(-HISTORY_MESSAGES)) {
    const turn = { role: m.role, content: String(m.content) };
    if (!prior.length && turn.role !== 'user') continue;
    if (prior.length && prior.at(-1).role === turn.role) prior.at(-1).content += `\n\n${turn.content}`;
    else prior.push(turn);
  }
  if (prior.length && prior.at(-1).role === 'user') prior.pop(); // an unanswered question

  const today = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'full', timeStyle: 'short' });
  const system = [
    // Stable text first so it can be cached; the per-user text follows it.
    { text: SYSTEM_PROMPT, cache: true },
    { text: `${describeUser(ctx)}\nNow: ${today} (India Standard Time).` },
  ];
  const messages = [...prior, { role: 'user', content: question }];
  const citations = new Map();
  const toolsUsed = [];

  const finish = (answer, model) => ({
    answer,
    citations: [...citations.values()].slice(0, 8),
    toolsUsed,
    latencyMs: Date.now() - startedAt,
    provider: provider.name,
    providerLabel: provider.label,
    model: model || provider.chatModel,
  });

  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), DEADLINE_MS);
  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
      const reply = await provider.chat({ system, messages, tools: toolList, signal: deadline.signal });

      if (reply.stopReason === 'refusal') {
        return finish('I can only help with questions about the parks, their environment and this portal.', reply.model);
      }

      // A tool call cut off at max_tokens may carry truncated input; do not run it.
      if (reply.stopReason !== 'tool_use' || !reply.toolCalls.length || round === MAX_TOOL_ROUNDS) {
        return finish(reply.text || 'I could not put together an answer to that. Please try rephrasing the question.', reply.model);
      }

      // The assistant turn goes back exactly as the provider sent it.
      messages.push(reply.message);
      const results = await Promise.all(reply.toolCalls.map((t) => tools.runTool(t.name, t.input, ctx)));
      reply.toolCalls.forEach((t) => toolsUsed.push(t.name));
      for (const r of results) for (const c of r.citations) citations.set(`${c.entity}:${c.entityId}`, c);

      messages.push(...provider.toolResultMessages(reply.toolCalls.map((t, i) => ({
        id: t.id,
        name: t.name,
        content: results[i].ok ? JSON.stringify(results[i].data) : results[i].error,
        isError: !results[i].ok,
      }))));
    }
  } finally {
    clearTimeout(timer);
  }

  // Unreachable: the loop returns on its last round.
  throw new Error('Assistant tool loop ended without an answer');
}

module.exports = { ask, isEnabled, describeUser, SYSTEM_PROMPT };

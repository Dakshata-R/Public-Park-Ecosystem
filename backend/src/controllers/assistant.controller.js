'use strict';

/**
 * Module 11 — AI Environmental Assistant.
 */

const crypto = require('crypto');
const { ChatMessage } = require('../models');
const asyncHandler = require('../middleware/asyncHandler');
const { ok, created } = require('../utils/response');
const ApiError = require('../utils/ApiError');
const assistant = require('../services/assistant.service');
const llm = require('../services/llm-assistant.service');
const llmProvider = require('../services/llm-provider.service');
const tools = require('../services/assistant-tools.service');
const logger = require('../utils/logger');
const { normaliseId } = require('./crud.factory');

/**
 * Answer with the configured language model (Gemini, Groq, a local model or
 * Claude — see llm-provider.service), using the conversation so far for
 * context; otherwise — or if the API fails — with the built-in engine, so the
 * assistant always replies. Both engines answer through the same role-aware
 * tool layer, built here once from the signed-in user.
 */
async function answer(question, sessionId, user) {
  const context = await tools.buildContext(user || null);
  if (llm.isEnabled()) {
    try {
      const history = await ChatMessage.find({ sessionId }).sort({ createdAt: -1 }).limit(12).select('role content').lean();
      const result = await llm.ask(question, history.reverse(), { context });
      return { ...result, engine: 'llm', intent: undefined, intentConfidence: undefined };
    } catch (err) {
      const reason = err?.status ? `HTTP ${err.status}: ${err.message}` : err.message;
      logger.warn(`Eco Assistant: language model unavailable, answering with the built-in engine (${reason})`);
    }
  }
  return { ...(await assistant.ask(question, { context })), engine: 'built-in' };
}

/**
 * POST /api/assistant/ask
 * Persists both turns so the conversation survives a page reload and so the
 * intent/citation record can be reviewed when evaluating the assistant.
 */
const ask = asyncHandler(async (req, res) => {
  const question = String(req.body.question || '').trim();
  if (!question) throw ApiError.badRequest('`question` is required');
  if (question.length > 1000) throw ApiError.badRequest('Question is too long (1000 character limit)');

  // An unguessable id: the id is the only thing protecting an anonymous
  // visitor's conversation.
  let sessionId = req.body.sessionId || `session-${crypto.randomUUID()}`;

  // A signed-in user's conversation cannot be continued by anyone else.
  if (req.body.sessionId) {
    const owner = await ChatMessage.findOne({ sessionId }).select('user').lean();
    if (owner?.user && String(owner.user) !== String(req.user?._id)) {
      sessionId = `session-${crypto.randomUUID()}`;
    }
  }

  const result = await answer(question, sessionId, req.user);

  await ChatMessage.create({
    sessionId,
    role: 'user',
    content: question,
    user: req.user?._id || null,
  });

  const answerDoc = await ChatMessage.create({
    sessionId,
    role: 'assistant',
    content: result.answer,
    user: req.user?._id || null,
    intent: result.intent,
    citations: result.citations,
    latencyMs: result.latencyMs,
    engine: result.engine,
    provider: result.provider || '',
    model: result.model || '',
    toolsUsed: result.toolsUsed || [],
  });

  return created(res, {
    sessionId,
    message: answerDoc,
    intent: result.intent,
    intentConfidence: result.intentConfidence,
    citations: result.citations,
    latencyMs: result.latencyMs,
    engine: result.engine,
    provider: result.provider || null,
    providerLabel: result.providerLabel || null,
    model: result.model || null,
    toolsUsed: result.toolsUsed || [],
  });
});

/**
 * GET /api/assistant/history/:sessionId
 * A conversation started while signed in is readable only by that account
 * (or an administrator); an anonymous one only by whoever holds its id.
 */
const getHistory = asyncHandler(async (req, res) => {
  const messages = await ChatMessage.find({ sessionId: req.params.sessionId })
    .sort({ createdAt: 1 })
    .limit(200)
    .lean();

  const owner = messages.find((m) => m.user)?.user;
  if (owner && String(owner) !== String(req.user?._id) && req.user?.role !== 'admin') {
    throw ApiError.notFound('Conversation');
  }

  return ok(res, messages.map(normaliseId), { sessionId: req.params.sessionId, count: messages.length });
});

/** GET /api/assistant/suggestions — tailored to the signed-in user's role. */
const getSuggestions = asyncHandler(async (req, res) => {
  const context = await tools.buildContext(req.user || null);
  const provider = llmProvider.describe();
  return ok(res, {
    suggestions: assistant.suggestionsFor(context),
    capabilities: tools.toolsFor(context).map((t) => t.name),
    engine: provider ? 'llm' : 'built-in',
    /** e.g. "gemini" / "Gemini" / "gemini-3.5-flash-lite"; null on the built-in engine. */
    provider: provider?.name ?? null,
    providerLabel: provider?.label ?? null,
    model: provider?.chatModel ?? null,
    role: context.access,
  });
});

/**
 * POST /api/assistant/search
 * The retrieval stage on its own — useful for a global search box, and the
 * endpoint that demonstrates the TF-IDF ranking during the viva.
 */
const search = asyncHandler(async (req, res) => {
  const context = await tools.buildContext(req.user || null);
  const query = String(req.body.query || req.query.q || '').trim();
  if (!query) throw ApiError.badRequest('A search query is required');

  const requested = req.body.entities || (req.query.entities ? String(req.query.entities).split(',') : undefined);
  // Operational records stay out of a public user's results.
  const allowed = tools.searchableEntities(context);
  let entities = allowed ? (requested ? requested.filter((e) => allowed.includes(e)) : allowed) : requested;
  // Every requested type was off limits: match nothing rather than everything.
  if (entities && !entities.length) entities = ['none'];
  const k = Math.min(25, Math.max(1, Number.parseInt(req.body.k ?? req.query.k, 10) || 8));

  const hits = await assistant.retrieve(query, { k, entities });

  return ok(
    res,
    hits.map((h) => ({ entity: h.entity, id: h.id, label: h.label, score: h.score })),
    { query, tokens: assistant.tokenise(query), results: hits.length }
  );
});

/** POST /api/assistant/reindex — force a corpus rebuild after a bulk import. */
const reindex = asyncHandler(async (_req, res) => {
  const corpus = await assistant.getCorpus(true);
  return ok(res, { documents: corpus.docs.length, vocabulary: corpus.idf.size, rebuiltAt: new Date() });
});

module.exports = { ask, getHistory, getSuggestions, search, reindex };

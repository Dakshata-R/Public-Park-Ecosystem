'use strict';

/**
 * Module 11 — AI Environmental Assistant.
 */

const { ChatMessage } = require('../models');
const asyncHandler = require('../middleware/asyncHandler');
const { ok, created } = require('../utils/response');
const ApiError = require('../utils/ApiError');
const assistant = require('../services/assistant.service');
const { normaliseId } = require('./crud.factory');

/**
 * POST /api/assistant/ask
 * Persists both turns so the conversation survives a page reload and so the
 * intent/citation record can be reviewed when evaluating the assistant.
 */
const ask = asyncHandler(async (req, res) => {
  const question = String(req.body.question || '').trim();
  if (!question) throw ApiError.badRequest('`question` is required');
  if (question.length > 1000) throw ApiError.badRequest('Question is too long (1000 character limit)');

  const sessionId = req.body.sessionId || `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const result = await assistant.ask(question);

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
  });

  return created(res, {
    sessionId,
    message: answerDoc,
    intent: result.intent,
    intentConfidence: result.intentConfidence,
    citations: result.citations,
    latencyMs: result.latencyMs,
  });
});

/** GET /api/assistant/history/:sessionId */
const getHistory = asyncHandler(async (req, res) => {
  const messages = await ChatMessage.find({ sessionId: req.params.sessionId })
    .sort({ createdAt: 1 })
    .limit(200)
    .lean();

  return ok(res, messages.map(normaliseId), { sessionId: req.params.sessionId, count: messages.length });
});

/** GET /api/assistant/suggestions */
const getSuggestions = asyncHandler(async (_req, res) =>
  ok(res, {
    suggestions: assistant.SUGGESTED_QUESTIONS,
    capabilities: Object.keys(assistant.INTENTS),
  })
);

/**
 * POST /api/assistant/search
 * The retrieval stage on its own — useful for a global search box, and the
 * endpoint that demonstrates the TF-IDF ranking during the viva.
 */
const search = asyncHandler(async (req, res) => {
  const query = String(req.body.query || req.query.q || '').trim();
  if (!query) throw ApiError.badRequest('A search query is required');

  const entities = req.body.entities || (req.query.entities ? String(req.query.entities).split(',') : undefined);
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

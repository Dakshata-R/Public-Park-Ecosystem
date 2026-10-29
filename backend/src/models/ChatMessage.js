'use strict';

/**
 * Module 11 — AI Environmental Assistant: conversation history.
 *
 * `citations` records which documents the retrieval step surfaced for an
 * answer, so a claim in the chat can always be traced back to the record it
 * came from. See `services/assistant.service.js`.
 */

const mongoose = require('mongoose');
const toJSONPlugin = require('./plugins/toJSON');

const citationSchema = new mongoose.Schema(
  {
    label: { type: String, required: true },
    entity: { type: String, default: '' },
    entityId: { type: mongoose.Schema.Types.ObjectId, default: null },
    score: { type: Number, default: 0 },
  },
  { _id: false }
);

const chatMessageSchema = new mongoose.Schema(
  {
    /** Groups messages into one conversation. */
    sessionId: { type: String, required: true, index: true },
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true, maxlength: 8000 },

    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    /** Intent the router matched, kept for evaluating the assistant. */
    intent: { type: String, default: '' },
    citations: { type: [citationSchema], default: [] },
    latencyMs: { type: Number, default: 0 },

    /**
     * Which engine answered: a language model (`llm`, with `provider` naming
     * it), or the built-in retrieval engine. `claude` is the value stored
     * before providers were pluggable and is still read back.
     */
    engine: { type: String, enum: ['llm', 'claude', 'built-in', ''], default: '' },
    /** The language-model provider (gemini, groq, openai-compatible, anthropic) and model id. */
    provider: { type: String, default: '' },
    model: { type: String, default: '' },
    /** The data lookups the answer was built from, in call order. */
    toolsUsed: { type: [String], default: [] },
  },
  { timestamps: true }
);

chatMessageSchema.plugin(toJSONPlugin);

chatMessageSchema.index({ sessionId: 1, createdAt: 1 });

module.exports = mongoose.model('ChatMessage', chatMessageSchema);

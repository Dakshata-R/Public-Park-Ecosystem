'use strict';

/**
 * Module 5 — AI Ecosystem Monitoring: one wildlife-recognition result.
 *
 * Every image submitted to the vision endpoints is persisted with its full
 * class-probability vector, the evidence behind it, and the network's own top
 * ImageNet classes — not just the winning label. That makes every call
 * auditable after the fact and lets the analytics module chart confidence
 * distributions and reviewer-measured precision over time.
 *
 * `engine` records which engine made the call: AI vision (`llm-vision`, a
 * multimodal language model — `provider` says which; species named) or the
 * MobileNetV2 fallback. `claude-vision` is the value stored before providers
 * were pluggable and stays valid. `species` is optional, so detections stored
 * before it existed remain valid.
 */

const mongoose = require('mongoose');
const toJSONPlugin = require('./plugins/toJSON');
const { pointSchema } = require('./shared/geo');

const AI_TASKS = ['wildlife'];
const AI_ENGINES = ['llm-vision', 'claude-vision', 'mobilenet-fallback'];
const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const REVIEW_STATUSES = ['pending', 'confirmed', 'rejected'];

/** One entry of a probability vector. */
const classProbabilitySchema = new mongoose.Schema(
  { label: { type: String, required: true }, probability: { type: Number, required: true, min: 0, max: 1 } },
  { _id: false }
);

/** The animal named in the image. */
const speciesSchema = new mongoose.Schema(
  {
    common: { type: String, default: '' },
    scientific: { type: String, default: '' },
    /** Percentage, 0–100. */
    confidence: { type: Number, min: 0, max: 100, default: 0 },
  },
  { _id: false }
);

const aiDetectionSchema = new mongoose.Schema(
  {
    task: { type: String, enum: AI_TASKS, required: true, index: true },
    /** `/api/ai/images/:id` — the stored copy of the analysed image. */
    imageUrl: { type: String, required: true },
    image: { type: mongoose.Schema.Types.ObjectId, ref: 'AiImage', default: null },
    imageName: { type: String, default: '' },
    imageCredit: { type: String, default: '' },

    park: { type: mongoose.Schema.Types.ObjectId, ref: 'Park', default: null, index: true },
    location: { type: pointSchema, default: undefined },

    /** Which engine produced the call. Older records predate AI vision. */
    engine: { type: String, enum: AI_ENGINES, default: 'mobilenet-fallback', index: true },
    /** The language-model provider for `llm-vision` (gemini, groq, openai-compatible, anthropic); empty otherwise. */
    provider: { type: String, default: '' },

    /** Winning label — argmax over `probabilities`. */
    prediction: { type: String, required: true },
    /** e.g. "Indian pond heron (Ardeola grayii)" or "ImageNet class: bee eater (77.3 %)". */
    detail: { type: String, default: '' },
    /** Winning probability as a percentage, 0–100. */
    confidence: { type: Number, required: true, min: 0, max: 100 },
    /** Full task probability vector, descending. */
    probabilities: { type: [classProbabilitySchema], default: [] },
    species: { type: speciesSchema, default: undefined },
    /** The network's own top ImageNet classes for this image. */
    imagenet: { type: [classProbabilitySchema], default: [] },
    /** Named signals the task score was built from. */
    evidence: { type: Map, of: Number, default: {} },
    /** Caveats that apply to this particular result. */
    notes: { type: [String], default: [] },

    severity: { type: String, enum: SEVERITIES, default: 'low' },
    recommendedAction: { type: String, default: '' },

    /** Recorded so every result stays traceable to its weights. */
    modelName: { type: String, default: '' },
    modelVersion: { type: String, default: '' },
    inferenceMs: { type: Number, default: 0 },

    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    /** Human-in-the-loop verification of the model's call. */
    reviewStatus: { type: String, enum: REVIEW_STATUSES, default: 'pending', index: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    /** Ground-truth label supplied by the reviewer, if it differed. */
    correctedLabel: { type: String, default: '' },
  },
  { timestamps: true }
);

aiDetectionSchema.plugin(toJSONPlugin);

aiDetectionSchema.index({ task: 1, createdAt: -1 });
aiDetectionSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('AiDetection', aiDetectionSchema);
module.exports.AI_TASKS = AI_TASKS;
module.exports.AI_ENGINES = AI_ENGINES;
module.exports.REVIEW_STATUSES = REVIEW_STATUSES;

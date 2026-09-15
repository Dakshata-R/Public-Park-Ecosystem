'use strict';

/**
 * Module 5 — AI Ecosystem Monitoring: one inference result.
 *
 * Every image submitted to the vision endpoints is persisted with its full
 * class-probability vector, the evidence behind it, and the network's own top
 * ImageNet classes — not just the winning label. That makes every call
 * auditable after the fact and lets the analytics module chart confidence
 * distributions and reviewer-measured precision over time.
 */

const mongoose = require('mongoose');
const toJSONPlugin = require('./plugins/toJSON');
const { pointSchema } = require('./shared/geo');

const AI_TASKS = ['tree-disease', 'plant-id', 'wildlife', 'waste', 'fire'];
const REVIEW_STATUSES = ['pending', 'confirmed', 'rejected'];

/** One entry of a probability vector. */
const classProbabilitySchema = new mongoose.Schema(
  { label: { type: String, required: true }, probability: { type: Number, required: true, min: 0, max: 1 } },
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

    /** Winning label — argmax over `probabilities`. */
    prediction: { type: String, required: true },
    /** e.g. "Closest ImageNet class: bee eater (77.3 %)". */
    detail: { type: String, default: '' },
    /** Winning probability as a percentage, 0–100. */
    confidence: { type: Number, required: true, min: 0, max: 100 },
    /** Full task probability vector, descending. */
    probabilities: { type: [classProbabilitySchema], default: [] },
    /** The network's own top ImageNet classes for this image. */
    imagenet: { type: [classProbabilitySchema], default: [] },
    /** Named signals the task score was built from. */
    evidence: { type: Map, of: Number, default: {} },
    /** Caveats that apply to this particular result. */
    notes: { type: [String], default: [] },

    severity: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'low' },
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

    /** Incident opened automatically for a fire detection. */
    linkedIncident: { type: mongoose.Schema.Types.ObjectId, ref: 'Incident', default: null },
  },
  { timestamps: true }
);

aiDetectionSchema.plugin(toJSONPlugin);

aiDetectionSchema.index({ task: 1, createdAt: -1 });
aiDetectionSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('AiDetection', aiDetectionSchema);
module.exports.AI_TASKS = AI_TASKS;
module.exports.REVIEW_STATUSES = REVIEW_STATUSES;

'use strict';

/**
 * Module 5 — AI Ecosystem Monitoring: one inference result.
 *
 * Every image submitted to the vision endpoints is persisted with its full
 * class-probability vector, not just the winning label. That makes the
 * accuracy of the model auditable after the fact and lets the analytics module
 * chart confidence distributions over time.
 */

const mongoose = require('mongoose');
const toJSONPlugin = require('./plugins/toJSON');
const { pointSchema } = require('./shared/geo');

const AI_TASKS = ['tree-disease', 'plant-id', 'wildlife', 'waste', 'fire'];
const REVIEW_STATUSES = ['pending', 'confirmed', 'rejected'];

/** One entry of the softmax output. */
const classProbabilitySchema = new mongoose.Schema(
  { label: { type: String, required: true }, probability: { type: Number, required: true, min: 0, max: 1 } },
  { _id: false }
);

const aiDetectionSchema = new mongoose.Schema(
  {
    task: { type: String, enum: AI_TASKS, required: true, index: true },
    imageUrl: { type: String, required: true },
    imageName: { type: String, default: '' },

    park: { type: mongoose.Schema.Types.ObjectId, ref: 'Park', default: null, index: true },
    location: { type: pointSchema, default: undefined },

    /** Winning label — argmax over `probabilities`. */
    prediction: { type: String, required: true },
    /** Winning probability as a percentage, 0–100. */
    confidence: { type: Number, required: true, min: 0, max: 100 },
    /** Full class-probability vector, descending. */
    probabilities: { type: [classProbabilitySchema], default: [] },

    severity: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'low' },
    recommendedAction: { type: String, default: '' },

    /** Model card, recorded so results stay traceable to a version. */
    modelName: { type: String, default: '' },
    modelVersion: { type: String, default: 'v1.0.0' },
    inferenceMs: { type: Number, default: 0 },

    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    /** Human-in-the-loop verification of the model's call. */
    reviewStatus: { type: String, enum: REVIEW_STATUSES, default: 'pending', index: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    /** Ground-truth label supplied by the reviewer, if it differed. */
    correctedLabel: { type: String, default: '' },

    /** Incident opened automatically for a high-severity detection. */
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

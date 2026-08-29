'use strict';

/**
 * Module 1 / Module 8 — the notification stream shown on the dashboard.
 *
 * Alerts are generated, never authored: a sensor breaching a threshold, an
 * anomaly detector firing, or a high-severity AI detection each raise one.
 * `dedupeKey` prevents a sensor that stays out of range from producing a new
 * alert on every reading — the existing active alert is refreshed instead.
 */

const mongoose = require('mongoose');
const toJSONPlugin = require('./plugins/toJSON');

const ALERT_SEVERITIES = ['low', 'medium', 'high', 'critical'];
const ALERT_STATUSES = ['active', 'acknowledged', 'resolved'];
const ALERT_SOURCES = ['sensor', 'ai', 'incident', 'system', 'anomaly'];

const alertSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    message: { type: String, default: '' },

    module: { type: String, required: true },
    source: { type: String, enum: ALERT_SOURCES, default: 'system', index: true },
    severity: { type: String, enum: ALERT_SEVERITIES, default: 'medium', index: true },
    status: { type: String, enum: ALERT_STATUSES, default: 'active', index: true },

    park: { type: mongoose.Schema.Types.ObjectId, ref: 'Park', default: null, index: true },

    /** Polymorphic pointer to whatever raised the alert. */
    relatedModel: { type: String, default: '' },
    relatedId: { type: mongoose.Schema.Types.ObjectId, default: null },

    /**
     * Stable identity for a recurring condition, e.g.
     * `sensor:<id>:threshold`. Unique among active alerts.
     */
    dedupeKey: { type: String, default: null, index: true },
    /** How many times this condition has re-fired while still active. */
    occurrences: { type: Number, default: 1 },

    acknowledgedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    acknowledgedAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

alertSchema.plugin(toJSONPlugin);

alertSchema.index({ status: 1, severity: 1, createdAt: -1 });

module.exports = mongoose.model('Alert', alertSchema);
module.exports.ALERT_SEVERITIES = ALERT_SEVERITIES;
module.exports.ALERT_STATUSES = ALERT_STATUSES;
module.exports.ALERT_SOURCES = ALERT_SOURCES;

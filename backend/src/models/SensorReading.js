'use strict';

/**
 * Module 6 — Environmental Sensor Monitoring: the measurement time series.
 *
 * The highest-volume collection in the system, so it is deliberately narrow:
 * sensor reference, timestamp, value, and the anomaly verdict computed at
 * write time by `services/anomaly.service.js`.
 *
 * A compound index on (sensor, recordedAt) serves both "last 24 h for this
 * sensor" chart queries and the rolling-window statistics the detector needs.
 */

const mongoose = require('mongoose');
const toJSONPlugin = require('./plugins/toJSON');

const readingSchema = new mongoose.Schema(
  {
    sensor: { type: mongoose.Schema.Types.ObjectId, ref: 'Sensor', required: true, index: true },
    park: { type: mongoose.Schema.Types.ObjectId, ref: 'Park', required: true, index: true },
    type: { type: String, required: true, index: true },

    value: { type: Number, required: true },
    unit: { type: String, default: '' },
    recordedAt: { type: Date, required: true, default: Date.now, index: true },
    /** Copied from the sensor at write time: open-meteo | simulated | device. */
    source: { type: String, default: 'device' },

    /** Flagged by the z-score / IQR detector; see anomaly.service.js. */
    isAnomaly: { type: Boolean, default: false, index: true },
    /** |z| at the time of writing, kept for the analytics charts. */
    zScore: { type: Number, default: 0 },
  },
  { timestamps: false }
);

readingSchema.plugin(toJSONPlugin);

readingSchema.index({ sensor: 1, recordedAt: -1 });
readingSchema.index({ park: 1, type: 1, recordedAt: -1 });

module.exports = mongoose.model('SensorReading', readingSchema);

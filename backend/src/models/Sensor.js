'use strict';

/**
 * Module 6 — Environmental Sensor Monitoring: the sensor registry.
 *
 * A sensor stores its identity, siting and calibration bounds. Measured
 * values live in the separate `SensorReading` time-series collection; only
 * the most recent value is cached here so a sensor list needs one query.
 */

const mongoose = require('mongoose');
const toJSONPlugin = require('./plugins/toJSON');
const { pointSchema } = require('./shared/geo');

const SENSOR_TYPES = ['aqi', 'temperature', 'humidity', 'noise', 'water', 'soil'];
const SENSOR_STATUS = ['online', 'offline', 'warning', 'maintenance'];

/**
 * Where a sensor's readings come from.
 *
 *   open-meteo  a virtual sensor: every reading is a real observation for the
 *               park's coordinates from Open-Meteo (forecast model / CAMS)
 *   simulated   no public source exists for this measurement at park scale;
 *               readings are generated and labelled as such everywhere
 *   device      a physical probe POSTing to /api/sensors/:id/readings
 */
const SENSOR_SOURCES = ['open-meteo', 'simulated', 'device'];

/** Types for which Open-Meteo provides a real per-location value. */
const LIVE_TYPES = ['aqi', 'temperature', 'humidity'];

/**
 * Per-type metadata: display unit, plausible operating range used by the
 * simulator, and the thresholds that raise a warning.
 * `direction` says whether a higher raw reading is better or worse — the
 * scoring service needs it to normalise readings onto a 0–100 "good" scale.
 */
const SENSOR_PROFILES = {
  aqi:         { unit: 'AQI', min: 0,   max: 500, warnAbove: 100, direction: 'lower-is-better' },
  temperature: { unit: '°C',  min: -10, max: 50,  warnAbove: 38,  warnBelow: 2, direction: 'band' },
  humidity:    { unit: '%',   min: 0,   max: 100, warnAbove: 90,  warnBelow: 20, direction: 'band' },
  noise:       { unit: 'dB',  min: 20,  max: 120, warnAbove: 70,  direction: 'lower-is-better' },
  water:       { unit: 'WQI', min: 0,   max: 100, warnBelow: 50,  direction: 'higher-is-better' },
  soil:        { unit: '%',   min: 0,   max: 100, warnBelow: 30,  direction: 'higher-is-better' },
};

const sensorSchema = new mongoose.Schema(
  {
    sensorCode: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: SENSOR_TYPES, required: true, index: true },
    park: { type: mongoose.Schema.Types.ObjectId, ref: 'Park', required: true, index: true },

    location: { type: pointSchema, required: true },
    installedAt: { type: Date, default: Date.now },

    unit: { type: String, default: '' },
    /** Calibrated operating range — readings outside it flag a fault. */
    minValue: { type: Number, default: 0 },
    maxValue: { type: Number, default: 100 },
    /** Thresholds that push the sensor into `warning`. */
    warnAbove: { type: Number, default: null },
    warnBelow: { type: Number, default: null },

    /** Cached latest reading. */
    currentValue: { type: Number, default: 0 },
    lastReadingAt: { type: Date, default: null },

    status: { type: String, enum: SENSOR_STATUS, default: 'online', index: true },
    source: { type: String, enum: SENSOR_SOURCES, default: 'device', index: true },
    /** Battery and firmware describe hardware; null for a virtual sensor. */
    batteryLevel: { type: Number, min: 0, max: 100, default: null },
    firmware: { type: String, default: '' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

sensorSchema.plugin(toJSONPlugin);

sensorSchema.index({ location: '2dsphere' });
sensorSchema.index({ park: 1, type: 1 });

/** Fill unit and thresholds from the profile when they were not supplied. */
sensorSchema.pre('validate', function applyProfile(next) {
  const profile = SENSOR_PROFILES[this.type];
  if (profile) {
    if (!this.unit) this.unit = profile.unit;
    if (this.warnAbove == null && profile.warnAbove != null) this.warnAbove = profile.warnAbove;
    if (this.warnBelow == null && profile.warnBelow != null) this.warnBelow = profile.warnBelow;
  }
  next();
});

module.exports = mongoose.model('Sensor', sensorSchema);
module.exports.SENSOR_TYPES = SENSOR_TYPES;
module.exports.SENSOR_STATUS = SENSOR_STATUS;
module.exports.SENSOR_PROFILES = SENSOR_PROFILES;
module.exports.SENSOR_SOURCES = SENSOR_SOURCES;
module.exports.LIVE_TYPES = LIVE_TYPES;

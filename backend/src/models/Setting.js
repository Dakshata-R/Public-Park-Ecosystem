'use strict';

/**
 * Module 12 — Administration: runtime configuration.
 *
 * A single-document collection (`key: 'system'`). Values here are things an
 * administrator may change without a redeploy — most importantly the weights
 * used by the ecosystem health index, which the scoring service reads on
 * every computation.
 */

const mongoose = require('mongoose');
const toJSONPlugin = require('./plugins/toJSON');

const settingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: 'system' },

    organisationName: { type: String, default: 'Smart City Parks & Environment Department' },
    city: { type: String, default: 'Smart City' },
    contactEmail: { type: String, default: 'parks@smartcity.gov' },

    /**
     * Weights of the Ecosystem Health Index. Must sum to 1; the scoring
     * service re-normalises defensively if an admin saves values that do not.
     */
    healthIndexWeights: {
      air: { type: Number, default: 0.25, min: 0, max: 1 },
      water: { type: Number, default: 0.2, min: 0, max: 1 },
      soil: { type: Number, default: 0.15, min: 0, max: 1 },
      tree: { type: Number, default: 0.2, min: 0, max: 1 },
      biodiversity: { type: Number, default: 0.2, min: 0, max: 1 },
    },

    /** Standard deviations from the mean before a reading is an anomaly. */
    anomalyZThreshold: { type: Number, default: 3, min: 1, max: 6 },

    /** Minimum confidence (%) before an AI detection may auto-open an incident. */
    aiAutoIncidentConfidence: { type: Number, default: 85, min: 0, max: 100 },

    enableSensorSimulation: { type: Boolean, default: true },
    enablePublicReporting: { type: Boolean, default: true },
    mapDefaultZoom: { type: Number, default: 13, min: 1, max: 20 },
  },
  { timestamps: true }
);

settingSchema.plugin(toJSONPlugin);

/** Fetch the singleton, creating it with defaults on first use. */
settingSchema.statics.current = async function current() {
  return this.findOneAndUpdate(
    { key: 'system' },
    { $setOnInsert: { key: 'system' } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

module.exports = mongoose.model('Setting', settingSchema);

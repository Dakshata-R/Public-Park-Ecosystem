'use strict';

/**
 * Module 4 — Biodiversity Management: individual field sightings.
 *
 * Kept in its own collection rather than embedded in `Species` because
 * observations grow without bound and are the input to every biodiversity
 * calculation — the aggregation pipelines in
 * `services/biodiversity.service.js` group over this collection directly.
 */

const mongoose = require('mongoose');
const toJSONPlugin = require('./plugins/toJSON');
const { pointSchema } = require('./shared/geo');

const OBSERVATION_SOURCES = ['officer-survey', 'citizen-report', 'camera-trap', 'ai-detection'];

const observationSchema = new mongoose.Schema(
  {
    species: { type: mongoose.Schema.Types.ObjectId, ref: 'Species', required: true, index: true },
    park: { type: mongoose.Schema.Types.ObjectId, ref: 'Park', required: true, index: true },

    observedAt: { type: Date, required: true, default: Date.now, index: true },
    /** Number of individuals seen — the abundance term n_i in the indices. */
    count: { type: Number, required: true, min: 1, default: 1 },

    location: { type: pointSchema, required: true },
    locationName: { type: String, default: '' },

    observer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    observerName: { type: String, default: 'Anonymous' },
    source: { type: String, enum: OBSERVATION_SOURCES, default: 'officer-survey', index: true },

    /** Records sourced from citizens are only counted once verified. */
    verified: { type: Boolean, default: false, index: true },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    notes: { type: String, default: '', maxlength: 1000 },
    images: { type: [String], default: [] },
  },
  { timestamps: true }
);

observationSchema.plugin(toJSONPlugin);

observationSchema.index({ location: '2dsphere' });
observationSchema.index({ park: 1, observedAt: -1 });
observationSchema.index({ species: 1, observedAt: -1 });

module.exports = mongoose.model('Observation', observationSchema);
module.exports.OBSERVATION_SOURCES = OBSERVATION_SOURCES;

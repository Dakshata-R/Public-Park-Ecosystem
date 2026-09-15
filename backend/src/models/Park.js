'use strict';

/**
 * Module 3 / Module 12 — Park: the central entity every other collection
 * references.
 *
 * Geometry is stored as GeoJSON so MongoDB's 2dsphere index can answer
 * "which park contains this point" and "what is within 500 m" queries, and so
 * the payload can be handed almost directly to Leaflet on the frontend.
 */

const mongoose = require('mongoose');
const toJSONPlugin = require('./plugins/toJSON');
const { pointSchema, polygonSchema } = require('./shared/geo');

const parkSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true, maxlength: 160 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String, default: '', maxlength: 2000 },

    /** Centre marker used for map fly-to and as a fallback location. */
    location: { type: pointSchema, required: true },
    /** Optional boundary drawn on the map. */
    boundary: { type: polygonSchema, default: undefined },

    areaAcres: { type: Number, min: 0, default: 0 },
    /** Unknown (null) unless a footfall count exists — never estimated. */
    weeklyVisitors: { type: Number, min: 0, default: null },
    establishedYear: { type: Number, min: 1600, max: 2100, default: null },

    address: { type: String, default: '' },
    city: { type: String, default: 'Bengaluru' },
    manager: { type: String, default: '' },
    openingHours: { type: String, default: '' },

    /**
     * Where the park record came from, e.g. `{ provider: 'OpenStreetMap',
     * id: 'way/22895320' }` — so the boundary can be traced and refreshed.
     */
    source: {
      provider: { type: String, default: '' },
      id: { type: String, default: '' },
    },

    /**
     * Latest computed indices, cached by the ecosystem-score service so a
     * dashboard read stays a single query. null means "not measured". See
     * `services/ecosystem-score.service.js` for the derivation.
     */
    scores: {
      ecosystemHealth: { type: Number, min: 0, max: 100, default: null },
      biodiversity: { type: Number, min: 0, max: 100, default: null },
      airQuality: { type: Number, min: 0, max: 100, default: null },
      waterQuality: { type: Number, min: 0, max: 100, default: null },
      soilHealth: { type: Number, min: 0, max: 100, default: null },
      treeHealth: { type: Number, min: 0, max: 100, default: null },
      computedAt: { type: Date, default: null },
    },

    facilities: { type: [String], default: [] },
    images: { type: [String], default: [] },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

parkSchema.plugin(toJSONPlugin);

parkSchema.index({ location: '2dsphere' });
parkSchema.index({ name: 'text', description: 'text' });

module.exports = mongoose.model('Park', parkSchema);

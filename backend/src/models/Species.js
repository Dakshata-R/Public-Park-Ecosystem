'use strict';

/**
 * Module 4 — Biodiversity Management: the species catalogue.
 *
 * Population counts are NOT stored here. They are derived from the
 * `Observation` collection so the biodiversity indices in
 * `services/biodiversity.service.js` always reflect actual field records
 * rather than a manually edited number that drifts out of date.
 */

const mongoose = require('mongoose');
const toJSONPlugin = require('./plugins/toJSON');

const SPECIES_CLASSES = ['bird', 'mammal', 'butterfly', 'reptile', 'amphibian', 'tree', 'plant', 'insect'];

/** IUCN Red List categories, ordered from least to most at risk. */
const CONSERVATION_STATUSES = [
  'Least Concern',
  'Near Threatened',
  'Vulnerable',
  'Endangered',
  'Critically Endangered',
];

const speciesSchema = new mongoose.Schema(
  {
    commonName: { type: String, required: true, trim: true, maxlength: 160 },
    scientificName: { type: String, required: true, unique: true, trim: true },
    class: { type: String, enum: SPECIES_CLASSES, required: true, index: true },
    family: { type: String, default: '', trim: true },

    conservationStatus: {
      type: String,
      enum: CONSERVATION_STATUSES,
      default: 'Least Concern',
      index: true,
    },

    habitat: { type: String, default: '' },
    description: { type: String, default: '', maxlength: 3000 },

    /** True when the species does not belong to this ecosystem. */
    isInvasive: { type: Boolean, default: false },
    /** True when it is a keystone / indicator species for health scoring. */
    isIndicator: { type: Boolean, default: false },

    /** Months (1–12) in which the species is normally present. */
    seasonality: { type: [Number], default: [] },

    /** Parks in which the species has been recorded at least once. */
    parks: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Park' }],

    images: { type: [String], default: [] },
  },
  { timestamps: true }
);

speciesSchema.plugin(toJSONPlugin);

speciesSchema.index({ commonName: 'text', scientificName: 'text', habitat: 'text' });

module.exports = mongoose.model('Species', speciesSchema);
module.exports.SPECIES_CLASSES = SPECIES_CLASSES;
module.exports.CONSERVATION_STATUSES = CONSERVATION_STATUSES;

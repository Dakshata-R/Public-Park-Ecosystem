'use strict';

/**
 * Module 3 — Park Asset Management.
 *
 * One collection holds every physical thing in a park (trees, benches, lakes,
 * paths, lights, plant beds). Type-specific attributes live in the free-form
 * `attributes` map rather than in six near-identical collections, which keeps
 * inventory queries and the asset table generic.
 *
 * Maintenance history is embedded because records are always read together
 * with their asset, are append-only, and are bounded in practice.
 */

const mongoose = require('mongoose');
const toJSONPlugin = require('./plugins/toJSON');
const { pointSchema, lineStringSchema } = require('./shared/geo');

const ASSET_TYPES = ['tree', 'plant', 'bench', 'lake', 'path', 'light', 'structure'];
const CONDITION_STATUS = ['excellent', 'good', 'fair', 'poor', 'critical'];

const maintenanceRecordSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    type: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    cost: { type: Number, min: 0, default: 0 },
    technician: { type: String, default: '' },
  },
  { _id: true, timestamps: false }
);

const assetSchema = new mongoose.Schema(
  {
    assetCode: { type: String, required: true, unique: true, uppercase: true, trim: true },
    type: { type: String, enum: ASSET_TYPES, required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    park: { type: mongoose.Schema.Types.ObjectId, ref: 'Park', required: true, index: true },

    /** Representative point — the marker Leaflet drops for this asset. */
    location: { type: pointSchema, required: true },
    /**
     * Linear geometry, used only by `type: 'path'` so walking trails render
     * as polylines rather than a single pin.
     */
    path: { type: lineStringSchema, default: undefined },

    /**
     * Condition on a 0–100 scale. `status` is derived from it in the pre-save
     * hook so the two can never disagree.
     */
    condition: { type: Number, min: 0, max: 100, default: 100 },
    status: { type: String, enum: CONDITION_STATUS, default: 'good', index: true },

    installedAt: { type: Date },
    lastMaintenanceAt: { type: Date, default: null },
    nextMaintenanceDue: { type: Date, default: null },

    /** Type-specific fields, e.g. { species, heightM, dbhM } for a tree. */
    attributes: { type: Map, of: String, default: {} },

    maintenance: { type: [maintenanceRecordSchema], default: [] },

    notes: { type: String, default: '' },
    images: { type: [String], default: [] },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

assetSchema.plugin(toJSONPlugin);

assetSchema.index({ location: '2dsphere' });
assetSchema.index({ park: 1, type: 1 });
assetSchema.index({ name: 'text', assetCode: 'text' });

/** Map a 0–100 condition onto the five-band status vocabulary. */
function conditionToStatus(condition) {
  if (condition >= 85) return 'excellent';
  if (condition >= 70) return 'good';
  if (condition >= 50) return 'fair';
  if (condition >= 30) return 'poor';
  return 'critical';
}

assetSchema.pre('save', function deriveStatus(next) {
  if (this.isModified('condition')) this.status = conditionToStatus(this.condition);
  if (this.maintenance.length) {
    const latest = this.maintenance.reduce((a, b) => (a.date > b.date ? a : b));
    this.lastMaintenanceAt = latest.date;
  }
  next();
});

/** Keep `status` consistent when a document is updated through a query. */
assetSchema.pre('findOneAndUpdate', function deriveStatusOnUpdate(next) {
  const update = this.getUpdate() || {};
  const condition = update.condition ?? update.$set?.condition;
  if (condition !== undefined) {
    this.setUpdate({ ...update, $set: { ...(update.$set || {}), status: conditionToStatus(condition) } });
  }
  next();
});

module.exports = mongoose.model('Asset', assetSchema);
module.exports.ASSET_TYPES = ASSET_TYPES;
module.exports.CONDITION_STATUS = CONDITION_STATUS;
module.exports.conditionToStatus = conditionToStatus;

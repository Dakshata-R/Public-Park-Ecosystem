'use strict';

/**
 * Module 8 — Incident & Alert Management.
 *
 * `priorityScore` is a computed 0–100 number produced by
 * `services/priority.service.js`; `priority` is the band it falls into. The
 * numeric score is what the triage queue sorts on, which is why two "high"
 * incidents can still be ordered sensibly against each other.
 *
 * The status timeline is embedded so the incident detail view renders its
 * full history without a second query.
 */

const mongoose = require('mongoose');
const toJSONPlugin = require('./plugins/toJSON');
const { pointSchema } = require('./shared/geo');

const INCIDENT_TYPES = [
  'tree-fall',
  'illegal-dumping',
  'fire',
  'water-pollution',
  'dead-animal',
  'vandalism',
  'infrastructure-damage',
  'air-pollution',
];

const INCIDENT_PRIORITIES = ['low', 'medium', 'high', 'critical'];
const INCIDENT_STATUSES = ['reported', 'assigned', 'in-progress', 'resolved', 'closed'];
const INCIDENT_SOURCES = ['citizen-report', 'sensor-alert', 'ai-detection', 'officer-patrol'];

const timelineEntrySchema = new mongoose.Schema(
  {
    status: { type: String, enum: INCIDENT_STATUSES, required: true },
    note: { type: String, default: '' },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    byName: { type: String, default: 'System' },
    at: { type: Date, default: Date.now },
  },
  { _id: true }
);

// Embedded documents keep their own `_id`, so they need the same wire
// normalisation as top-level documents — otherwise a timeline entry reaches
// the client as `_id` while every other object in the payload uses `id`.
timelineEntrySchema.plugin(toJSONPlugin);

const incidentSchema = new mongoose.Schema(
  {
    referenceCode: { type: String, required: true, unique: true, uppercase: true },
    type: { type: String, enum: INCIDENT_TYPES, required: true, index: true },

    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: '', maxlength: 2000 },

    park: { type: mongoose.Schema.Types.ObjectId, ref: 'Park', required: true, index: true },
    location: { type: pointSchema, required: true },

    /** 0–100, computed. Sorting key for the triage queue. */
    priorityScore: { type: Number, min: 0, max: 100, default: 0, index: true },
    priority: { type: String, enum: INCIDENT_PRIORITIES, default: 'medium', index: true },

    status: { type: String, enum: INCIDENT_STATUSES, default: 'reported', index: true },
    source: { type: String, enum: INCIDENT_SOURCES, default: 'officer-patrol' },

    /** Estimated people affected — a factor in the priority formula. */
    affectedPeople: { type: Number, min: 0, default: 0 },
    /** Officer's severity judgement on a 1–5 scale, also a priority factor. */
    severity: { type: Number, min: 1, max: 5, default: 3 },
    /**
     * Community signal: upvotes on the citizen report this incident came
     * from, mirrored here so the priority formula can read it on every save.
     */
    upvotes: { type: Number, min: 0, default: 0 },

    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    assignedAt: { type: Date, default: null },
    reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    sourceReport: { type: mongoose.Schema.Types.ObjectId, ref: 'CitizenReport', default: null },

    reportedAt: { type: Date, default: Date.now, index: true },
    resolvedAt: { type: Date, default: null },
    /** Minutes between report and resolution; filled in on close. */
    resolutionMinutes: { type: Number, default: null },

    resolutionNotes: { type: String, default: '' },
    images: { type: [String], default: [] },
    timeline: { type: [timelineEntrySchema], default: [] },

    /** True for demonstration records created by the seeder. */
    demo: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

incidentSchema.plugin(toJSONPlugin);

incidentSchema.index({ location: '2dsphere' });
incidentSchema.index({ park: 1, status: 1, priorityScore: -1 });
incidentSchema.index({ title: 'text', description: 'text' });

/** Record the time-to-resolve the moment an incident is closed out. */
incidentSchema.pre('save', function stampResolution(next) {
  if (!this.isModified('status')) return next();

  if (['resolved', 'closed'].includes(this.status) && !this.resolvedAt) {
    this.resolvedAt = new Date();
    this.resolutionMinutes = Math.round((this.resolvedAt - this.reportedAt) / 60000);
  } else if (!['resolved', 'closed'].includes(this.status) && this.resolvedAt) {
    // Reopened: the earlier resolution no longer stands, and must not keep
    // counting towards mean resolution time.
    this.resolvedAt = null;
    this.resolutionMinutes = null;
  }
  next();
});

module.exports = mongoose.model('Incident', incidentSchema);
module.exports.INCIDENT_TYPES = INCIDENT_TYPES;
module.exports.INCIDENT_PRIORITIES = INCIDENT_PRIORITIES;
module.exports.INCIDENT_STATUSES = INCIDENT_STATUSES;
module.exports.INCIDENT_SOURCES = INCIDENT_SOURCES;

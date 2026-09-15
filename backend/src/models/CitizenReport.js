'use strict';

/**
 * Module 7 — Citizen Engagement Portal.
 *
 * A citizen submission is intentionally separate from `Incident`: reports are
 * unverified public input, incidents are the operational work items officers
 * act on. When an officer accepts a report, an incident is created and linked
 * back through `linkedIncident`, preserving the audit trail from citizen to
 * resolution.
 */

const mongoose = require('mongoose');
const toJSONPlugin = require('./plugins/toJSON');
const { pointSchema } = require('./shared/geo');

const REPORT_CATEGORIES = ['issue', 'wildlife-sighting', 'feedback', 'suggestion'];
const REPORT_STATUSES = ['submitted', 'in-review', 'accepted', 'resolved', 'rejected'];

const citizenReportSchema = new mongoose.Schema(
  {
    referenceCode: { type: String, required: true, unique: true, uppercase: true },
    category: { type: String, enum: REPORT_CATEGORIES, required: true, index: true },

    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, required: true, maxlength: 2000 },

    park: { type: mongoose.Schema.Types.ObjectId, ref: 'Park', required: true, index: true },
    location: { type: pointSchema, required: true },

    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    submittedByName: { type: String, default: 'Anonymous' },

    status: { type: String, enum: REPORT_STATUSES, default: 'submitted', index: true },
    /** Community signal used to break ties when triaging. */
    upvotes: { type: Number, default: 0, min: 0 },
    /** Who upvoted, so each account counts once. Never sent to clients. */
    upvotedBy: { type: [mongoose.Schema.Types.ObjectId], ref: 'User', default: [], select: false },

    images: { type: [String], default: [] },

    /** For wildlife sightings: the species the citizen (or the AI) identified. */
    species: { type: mongoose.Schema.Types.ObjectId, ref: 'Species', default: null },

    linkedIncident: { type: mongoose.Schema.Types.ObjectId, ref: 'Incident', default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    officialResponse: { type: String, default: '' },
    resolvedAt: { type: Date, default: null },

    /** True for demonstration records created by the seeder. */
    demo: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

citizenReportSchema.plugin(toJSONPlugin);

citizenReportSchema.index({ location: '2dsphere' });
citizenReportSchema.index({ park: 1, status: 1, createdAt: -1 });
citizenReportSchema.index({ title: 'text', description: 'text' });

module.exports = mongoose.model('CitizenReport', citizenReportSchema);
module.exports.REPORT_CATEGORIES = REPORT_CATEGORIES;
module.exports.REPORT_STATUSES = REPORT_STATUSES;

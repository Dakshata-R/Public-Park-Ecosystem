'use strict';

/**
 * Module 10 — Analytics & Reports: saved ecological assessments.
 *
 * The metric snapshot is stored with the document so a published report keeps
 * showing the figures it was written against, even after the underlying
 * scores move on.
 */

const mongoose = require('mongoose');
const toJSONPlugin = require('./plugins/toJSON');

const REPORT_TYPES = ['ecosystem', 'biodiversity', 'water', 'air', 'soil', 'maintenance', 'engagement'];
const REPORT_STATUSES = ['draft', 'published', 'archived'];

const ecoReportSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 240 },
    type: { type: String, enum: REPORT_TYPES, required: true, index: true },
    summary: { type: String, default: '', maxlength: 4000 },

    park: { type: mongoose.Schema.Types.ObjectId, ref: 'Park', default: null, index: true },

    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    authorName: { type: String, default: '' },

    periodStart: { type: Date, default: null },
    periodEnd: { type: Date, default: null },

    /** Frozen metrics as of publication — free-form by report type. */
    metrics: { type: mongoose.Schema.Types.Mixed, default: {} },
    findings: { type: [String], default: [] },
    recommendations: { type: [String], default: [] },

    status: { type: String, enum: REPORT_STATUSES, default: 'draft', index: true },
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

ecoReportSchema.plugin(toJSONPlugin);

ecoReportSchema.index({ title: 'text', summary: 'text' });

ecoReportSchema.pre('save', function stampPublication(next) {
  if (this.isModified('status') && this.status === 'published' && !this.publishedAt) {
    this.publishedAt = new Date();
  }
  next();
});

module.exports = mongoose.model('EcoReport', ecoReportSchema);
module.exports.REPORT_TYPES = REPORT_TYPES;
module.exports.REPORT_STATUSES = REPORT_STATUSES;

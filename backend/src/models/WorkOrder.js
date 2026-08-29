'use strict';

/**
 * Module 9 — Maintenance Management.
 *
 * A work order is the scheduled counterpart to an incident: incidents are
 * unplanned events, work orders are planned tasks. A work order may be raised
 * from an incident (`sourceIncident`) or from a maintenance schedule.
 */

const mongoose = require('mongoose');
const toJSONPlugin = require('./plugins/toJSON');

const WORK_ORDER_TYPES = [
  'cleaning',
  'tree-trimming',
  'repair',
  'lake-cleaning',
  'inspection',
  'planting',
  'irrigation',
];

const WORK_ORDER_STATUSES = ['scheduled', 'in-progress', 'completed', 'overdue', 'cancelled'];
const WORK_ORDER_PRIORITIES = ['low', 'medium', 'high', 'critical'];

const workOrderSchema = new mongoose.Schema(
  {
    orderCode: { type: String, required: true, unique: true, uppercase: true },
    type: { type: String, enum: WORK_ORDER_TYPES, required: true, index: true },

    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: '', maxlength: 2000 },

    park: { type: mongoose.Schema.Types.ObjectId, ref: 'Park', required: true, index: true },
    asset: { type: mongoose.Schema.Types.ObjectId, ref: 'Asset', default: null },
    assetName: { type: String, default: '' },

    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    assignedTeam: { type: String, default: '' },

    scheduledDate: { type: Date, required: true, index: true },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },

    priority: { type: String, enum: WORK_ORDER_PRIORITIES, default: 'medium', index: true },
    status: { type: String, enum: WORK_ORDER_STATUSES, default: 'scheduled', index: true },
    progress: { type: Number, min: 0, max: 100, default: 0 },

    estimatedCost: { type: Number, min: 0, default: 0 },
    actualCost: { type: Number, min: 0, default: 0 },
    estimatedHours: { type: Number, min: 0, default: 1 },

    sourceIncident: { type: mongoose.Schema.Types.ObjectId, ref: 'Incident', default: null },
    /** Set for repeating tasks, e.g. 'weekly' cleaning rounds. */
    recurrence: { type: String, enum: ['none', 'weekly', 'monthly', 'quarterly', 'yearly'], default: 'none' },

    completionNotes: { type: String, default: '' },
  },
  { timestamps: true }
);

workOrderSchema.plugin(toJSONPlugin);

workOrderSchema.index({ park: 1, status: 1, scheduledDate: 1 });
workOrderSchema.index({ title: 'text', description: 'text' });

/** Keep progress, status and completion timestamp mutually consistent. */
workOrderSchema.pre('save', function syncStatus(next) {
  if (this.isModified('progress')) {
    if (this.progress >= 100) this.status = 'completed';
    else if (this.progress > 0 && this.status === 'scheduled') this.status = 'in-progress';
  }

  if (this.isModified('status')) {
    if (this.status === 'completed') {
      this.progress = 100;
      if (!this.completedAt) this.completedAt = new Date();
    }
    if (this.status === 'in-progress' && !this.startedAt) this.startedAt = new Date();
  }

  // A scheduled task whose date has passed is overdue.
  if (this.status === 'scheduled' && this.scheduledDate < new Date()) {
    this.status = 'overdue';
  }

  next();
});

module.exports = mongoose.model('WorkOrder', workOrderSchema);
module.exports.WORK_ORDER_TYPES = WORK_ORDER_TYPES;
module.exports.WORK_ORDER_STATUSES = WORK_ORDER_STATUSES;
module.exports.WORK_ORDER_PRIORITIES = WORK_ORDER_PRIORITIES;

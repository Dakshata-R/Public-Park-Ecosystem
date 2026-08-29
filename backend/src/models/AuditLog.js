'use strict';

/**
 * Module 12 — Administration: an append-only record of state changes.
 *
 * Municipal systems need to answer "who changed this and when". Every
 * create/update/delete that goes through the CRUD factory writes one entry
 * here. Entries are never modified — corrections are new entries.
 */

const mongoose = require('mongoose');
const toJSONPlugin = require('./plugins/toJSON');

const AUDIT_ACTIONS = ['create', 'update', 'delete', 'login', 'logout', 'assign', 'resolve', 'seed'];

const auditLogSchema = new mongoose.Schema(
  {
    action: { type: String, enum: AUDIT_ACTIONS, required: true, index: true },
    /** Mongoose model name the action applied to, e.g. 'Incident'. */
    entity: { type: String, required: true, index: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, default: null },
    entityLabel: { type: String, default: '' },

    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    actorName: { type: String, default: 'System' },
    actorRole: { type: String, default: 'system' },

    /** Changed fields only — `{ field: { from, to } }`. */
    changes: { type: mongoose.Schema.Types.Mixed, default: {} },

    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.plugin(toJSONPlugin);

auditLogSchema.index({ entity: 1, entityId: 1, createdAt: -1 });
auditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
module.exports.AUDIT_ACTIONS = AUDIT_ACTIONS;

'use strict';

/**
 * Audit trail writer — Module 12.
 *
 * Logging must never break the operation it is recording, so every failure
 * here is swallowed and logged rather than propagated.
 */

const { AuditLog } = require('../models');
const logger = require('../utils/logger');

/** Fields that must never appear in an audit diff. */
const REDACTED = new Set(['password', 'token', 'refreshToken']);

/**
 * Compute a shallow `{field: {from, to}}` diff between two objects,
 * considering only the keys actually present in `next`.
 */
function diff(previous = {}, next = {}) {
  const changes = {};
  for (const key of Object.keys(next)) {
    if (REDACTED.has(key)) {
      changes[key] = { from: '[redacted]', to: '[redacted]' };
      continue;
    }
    const before = previous?.[key];
    const after = next[key];
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      changes[key] = { from: before ?? null, to: after ?? null };
    }
  }
  return changes;
}

/**
 * Write one audit entry.
 *
 * @param {object} entry
 * @param {string} entry.action
 * @param {string} entry.entity
 * @param {*} [entry.entityId]
 * @param {string} [entry.entityLabel]
 * @param {object} [entry.changes]
 * @param {object} [entry.req] Express request, for actor and client details
 */
async function record({ action, entity, entityId, entityLabel = '', changes = {}, req }) {
  try {
    await AuditLog.create({
      action,
      entity,
      entityId: entityId || null,
      entityLabel,
      changes,
      actor: req?.user?._id || null,
      actorName: req?.user?.name || 'System',
      actorRole: req?.user?.role || 'system',
      ip: req?.ip || '',
      userAgent: req?.get?.('user-agent') || '',
    });
  } catch (err) {
    logger.warn('Audit log write failed:', err.message);
  }
}

module.exports = { record, diff };

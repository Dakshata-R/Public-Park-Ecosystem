'use strict';

/**
 * Module 12 — Administration: users, system settings, audit log, and the
 * maintenance actions an administrator needs (rescore, reseed, reindex).
 */

const mongoose = require('mongoose');
const { User, Setting, AuditLog, Park, Species, Sensor, Asset, Incident, CitizenReport, WorkOrder, AiDetection } = require('../models');
const { createCrudController, normaliseId } = require('./crud.factory');
const asyncHandler = require('../middleware/asyncHandler');
const { ok } = require('../utils/response');
const ApiError = require('../utils/ApiError');
const { parsePagination, parseSort, buildFilter, buildMeta } = require('../utils/query');
const { refreshAllParkScores } = require('../services/ecosystem-score.service');
const assistant = require('../services/assistant.service');
const audit = require('../services/audit.service');

const userCrud = createCrudController({
  model: User,
  name: 'User',
  filterable: ['role', 'active', 'park'],
  searchable: ['name', 'email'],
  populate: { path: 'park', select: 'name slug' },
  defaultSort: { createdAt: -1 },
  softDelete: true,
  beforeUpdate: async (body, doc, req) => {
    // An administrator must not be able to strip their own admin rights and
    // lock the platform out of administration.
    if (body.role && body.role !== doc.role && String(doc._id) === String(req.user._id)) {
      throw ApiError.badRequest('You cannot change your own role');
    }
    return body;
  },
  beforeDelete: async (doc, req) => {
    if (String(doc._id) === String(req.user._id)) {
      throw ApiError.badRequest('You cannot deactivate your own account');
    }
  },
});

/** GET /api/admin/settings */
const getSettings = asyncHandler(async (_req, res) => ok(res, await Setting.current()));

/**
 * PATCH /api/admin/settings
 * The health-index weights are the most consequential setting here — they
 * change every score in the system — so they are validated before saving.
 */
const updateSettings = asyncHandler(async (req, res) => {
  const settings = await Setting.current();
  const previous = settings.toObject();

  if (req.body.healthIndexWeights) {
    const weights = { ...previous.healthIndexWeights, ...req.body.healthIndexWeights };
    const sum = Object.values(weights).reduce((a, b) => a + Number(b || 0), 0);
    if (sum <= 0) throw ApiError.badRequest('Health index weights must sum to a positive value');
    if (Math.abs(sum - 1) > 0.01) {
      throw ApiError.badRequest(
        `Health index weights must sum to 1.00 (they currently sum to ${sum.toFixed(2)})`
      );
    }
    settings.healthIndexWeights = weights;
  }

  const editable = [
    'organisationName', 'city', 'contactEmail', 'anomalyZThreshold',
    'aiAutoIncidentConfidence', 'enableSensorSimulation', 'enablePublicReporting', 'mapDefaultZoom',
  ];
  for (const key of editable) {
    if (req.body[key] !== undefined) settings[key] = req.body[key];
  }

  await settings.save();

  await audit.record({
    action: 'update',
    entity: 'Setting',
    entityId: settings._id,
    entityLabel: 'system',
    changes: audit.diff(previous, req.body),
    req,
  });

  // Weight changes invalidate every cached park score.
  if (req.body.healthIndexWeights) await refreshAllParkScores();

  return ok(res, settings);
});

/** GET /api/admin/audit-log */
const getAuditLog = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const sort = parseSort(req.query.sort, { createdAt: -1 });
  const filter = buildFilter(req.query, {
    allowed: ['action', 'entity', 'actor', 'actorRole'],
    searchable: ['entityLabel', 'actorName'],
  });

  const [entries, total] = await Promise.all([
    AuditLog.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    AuditLog.countDocuments(filter),
  ]);

  return ok(res, entries.map(normaliseId), buildMeta(total, { page, limit }));
});

/**
 * GET /api/admin/stats
 * Collection sizes and database health — the "is anything wrong" view.
 */
const getSystemStats = asyncHandler(async (_req, res) => {
  const models = { Park, User, Species, Sensor, Asset, Incident, CitizenReport, WorkOrder, AiDetection };

  const counts = Object.fromEntries(
    await Promise.all(
      Object.entries(models).map(async ([name, model]) => [name, await model.estimatedDocumentCount()])
    )
  );

  const usersByRole = await User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]);

  const connection = mongoose.connection;
  const STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'];

  return ok(res, {
    counts,
    usersByRole: Object.fromEntries(usersByRole.map((u) => [u._id, u.count])),
    database: {
      name: connection.name,
      state: STATES[connection.readyState] || 'unknown',
      collections: Object.keys(connection.collections).length,
    },
    runtime: {
      node: process.version,
      uptimeSeconds: Math.round(process.uptime()),
      memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      environment: process.env.NODE_ENV || 'development',
    },
  });
});

/** POST /api/admin/recompute-scores */
const recomputeScores = asyncHandler(async (req, res) => {
  const results = await refreshAllParkScores();
  await audit.record({ action: 'update', entity: 'Park', entityLabel: 'all parks — scores recomputed', req });
  return ok(res, { parks: results.length, results });
});

/** POST /api/admin/reindex-assistant */
const reindexAssistant = asyncHandler(async (_req, res) => {
  const corpus = await assistant.getCorpus(true);
  return ok(res, { documents: corpus.docs.length, vocabulary: corpus.idf.size });
});

/**
 * POST /api/admin/reseed
 * Wipes and regenerates the demo dataset. Guarded behind the admin role and
 * refused outright in production, because it is destructive by design.
 */
const reseed = asyncHandler(async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    throw ApiError.forbidden('Reseeding is disabled in production');
  }

  const { seedDatabase } = require('../seed/seed');
  const summary = await seedDatabase({ force: true });

  await audit.record({ action: 'seed', entity: 'Database', entityLabel: 'demo dataset regenerated', req });

  return ok(res, summary);
});

module.exports = {
  users: userCrud,
  getSettings,
  updateSettings,
  getAuditLog,
  getSystemStats,
  recomputeScores,
  reindexAssistant,
  reseed,
};

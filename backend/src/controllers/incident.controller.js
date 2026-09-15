'use strict';

/**
 * Module 8 — Incident & Alert Management.
 *
 * Priority is never accepted from the client. Every write recomputes it from
 * the incident's own attributes through `priority.service`, which is what
 * makes "priority-based solving" a property of the system rather than a
 * convention people are asked to follow.
 */

const { Incident, Alert, User, WorkOrder } = require('../models');
const { createCrudController, normaliseId } = require('./crud.factory');
const asyncHandler = require('../middleware/asyncHandler');
const { ok, created } = require('../utils/response');
const ApiError = require('../utils/ApiError');
const { scoreIncident, buildTriageQueue, TYPE_PROFILE } = require('../services/priority.service');
const alertService = require('../services/alert.service');
const audit = require('../services/audit.service');
const { nextCode, year } = require('../utils/sequence');
const { queryObjectId } = require('../utils/objectId');
const { generateOrderCode } = require('./maintenance.controller');

/** `INC-2026-0042` — year-scoped so codes stay short and readable. */
const generateReferenceCode = () =>
  nextCode({ model: Incident, field: 'referenceCode', prefix: `INC-${year()}` });

/** Apply the computed triage score to a document before it is saved. */
function applyPriority(doc) {
  const triage = scoreIncident(
    {
      type: doc.type,
      severity: doc.severity,
      affectedPeople: doc.affectedPeople,
      upvotes: doc.upvotes || 0,
      reportedAt: doc.reportedAt,
      status: doc.status,
    },
    new Date()
  );
  doc.priorityScore = triage.score;
  doc.priority = triage.priority;
  return triage;
}

const crud = createCrudController({
  model: Incident,
  name: 'Incident',
  filterable: ['type', 'status', 'priority', 'park', 'assignedTo', 'source'],
  searchable: ['title', 'description', 'referenceCode'],
  populate: [
    { path: 'park', select: 'name slug' },
    { path: 'assignedTo', select: 'name email role' },
    { path: 'reportedBy', select: 'name role' },
  ],
  defaultSort: { priorityScore: -1, reportedAt: -1 },

  beforeCreate: async (body, req) => ({
    ...body,
    referenceCode: body.referenceCode || (await generateReferenceCode()),
    reportedBy: body.reportedBy || req.user?._id || null,
    reportedAt: body.reportedAt || new Date(),
    timeline: [
      {
        status: 'reported',
        note: 'Incident opened',
        by: req.user?._id || null,
        byName: req.user?.name || 'System',
      },
    ],
  }),

  afterCreate: async (doc, req) => {
    const triage = applyPriority(doc);
    await doc.save();

    // A critical incident must reach the dashboard immediately.
    if (['critical', 'high'].includes(doc.priority)) {
      await alertService.raise({
        title: `${doc.priority === 'critical' ? 'CRITICAL' : 'High priority'}: ${doc.title}`,
        message: `${triage.explanation} Reference ${doc.referenceCode}.`,
        module: 'Incident Management',
        source: 'incident',
        severity: doc.priority,
        park: doc.park,
        relatedModel: 'Incident',
        relatedId: doc._id,
        dedupeKey: `incident:${doc._id}`,
      });
    }
    void req;
  },

  beforeUpdate: async (body, doc, req) => {
    // Record a timeline entry whenever the status changes.
    if (body.status && body.status !== doc.status) {
      doc.timeline.push({
        status: body.status,
        note: body.statusNote || '',
        by: req.user?._id || null,
        byName: req.user?.name || 'System',
      });
    }
    const { statusNote, priority, priorityScore, ...rest } = body;
    return rest; // priority is computed, never client-supplied
  },

  afterUpdate: async (doc) => {
    applyPriority(doc);
    await doc.save();
    if (['resolved', 'closed'].includes(doc.status)) {
      await alertService.autoResolve(`incident:${doc._id}`);
    }
  },
});

/**
 * GET /api/incidents/triage
 * Open incidents in the order they should be worked, each carrying the full
 * factor breakdown so an officer can see *why* it ranks where it does.
 */
const getTriageQueue = asyncHandler(async (req, res) => {
  const filter = { status: { $nin: ['resolved', 'closed'] } };
  if (req.query.park) filter.park = req.query.park;

  const incidents = await Incident.find(filter)
    .populate('park', 'name slug')
    .populate('assignedTo', 'name role')
    .lean();

  const queue = buildTriageQueue(incidents.map(normaliseId));

  return ok(res, queue, {
    total: queue.length,
    overdue: queue.filter((i) => i.triage.isOverdue).length,
    critical: queue.filter((i) => i.triage.priority === 'critical').length,
  });
});

/** POST /api/incidents/:id/assign */
const assign = asyncHandler(async (req, res) => {
  const incident = await Incident.findById(req.params.id);
  if (!incident) throw ApiError.notFound('Incident');

  const officer = await User.findById(req.body.assignedTo);
  if (!officer) throw ApiError.badRequest('The selected officer does not exist');
  if (!['officer', 'admin', 'ecologist'].includes(officer.role)) {
    throw ApiError.badRequest('Incidents can only be assigned to officers, ecologists or administrators');
  }

  incident.assignedTo = officer._id;
  incident.assignedAt = new Date();
  if (incident.status === 'reported') incident.status = 'assigned';
  incident.timeline.push({
    status: incident.status,
    note: `Assigned to ${officer.name}`,
    by: req.user._id,
    byName: req.user.name,
  });
  await incident.save();

  await audit.record({
    action: 'assign',
    entity: 'Incident',
    entityId: incident._id,
    entityLabel: incident.referenceCode,
    changes: { assignedTo: { from: null, to: officer.name } },
    req,
  });

  return ok(res, await incident.populate([{ path: 'assignedTo', select: 'name email role' }, { path: 'park', select: 'name' }]));
});

/** POST /api/incidents/:id/resolve */
const resolve = asyncHandler(async (req, res) => {
  const incident = await Incident.findById(req.params.id);
  if (!incident) throw ApiError.notFound('Incident');

  incident.status = 'resolved';
  incident.resolutionNotes = req.body.resolutionNotes || '';
  incident.timeline.push({
    status: 'resolved',
    note: incident.resolutionNotes,
    by: req.user._id,
    byName: req.user.name,
  });
  await incident.save(); // pre-save hook stamps resolvedAt / resolutionMinutes

  await alertService.autoResolve(`incident:${incident._id}`);
  await audit.record({
    action: 'resolve',
    entity: 'Incident',
    entityId: incident._id,
    entityLabel: incident.referenceCode,
    req,
  });

  return ok(res, incident);
});

/**
 * POST /api/incidents/:id/work-order
 * Raise the maintenance task that will actually fix the incident, carrying
 * the priority across so the queue order is preserved.
 */
const createWorkOrder = asyncHandler(async (req, res) => {
  const incident = await Incident.findById(req.params.id);
  if (!incident) throw ApiError.notFound('Incident');

  // One live work order per incident: a double-click must not dispatch two crews.
  const existing = await WorkOrder.findOne({
    sourceIncident: incident._id,
    status: { $in: ['scheduled', 'in-progress', 'overdue'] },
  }).select('orderCode');
  if (existing) {
    throw ApiError.conflict(`Work order ${existing.orderCode} is already open for this incident`);
  }

  const workOrder = await WorkOrder.create({
    orderCode: await generateOrderCode(),
    type: req.body.type || 'repair',
    title: req.body.title || `Resolve: ${incident.title}`,
    description: req.body.description || incident.description,
    park: incident.park,
    scheduledDate: req.body.scheduledDate || new Date(Date.now() + 86_400_000),
    priority: incident.priority,
    assignedTo: req.body.assignedTo || incident.assignedTo,
    assignedTeam: req.body.assignedTeam || '',
    estimatedCost: req.body.estimatedCost || 0,
    sourceIncident: incident._id,
  });

  if (incident.status === 'reported' || incident.status === 'assigned') {
    incident.status = 'in-progress';
    incident.timeline.push({
      status: 'in-progress',
      note: `Work order ${workOrder.orderCode} raised`,
      by: req.user._id,
      byName: req.user.name,
    });
    await incident.save();
  }

  return created(res, workOrder);
});

/** GET /api/incidents/stats */
const getStats = asyncHandler(async (req, res) => {
  const match = {};
  const park = queryObjectId(req.query.park, 'park');
  if (park) match.park = park;

  const [byType, byStatus, byPriority, resolution] = await Promise.all([
    Incident.aggregate([{ $match: match }, { $group: { _id: '$type', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    Incident.aggregate([{ $match: match }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    Incident.aggregate([{ $match: match }, { $group: { _id: '$priority', count: { $sum: 1 } } }]),
    Incident.aggregate([
      { $match: { ...match, resolutionMinutes: { $ne: null } } },
      {
        $group: {
          _id: '$type',
          avgMinutes: { $avg: '$resolutionMinutes' },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const activeAlerts = await Alert.countDocuments({ status: 'active', ...match });

  return ok(res, {
    byType: byType.map((t) => ({ type: t._id, label: TYPE_PROFILE[t._id]?.label || t._id, count: t.count })),
    byStatus: byStatus.map((s) => ({ status: s._id, count: s.count })),
    byPriority: byPriority.map((p) => ({ priority: p._id, count: p.count })),
    meanResolution: resolution.map((r) => ({
      type: r._id,
      hours: Math.round((r.avgMinutes / 60) * 10) / 10,
      targetHours: TYPE_PROFILE[r._id]?.responseHours ?? null,
      resolved: r.count,
    })),
    total: await Incident.countDocuments(match),
    open: await Incident.countDocuments({ ...match, status: { $nin: ['resolved', 'closed'] } }),
    activeAlerts,
  });
});

module.exports = { ...crud, getTriageQueue, assign, resolve, createWorkOrder, getStats, generateReferenceCode };

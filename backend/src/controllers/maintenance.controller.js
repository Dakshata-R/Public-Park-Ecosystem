'use strict';

/**
 * Module 9 — Maintenance Management.
 */

const { WorkOrder, Asset } = require('../models');
const { createCrudController, normaliseId } = require('./crud.factory');
const asyncHandler = require('../middleware/asyncHandler');
const { ok } = require('../utils/response');
const ApiError = require('../utils/ApiError');
const { nextCode, year } = require('../utils/sequence');
const { queryObjectId } = require('../utils/objectId');

const generateOrderCode = () =>
  nextCode({ model: WorkOrder, field: 'orderCode', prefix: `WO-${year()}` });

/**
 * A scheduled order becomes overdue the moment its date passes, not the next
 * time someone happens to save it. Run before every read that reports status,
 * and on a timer by the server.
 *
 * @returns {Promise<number>} orders newly marked overdue
 */
async function markOverdueOrders(now = new Date()) {
  const result = await WorkOrder.updateMany(
    { status: 'scheduled', scheduledDate: { $lt: now } },
    { $set: { status: 'overdue' } }
  );
  return result.modifiedCount || 0;
}

const crud = createCrudController({
  model: WorkOrder,
  name: 'Work order',
  filterable: ['type', 'status', 'priority', 'park', 'assignedTo'],
  searchable: ['title', 'description', 'orderCode', 'assetName'],
  populate: [
    { path: 'park', select: 'name slug' },
    { path: 'assignedTo', select: 'name email role' },
    { path: 'asset', select: 'name assetCode type condition' },
    { path: 'sourceIncident', select: 'referenceCode priority' },
  ],
  defaultSort: { scheduledDate: 1 },

  beforeCreate: async (body) => ({
    ...body,
    orderCode: body.orderCode || (await generateOrderCode()),
  }),

  afterUpdate: async (doc) => {
    // Completing a work order is what actually restores an asset's condition,
    // so the inventory and the maintenance log cannot drift apart.
    if (doc.status === 'completed' && doc.asset) {
      const asset = await Asset.findById(doc.asset);
      if (asset) {
        const alreadyLogged = asset.maintenance.some(
          (m) => m.description === `Work order ${doc.orderCode}`
        );
        if (!alreadyLogged) {
          asset.maintenance.push({
            date: doc.completedAt || new Date(),
            type: doc.type,
            description: `Work order ${doc.orderCode}`,
            cost: doc.actualCost || doc.estimatedCost || 0,
            technician: doc.assignedTeam || '',
          });
          asset.condition = Math.min(100, asset.condition + 15);
          await asset.save();
        }
      }
    }
  },
});

/**
 * GET /api/maintenance/calendar?month=YYYY-MM
 * Work orders grouped by day, for the calendar view.
 */
const getCalendar = asyncHandler(async (req, res) => {
  const monthParam = req.query.month || new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(monthParam)) {
    throw ApiError.badRequest('`month` must be in YYYY-MM format');
  }

  const [year, month] = monthParam.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));

  const filter = { scheduledDate: { $gte: start, $lt: end } };
  if (req.query.park) filter.park = queryObjectId(req.query.park, 'park');

  await markOverdueOrders();
  const orders = await WorkOrder.find(filter)
    .sort({ scheduledDate: 1 })
    .populate('park', 'name')
    .populate('assignedTo', 'name')
    .lean();

  /** @type {Record<string, object[]>} */
  const days = {};
  for (const order of orders) {
    const key = new Date(order.scheduledDate).toISOString().slice(0, 10);
    (days[key] ||= []).push(normaliseId(order));
  }

  return ok(res, { month: monthParam, days }, { total: orders.length });
});

/** GET /api/maintenance/stats */
const getStats = asyncHandler(async (req, res) => {
  const match = {};
  const park = queryObjectId(req.query.park, 'park');
  if (park) match.park = park;

  await markOverdueOrders();

  const [byStatus, byType, cost, workload] = await Promise.all([
    WorkOrder.aggregate([{ $match: match }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    WorkOrder.aggregate([
      { $match: match },
      { $group: { _id: '$type', count: { $sum: 1 }, cost: { $sum: '$estimatedCost' } } },
      { $sort: { count: -1 } },
    ]),
    WorkOrder.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          estimated: { $sum: '$estimatedCost' },
          actual: { $sum: '$actualCost' },
        },
      },
    ]),
    WorkOrder.aggregate([
      { $match: { ...match, assignedTo: { $ne: null }, status: { $in: ['scheduled', 'in-progress', 'overdue'] } } },
      { $group: { _id: '$assignedTo', open: { $sum: 1 } } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
      { $unwind: '$user' },
      { $project: { _id: 0, name: '$user.name', role: '$user.role', open: 1 } },
      { $sort: { open: -1 } },
    ]),
  ]);

  const statusCounts = Object.fromEntries(byStatus.map((s) => [s._id, s.count]));
  const completed = statusCounts.completed || 0;
  const total = byStatus.reduce((sum, s) => sum + s.count, 0);

  return ok(res, {
    byStatus: byStatus.map((s) => ({ status: s._id, count: s.count })),
    byType: byType.map((t) => ({ type: t._id, count: t.count, cost: t.cost })),
    workload,
    totals: {
      total,
      completed,
      overdue: statusCounts.overdue || 0,
      inProgress: statusCounts['in-progress'] || 0,
      /** Share of all work orders that reached completion. */
      completionRate: total ? Math.round((completed / total) * 1000) / 10 : 0,
      estimatedCost: cost[0]?.estimated || 0,
      actualCost: cost[0]?.actual || 0,
    },
  });
});

/** PATCH /api/maintenance/:id/progress */
const updateProgress = asyncHandler(async (req, res) => {
  const progress = Number(req.body.progress);
  if (!Number.isFinite(progress) || progress < 0 || progress > 100) {
    throw ApiError.badRequest('`progress` must be a number between 0 and 100');
  }

  const order = await WorkOrder.findById(req.params.id);
  if (!order) throw ApiError.notFound('Work order');

  order.progress = progress;
  if (req.body.completionNotes) order.completionNotes = req.body.completionNotes;
  if (req.body.actualCost !== undefined) order.actualCost = req.body.actualCost;
  await order.save(); // pre-save hook syncs status and completedAt

  if (order.status === 'completed' && order.asset) {
    const asset = await Asset.findById(order.asset);
    if (asset && !asset.maintenance.some((m) => m.description === `Work order ${order.orderCode}`)) {
      asset.maintenance.push({
        date: order.completedAt,
        type: order.type,
        description: `Work order ${order.orderCode}`,
        cost: order.actualCost || order.estimatedCost || 0,
        technician: order.assignedTeam || '',
      });
      asset.condition = Math.min(100, asset.condition + 15);
      await asset.save();
    }
  }

  return ok(res, order);
});

/** GET /api/maintenance — sweeps overdue orders first, so the list is current. */
const list = asyncHandler(async (req, res, next) => {
  await markOverdueOrders();
  return crud.list(req, res, next);
});

module.exports = { ...crud, list, getCalendar, getStats, updateProgress, generateOrderCode, markOverdueOrders };

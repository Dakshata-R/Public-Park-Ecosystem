'use strict';

/**
 * Module 3 — Park Asset Management.
 */

const { Asset, WorkOrder } = require('../models');
const { createCrudController, normaliseId } = require('./crud.factory');
const asyncHandler = require('../middleware/asyncHandler');
const { ok, created } = require('../utils/response');
const ApiError = require('../utils/ApiError');
const audit = require('../services/audit.service');
const { nextCode } = require('../utils/sequence');
const { queryObjectId } = require('../utils/objectId');

/**
 * Asset codes are human-facing (they appear on QR labels in the field), so
 * they are generated as `<TYPE-PREFIX>-<sequence>` rather than exposing an
 * ObjectId, from a counter that never reissues a number.
 */
const TYPE_PREFIX = {
  tree: 'TRE', plant: 'PLT', bench: 'BNC', lake: 'LAK',
  path: 'PTH', light: 'LGT', structure: 'STR',
};

const generateAssetCode = (type) =>
  nextCode({ model: Asset, field: 'assetCode', prefix: TYPE_PREFIX[type] || 'AST' });

const crud = createCrudController({
  model: Asset,
  name: 'Asset',
  filterable: ['type', 'status', 'park', 'active'],
  searchable: ['name', 'assetCode', 'notes'],
  populate: { path: 'park', select: 'name slug' },
  defaultSort: { createdAt: -1 },
  softDelete: true,
  beforeCreate: async (body) => ({
    ...body,
    assetCode: body.assetCode || (await generateAssetCode(body.type)),
  }),
});

/** GET /api/assets/stats — inventory rollup for the module header. */
const getStats = asyncHandler(async (req, res) => {
  // Aggregation pipelines skip Mongoose casting — the park id must be an ObjectId.
  const match = { active: true };
  const park = queryObjectId(req.query.park, 'park');
  if (park) match.park = park;

  const [byType, byStatus, overall] = await Promise.all([
    Asset.aggregate([
      { $match: match },
      { $group: { _id: '$type', count: { $sum: 1 }, avgCondition: { $avg: '$condition' } } },
      { $sort: { count: -1 } },
    ]),
    Asset.aggregate([
      { $match: match },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Asset.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          avgCondition: { $avg: '$condition' },
          maintenanceSpend: { $sum: { $sum: '$maintenance.cost' } },
        },
      },
    ]),
  ]);

  return ok(res, {
    byType: byType.map((t) => ({
      type: t._id,
      count: t.count,
      avgCondition: Math.round(t.avgCondition * 10) / 10,
    })),
    byStatus: byStatus.map((s) => ({ status: s._id, count: s.count })),
    total: overall[0]?.total || 0,
    avgCondition: Math.round((overall[0]?.avgCondition || 0) * 10) / 10,
    maintenanceSpend: Math.round(overall[0]?.maintenanceSpend || 0),
    needsAttention: await Asset.countDocuments({ ...match, condition: { $lt: 50 } }),
  });
});

/**
 * POST /api/assets/:id/maintenance
 * Appending a record also advances the asset's condition, because logging
 * maintenance without reflecting its effect would leave the inventory
 * permanently pessimistic.
 */
const addMaintenance = asyncHandler(async (req, res) => {
  const asset = await Asset.findById(req.params.id);
  if (!asset) throw ApiError.notFound('Asset');

  const record = {
    date: req.body.date || new Date(),
    type: req.body.type,
    description: req.body.description || '',
    cost: req.body.cost || 0,
    technician: req.body.technician || req.user?.name || '',
  };

  asset.maintenance.push(record);

  if (req.body.conditionAfter !== undefined) {
    asset.condition = req.body.conditionAfter;
  } else {
    // Routine work recovers a bounded amount of condition.
    asset.condition = Math.min(100, asset.condition + 10);
  }

  await asset.save();

  await audit.record({
    action: 'update',
    entity: 'Asset',
    entityId: asset._id,
    entityLabel: asset.name,
    changes: { maintenance: { from: 'appended', to: record.type } },
    req,
  });

  return created(res, asset);
});

/** GET /api/assets/:id/history — maintenance records plus related work orders. */
const getHistory = asyncHandler(async (req, res) => {
  const asset = await Asset.findById(req.params.id).lean();
  if (!asset) throw ApiError.notFound('Asset');

  const workOrders = await WorkOrder.find({ asset: asset._id })
    .sort({ scheduledDate: -1 })
    .populate('assignedTo', 'name')
    .lean();

  const maintenance = [...(asset.maintenance || [])].sort((a, b) => new Date(b.date) - new Date(a.date));

  return ok(res, {
    asset: normaliseId(asset),
    maintenance: maintenance.map(normaliseId),
    workOrders: workOrders.map(normaliseId),
    totalSpend: maintenance.reduce((sum, m) => sum + (m.cost || 0), 0),
  });
});

module.exports = { ...crud, getStats, addMaintenance, getHistory, generateAssetCode };

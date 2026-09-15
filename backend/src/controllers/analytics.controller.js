'use strict';

/**
 * Module 10 — Analytics & Reports.
 *
 * Everything here is read-only aggregation. Export is deliberately handled as
 * *data* export (JSON/CSV from the API) with PDF rendering left to the
 * browser: generating PDFs server-side would mean shipping a headless Chrome
 * into the deployment for a feature the client can do with jsPDF, which the
 * frontend already depends on.
 */

const {
  Incident, CitizenReport, WorkOrder, Observation,
  SensorReading, Park, Asset, AiDetection, EcoReport,
} = require('../models');
const { createCrudController } = require('./crud.factory');
const asyncHandler = require('../middleware/asyncHandler');
const { ok } = require('../utils/response');
const ApiError = require('../utils/ApiError');
const { analyseBiodiversity, computeIndices } = require('../services/biodiversity.service');
const { computeEcosystemHealth, normaliseReading } = require('../services/ecosystem-score.service');
const { queryObjectId } = require('../utils/objectId');

const { generateReport } = require('../services/report.service');
const { ROLE_RANK } = require('../middleware/auth');

const reportCrudBase = createCrudController({
  model: EcoReport,
  name: 'Report',
  filterable: ['type', 'status', 'park'],
  searchable: ['title', 'summary'],
  populate: [{ path: 'park', select: 'name slug' }, { path: 'author', select: 'name role' }],
  defaultSort: { createdAt: -1 },
  beforeCreate: async (body, req) => ({
    ...body,
    author: req.user?._id || null,
    authorName: body.authorName || req.user?.name || '',
  }),
});

/** Drafts are working documents: visitors below ecologist see published reports only. */
const isReportEditor = (req) => (ROLE_RANK[req.user?.role] || 0) >= ROLE_RANK.ecologist;

const reportCrud = {
  ...reportCrudBase,
  list: asyncHandler(async (req, res, next) => {
    if (!isReportEditor(req)) req.query.status = 'published';
    return reportCrudBase.list(req, res, next);
  }),
  getOne: asyncHandler(async (req, res, next) => {
    if (!isReportEditor(req)) {
      const report = await EcoReport.findById(req.params.id).select('status').lean();
      if (!report || report.status !== 'published') throw ApiError.notFound('Report');
    }
    return reportCrudBase.getOne(req, res, next);
  }),
  /** POST /api/analytics/reports/generate — a draft computed from recorded data. */
  generate: asyncHandler(async (req, res) => {
    const days = Math.min(730, Math.max(7, Number.parseInt(req.body.days, 10) || 90));
    const report = await generateReport({ type: req.body.type, parkId: req.body.park || null, days, user: req.user });
    const populated = await EcoReport.findById(report._id).populate([{ path: 'park', select: 'name slug' }, { path: 'author', select: 'name role' }]);
    return res.status(201).json({ success: true, data: populated });
  }),
};

/** Parse the shared `?from=&to=&park=` window used by every analytics query. */
function parseWindow(query) {
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from
    ? new Date(query.from)
    : new Date(to.getTime() - (Number(query.days) || 90) * 86_400_000);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw ApiError.badRequest('`from` and `to` must be valid dates');
  }
  if (from > to) throw ApiError.badRequest('`from` must be before `to`');
  return { from, to, parkId: queryObjectId(query.park, 'park') || null };
}

/**
 * GET /api/analytics/summary
 * The headline numbers for the analytics landing page.
 */
const getSummary = asyncHandler(async (req, res) => {
  const { from, to, parkId } = parseWindow(req.query);
  const parkMatch = parkId ? { park: parkId } : {};
  const window = { $gte: from, $lte: to };

  const [health, biodiversity, incidents, reports, orders, detections, assets] = await Promise.all([
    computeEcosystemHealth(parkId),
    analyseBiodiversity({ parkId, since: from }),
    Incident.aggregate([
      { $match: { ...parkMatch, reportedAt: window } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          resolved: { $sum: { $cond: [{ $in: ['$status', ['resolved', 'closed']] }, 1, 0] } },
          avgResolutionMinutes: { $avg: '$resolutionMinutes' },
          avgPriority: { $avg: '$priorityScore' },
        },
      },
    ]),
    CitizenReport.countDocuments({ ...parkMatch, createdAt: window }),
    WorkOrder.aggregate([
      { $match: { ...parkMatch, scheduledDate: window } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          cost: { $sum: '$actualCost' },
        },
      },
    ]),
    AiDetection.countDocuments({ ...parkMatch, createdAt: window }),
    Asset.aggregate([
      { $match: { ...parkMatch, active: true } },
      { $group: { _id: null, count: { $sum: 1 }, avgCondition: { $avg: '$condition' } } },
    ]),
  ]);

  const inc = incidents[0] || {};
  const wo = orders[0] || {};

  return ok(res, {
    window: { from, to },
    ecosystemHealth: health.ecosystemHealth,
    healthGrade: health.grade,
    subIndices: health.subIndices,
    biodiversity: {
      score: biodiversity.score,
      richness: biodiversity.richness,
      shannon: biodiversity.shannon,
      evenness: biodiversity.evenness,
      threatenedSpecies: biodiversity.threatenedSpecies,
    },
    incidents: {
      total: inc.total || 0,
      resolved: inc.resolved || 0,
      resolutionRate: inc.total ? Math.round((inc.resolved / inc.total) * 1000) / 10 : 0,
      avgResolutionHours: inc.avgResolutionMinutes ? Math.round((inc.avgResolutionMinutes / 60) * 10) / 10 : null,
      avgPriorityScore: inc.avgPriority ? Math.round(inc.avgPriority * 10) / 10 : 0,
    },
    citizenReports: reports,
    maintenance: {
      total: wo.total || 0,
      completed: wo.completed || 0,
      completionRate: wo.total ? Math.round((wo.completed / wo.total) * 1000) / 10 : 0,
      cost: wo.cost || 0,
    },
    aiDetections: detections,
    assets: {
      count: assets[0]?.count || 0,
      avgCondition: Math.round((assets[0]?.avgCondition || 0) * 10) / 10,
    },
  });
});

/**
 * GET /api/analytics/environmental-trend?days=90&interval=day|week|month
 * Environmental indicators over time, normalised to the 0–100 scale so the
 * series are directly comparable on one axis.
 */
const getEnvironmentalTrend = asyncHandler(async (req, res) => {
  const { from, to, parkId } = parseWindow(req.query);
  const interval = ['day', 'week', 'month'].includes(req.query.interval) ? req.query.interval : 'day';

  const FORMAT = { day: '%Y-%m-%d', week: '%Y-W%V', month: '%Y-%m' };

  const match = { recordedAt: { $gte: from, $lte: to } };
  if (parkId) match.park = parkId;

  const rows = await SensorReading.aggregate([
    { $match: match },
    {
      $group: {
        _id: {
          bucket: { $dateToString: { format: FORMAT[interval], date: '$recordedAt' } },
          type: '$type',
        },
        avg: { $avg: '$value' },
        min: { $min: '$value' },
        max: { $max: '$value' },
        anomalies: { $sum: { $cond: ['$isAnomaly', 1, 0] } },
      },
    },
    { $sort: { '_id.bucket': 1 } },
  ]);

  const byBucket = new Map();
  for (const row of rows) {
    const bucket = byBucket.get(row._id.bucket) || { date: row._id.bucket, anomalies: 0 };
    bucket[row._id.type] = normaliseReading(row._id.type, row.avg);
    bucket[`${row._id.type}Raw`] = Math.round(row.avg * 10) / 10;
    bucket.anomalies += row.anomalies;
    byBucket.set(row._id.bucket, bucket);
  }

  return ok(res, [...byBucket.values()], { interval, from, to });
});

/**
 * GET /api/analytics/biodiversity-trend
 * Monthly richness and abundance, plus the Shannon index recomputed per
 * month — not a rolling average of a single number, but the index genuinely
 * recalculated from that month's observations.
 */
const getBiodiversityTrend = asyncHandler(async (req, res) => {
  const { from, to, parkId } = parseWindow(req.query);
  const match = { verified: true, observedAt: { $gte: from, $lte: to } };
  if (parkId) match.park = parkId;

  const rows = await Observation.aggregate([
    { $match: match },
    {
      $group: {
        _id: {
          month: { $dateToString: { format: '%Y-%m', date: '$observedAt' } },
          species: '$species',
        },
        count: { $sum: '$count' },
      },
    },
    {
      $group: {
        _id: '$_id.month',
        abundances: { $push: '$count' },
        richness: { $sum: 1 },
        total: { $sum: '$count' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const series = rows.map((row) => {
    const indices = computeIndices(row.abundances);
    return {
      month: row._id,
      richness: row.richness,
      individuals: row.total,
      shannon: indices.shannon,
      evenness: indices.evenness,
      simpsonDiversity: indices.simpsonDiversity,
    };
  });

  return ok(res, series, { from, to });
});

/**
 * GET /api/analytics/incident-trend
 * Incident volume and mean resolution time per month, split by status.
 */
const getIncidentTrend = asyncHandler(async (req, res) => {
  const { from, to, parkId } = parseWindow(req.query);
  const match = { reportedAt: { $gte: from, $lte: to } };
  if (parkId) match.park = parkId;

  const rows = await Incident.aggregate([
    { $match: match },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m', date: '$reportedAt' } },
        reported: { $sum: 1 },
        resolved: { $sum: { $cond: [{ $in: ['$status', ['resolved', 'closed']] }, 1, 0] } },
        critical: { $sum: { $cond: [{ $eq: ['$priority', 'critical'] }, 1, 0] } },
        avgResolutionMinutes: { $avg: '$resolutionMinutes' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return ok(
    res,
    rows.map((r) => ({
      month: r._id,
      reported: r.reported,
      resolved: r.resolved,
      critical: r.critical,
      backlog: r.reported - r.resolved,
      avgResolutionHours: r.avgResolutionMinutes ? Math.round((r.avgResolutionMinutes / 60) * 10) / 10 : null,
    })),
    { from, to }
  );
});

/** GET /api/analytics/engagement — citizen participation over time. */
const getEngagementTrend = asyncHandler(async (req, res) => {
  const { from, to, parkId } = parseWindow(req.query);
  const match = { createdAt: { $gte: from, $lte: to } };
  if (parkId) match.park = parkId;

  const rows = await CitizenReport.aggregate([
    { $match: match },
    {
      $group: {
        _id: { month: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }, category: '$category' },
        count: { $sum: 1 },
        upvotes: { $sum: '$upvotes' },
      },
    },
    { $sort: { '_id.month': 1 } },
  ]);

  const byMonth = new Map();
  for (const row of rows) {
    const bucket = byMonth.get(row._id.month) || { month: row._id.month, total: 0, upvotes: 0 };
    bucket[row._id.category] = row.count;
    bucket.total += row.count;
    bucket.upvotes += row.upvotes;
    byMonth.set(row._id.month, bucket);
  }

  return ok(res, [...byMonth.values()], { from, to });
});

/**
 * GET /api/analytics/park-comparison
 * Every park scored on the same axes — the view that supports budget and
 * conservation-priority decisions.
 */
const getParkComparison = asyncHandler(async (_req, res) => {
  const parks = await Park.find({ active: true }).lean();

  const rows = await Promise.all(
    parks.map(async (park) => {
      const [health, biodiversity, openIncidents, assets] = await Promise.all([
        computeEcosystemHealth(park._id),
        analyseBiodiversity({ parkId: park._id }),
        Incident.countDocuments({ park: park._id, status: { $nin: ['resolved', 'closed'] } }),
        Asset.aggregate([
          { $match: { park: park._id, active: true } },
          { $group: { _id: null, count: { $sum: 1 }, avgCondition: { $avg: '$condition' } } },
        ]),
      ]);

      return {
        parkId: String(park._id),
        park: park.name,
        areaAcres: park.areaAcres,
        weeklyVisitors: park.weeklyVisitors,
        ecosystemHealth: health.ecosystemHealth,
        grade: health.grade,
        ...health.subIndices,
        speciesRichness: biodiversity.richness,
        shannon: biodiversity.shannon,
        openIncidents,
        assetCount: assets[0]?.count || 0,
        avgAssetCondition: Math.round((assets[0]?.avgCondition || 0) * 10) / 10,
      };
    })
  );

  return ok(res, rows.sort((a, b) => b.ecosystemHealth - a.ecosystemHealth));
});

/**
 * GET /api/analytics/export?dataset=incidents&format=csv
 * Flat tabular export for the "Export to CSV" action.
 */
const DATASETS = {
  incidents: {
    model: Incident,
    populate: [{ path: 'park', select: 'name' }, { path: 'assignedTo', select: 'name' }],
    columns: (d) => ({
      reference: d.referenceCode,
      type: d.type,
      title: d.title,
      park: d.park?.name || '',
      priority: d.priority,
      priorityScore: d.priorityScore,
      status: d.status,
      reportedAt: d.reportedAt?.toISOString?.() || '',
      resolvedAt: d.resolvedAt?.toISOString?.() || '',
      resolutionHours: d.resolutionMinutes != null ? Math.round((d.resolutionMinutes / 60) * 10) / 10 : '',
      assignedTo: d.assignedTo?.name || '',
    }),
  },
  assets: {
    model: Asset,
    populate: [{ path: 'park', select: 'name' }],
    columns: (d) => ({
      assetCode: d.assetCode,
      name: d.name,
      type: d.type,
      park: d.park?.name || '',
      condition: d.condition,
      status: d.status,
      installedAt: d.installedAt?.toISOString?.().slice(0, 10) || '',
      lastMaintenance: d.lastMaintenanceAt?.toISOString?.().slice(0, 10) || '',
      maintenanceCount: d.maintenance?.length || 0,
    }),
  },
  observations: {
    model: Observation,
    populate: [{ path: 'species', select: 'commonName scientificName class conservationStatus' }, { path: 'park', select: 'name' }],
    columns: (d) => ({
      date: d.observedAt?.toISOString?.().slice(0, 10) || '',
      commonName: d.species?.commonName || '',
      scientificName: d.species?.scientificName || '',
      class: d.species?.class || '',
      conservationStatus: d.species?.conservationStatus || '',
      count: d.count,
      park: d.park?.name || '',
      observer: d.observerName,
      source: d.source,
      verified: d.verified,
    }),
  },
  'citizen-reports': {
    model: CitizenReport,
    populate: [{ path: 'park', select: 'name' }],
    columns: (d) => ({
      reference: d.referenceCode,
      category: d.category,
      title: d.title,
      park: d.park?.name || '',
      status: d.status,
      upvotes: d.upvotes,
      submittedBy: d.submittedByName,
      submittedAt: d.createdAt?.toISOString?.() || '',
    }),
  },
  'work-orders': {
    model: WorkOrder,
    populate: [{ path: 'park', select: 'name' }, { path: 'assignedTo', select: 'name' }],
    columns: (d) => ({
      orderCode: d.orderCode,
      type: d.type,
      title: d.title,
      park: d.park?.name || '',
      scheduledDate: d.scheduledDate?.toISOString?.().slice(0, 10) || '',
      status: d.status,
      progress: d.progress,
      priority: d.priority,
      estimatedCost: d.estimatedCost,
      actualCost: d.actualCost,
      assignedTo: d.assignedTo?.name || d.assignedTeam || '',
    }),
  },
};

/** Escape a value for CSV: quote it and double any embedded quotes. */
function csvCell(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

const exportDataset = asyncHandler(async (req, res) => {
  const name = req.query.dataset;
  const config = DATASETS[name];
  if (!config) {
    throw ApiError.badRequest(`\`dataset\` must be one of: ${Object.keys(DATASETS).join(', ')}`);
  }

  const filter = {};
  if (req.query.park) filter.park = req.query.park;

  let query = config.model.find(filter).limit(5000);
  for (const spec of config.populate || []) query = query.populate(spec);
  const docs = await query.lean();

  const rows = docs.map(config.columns);

  if ((req.query.format || 'json') === 'csv') {
    const headers = Object.keys(rows[0] || config.columns({}));
    const lines = [
      headers.join(','),
      ...rows.map((row) => headers.map((h) => csvCell(row[h])).join(',')),
    ];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="greenpulse-${name}-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send(lines.join('\n'));
  }

  return ok(res, rows, { dataset: name, rows: rows.length });
});

module.exports = {
  reports: reportCrud,
  getSummary,
  getEnvironmentalTrend,
  getBiodiversityTrend,
  getIncidentTrend,
  getEngagementTrend,
  getParkComparison,
  exportDataset,
  DATASETS,
};

'use strict';

/**
 * Module 1 — Ecosystem Monitoring Dashboard.
 *
 * The landing page must render from one round trip, so `getOverview`
 * assembles every panel — KPIs, gauge, alerts, recent activity, park ranking
 * — in a single parallel fan-out rather than making the client stitch
 * together a dozen calls.
 */

const {
  Park, Alert, Incident, CitizenReport, WorkOrder, Sensor,
  Species, Observation, Asset, AiDetection, EcoReport,
} = require('../models');
const asyncHandler = require('../middleware/asyncHandler');
const { ok } = require('../utils/response');
const { computeEcosystemHealth, healthTrend, gradeFor } = require('../services/ecosystem-score.service');
const { analyseBiodiversity } = require('../services/biodiversity.service');
const { describeAqi } = require('../services/aqi.service');
const { normaliseId } = require('./crud.factory');
const { queryObjectId } = require('../utils/objectId');

/** GET /api/dashboard/overview?park= */
const getOverview = asyncHandler(async (req, res) => {
  // Aggregation pipelines bypass Mongoose casting, so `$match` needs a real ObjectId.
  const parkId = queryObjectId(req.query.park, 'park') || null;
  const parkFilter = parkId ? { park: parkId } : {};
  const aggregateParkMatch = parkFilter;

  const [
    health,
    biodiversity,
    activeAlerts,
    openIncidents,
    pendingReports,
    dueWorkOrders,
    sensorCounts,
    speciesCount,
    assetCount,
    recentAlerts,
    recentIncidents,
    recentReports,
    parkRanking,
    aqiSensors,
  ] = await Promise.all([
    computeEcosystemHealth(parkId),
    analyseBiodiversity({ parkId }),
    Alert.countDocuments({ ...parkFilter, status: 'active' }),
    Incident.countDocuments({ ...parkFilter, status: { $nin: ['resolved', 'closed'] } }),
    CitizenReport.countDocuments({ ...parkFilter, status: { $in: ['submitted', 'in-review'] } }),
    WorkOrder.countDocuments({ ...parkFilter, status: { $in: ['scheduled', 'in-progress', 'overdue'] } }),
    Sensor.aggregate([
      { $match: { active: true, ...aggregateParkMatch } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Species.countDocuments(),
    Asset.countDocuments({ ...parkFilter, active: true }),
    Alert.find({ ...parkFilter, status: { $ne: 'resolved' } })
      .sort({ createdAt: -1 }).limit(8).populate('park', 'name').lean(),
    Incident.find({ ...parkFilter, status: { $nin: ['resolved', 'closed'] } })
      .sort({ priorityScore: -1 }).limit(5).populate('park', 'name').lean(),
    EcoReport.find({ ...parkFilter }).sort({ createdAt: -1 }).limit(5).populate('park', 'name').lean(),
    Park.find({ active: true }).select('name slug scores areaAcres weeklyVisitors location').lean(),
    Sensor.find({ ...parkFilter, type: 'aqi', active: true, status: { $ne: 'offline' }, lastReadingAt: { $ne: null } })
      .select('currentValue source lastReadingAt')
      .lean(),
  ]);

  const sensorStatus = Object.fromEntries(sensorCounts.map((s) => [s._id, s.count]));

  // Citywide AQI is the mean of reporting AQI sensors — the value a resident
  // would be quoted for the area as a whole. No reporting sensor → unknown,
  // never "0 AQI", which would read as perfectly clean air.
  const meanAqi = aqiSensors.length
    ? aqiSensors.reduce((sum, s) => sum + s.currentValue, 0) / aqiSensors.length
    : null;
  const hasBiodiversity = biodiversity.richness > 0;

  /**
   * KPI tiles. `value` is what the tile displays; `score` is the normalised
   * 0–100 figure the colour band is chosen from, so an AQI tile can show
   * "84 AQI" while still being coloured by how good 84 actually is.
   * A null `value` means "no data" and must be rendered as such.
   */
  const kpis = [
    { key: 'ecosystemHealth', label: 'Ecosystem Health', value: health.ecosystemHealth, unit: '/100', score: health.ecosystemHealth, icon: 'Leaf' },
    { key: 'biodiversity', label: 'Biodiversity', value: hasBiodiversity ? biodiversity.score : null, unit: '/100', score: hasBiodiversity ? biodiversity.score : null, icon: 'Bird' },
    // Citywide, the tile is a mean of stored park readings, so it can differ by a
    // few points from the Live Conditions panel's fresh single-location query.
    { key: 'airQuality', label: parkId || aqiSensors.length < 2 ? 'Air Quality' : 'Air Quality (park average)', value: meanAqi === null ? null : Math.round(meanAqi), unit: 'AQI', score: health.subIndices.airQuality, icon: 'Wind', source: aqiSensors[0]?.source || null },
    { key: 'waterQuality', label: 'Water Quality', value: health.subIndices.waterQuality, unit: '/100', score: health.subIndices.waterQuality, icon: 'Droplets' },
    { key: 'soilHealth', label: 'Soil Health', value: health.subIndices.soilHealth, unit: '/100', score: health.subIndices.soilHealth, icon: 'Sprout' },
    { key: 'treeHealth', label: 'Tree Health', value: health.subIndices.treeHealth, unit: '/100', score: health.subIndices.treeHealth, icon: 'TreePine' },
    { key: 'species', label: 'Species Recorded', value: biodiversity.richness, unit: `of ${speciesCount}`, score: null, icon: 'Sparkles' },
    { key: 'alerts', label: 'Active Alerts', value: activeAlerts, unit: 'alerts', score: activeAlerts === 0 ? 100 : Math.max(0, 100 - activeAlerts * 10), icon: 'BellRing' },
  ];

  return ok(res, {
    scope: parkId ? 'park' : 'citywide',
    health: {
      score: health.ecosystemHealth,
      grade: health.grade,
      subIndices: health.subIndices,
      weights: health.weights,
      contributions: health.contributions,
      computedAt: health.computedAt,
    },
    airQuality: meanAqi === null ? null : describeAqi(meanAqi),
    biodiversity: {
      score: biodiversity.score,
      richness: biodiversity.richness,
      shannon: biodiversity.shannon,
      evenness: biodiversity.evenness,
      simpsonDiversity: biodiversity.simpsonDiversity,
      threatenedSpecies: biodiversity.threatenedSpecies,
      byClass: biodiversity.byClass,
    },
    kpis,
    counts: {
      activeAlerts,
      openIncidents,
      pendingReports,
      dueWorkOrders,
      assets: assetCount,
      species: speciesCount,
      sensorsOnline: sensorStatus.online || 0,
      sensorsWarning: sensorStatus.warning || 0,
      sensorsOffline: sensorStatus.offline || 0,
    },
    recentAlerts: recentAlerts.map(normaliseId),
    priorityIncidents: recentIncidents.map(normaliseId),
    recentReports: recentReports.map(normaliseId),
    parkRanking: parkRanking
      .map((p) => ({
        id: String(p._id),
        name: p.name,
        slug: p.slug,
        score: p.scores?.ecosystemHealth ?? null,
        grade: p.scores?.ecosystemHealth == null ? null : gradeFor(p.scores.ecosystemHealth),
        biodiversity: p.scores?.biodiversity ?? null,
        areaAcres: p.areaAcres,
        weeklyVisitors: p.weeklyVisitors,
      }))
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1)),
  });
});

/** GET /api/dashboard/trend?days=30&park= */
const getTrend = asyncHandler(async (req, res) => {
  const days = Math.min(365, Math.max(1, Number.parseInt(req.query.days, 10) || 30));
  const trend = await healthTrend({ parkId: queryObjectId(req.query.park, 'park') || null, days });
  return ok(res, trend, { days, points: trend.length });
});

/**
 * GET /api/dashboard/activity
 * A merged, reverse-chronological feed across the modules that generate
 * events, so the dashboard's "recent activity" panel is genuinely
 * cross-cutting rather than one collection's tail.
 */
const getActivity = asyncHandler(async (req, res) => {
  const limit = Math.min(50, Math.max(5, Number.parseInt(req.query.limit, 10) || 15));
  const park = queryObjectId(req.query.park, 'park');
  const filter = park ? { park } : {};

  // Observations imported in bulk from GBIF are the reference baseline, not
  // activity in the portal, so the feed shows only sightings logged here.
  const [incidents, reports, orders, detections, observations] = await Promise.all([
    Incident.find(filter).sort({ createdAt: -1 }).limit(limit).populate('park', 'name').lean(),
    CitizenReport.find(filter).sort({ createdAt: -1 }).limit(limit).populate('park', 'name').lean(),
    WorkOrder.find(filter).sort({ createdAt: -1 }).limit(limit).populate('park', 'name').lean(),
    AiDetection.find(filter).sort({ createdAt: -1 }).limit(limit).populate('park', 'name').lean(),
    Observation.find({ ...filter, source: { $ne: 'gbif' } }).sort({ createdAt: -1 }).limit(limit).populate('park', 'name').populate('species', 'commonName').lean(),
  ]);

  const events = [
    ...incidents.map((i) => ({
      type: 'incident', id: String(i._id), title: i.title,
      subtitle: `${i.priority} priority · ${i.status}`, park: i.park?.name, at: i.createdAt, icon: 'Siren',
    })),
    ...reports.map((r) => ({
      type: 'citizen-report', id: String(r._id), title: r.title,
      subtitle: `${r.category} · ${r.status}`, park: r.park?.name, at: r.createdAt, icon: 'Megaphone',
    })),
    ...orders.map((w) => ({
      type: 'work-order', id: String(w._id), title: w.title,
      subtitle: `${w.type} · ${w.status}`, park: w.park?.name, at: w.createdAt, icon: 'Wrench',
    })),
    ...detections.map((d) => ({
      type: 'ai-detection', id: String(d._id), title: d.prediction,
      subtitle: `${d.task} · ${d.confidence}% confidence`, park: d.park?.name, at: d.createdAt, icon: 'ScanEye',
    })),
    ...observations.map((o) => ({
      type: 'observation', id: String(o._id), title: o.species?.commonName || 'Sighting',
      subtitle: `${o.count} individual${o.count === 1 ? '' : 's'} · ${o.source}`, park: o.park?.name, at: o.createdAt, icon: 'Bird',
    })),
  ];

  events.sort((a, b) => new Date(b.at) - new Date(a.at));

  return ok(res, events.slice(0, limit));
});

module.exports = { getOverview, getTrend, getActivity };

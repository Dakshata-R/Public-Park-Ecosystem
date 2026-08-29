'use strict';

/**
 * Module 2 — GIS & Urban Biodiversity Mapping.
 *
 * This module has no collection of its own. Every map layer is a projection
 * of data another module already owns — parks, assets, observations,
 * incidents, sensors — so a tree can never appear on the map with a condition
 * that disagrees with the asset register.
 *
 * Everything is emitted as a GeoJSON FeatureCollection, which Leaflet's
 * `L.geoJSON` consumes directly.
 */

const { Park, Asset, Observation, Incident, Sensor, CitizenReport } = require('../models');
const asyncHandler = require('../middleware/asyncHandler');
const { ok } = require('../utils/response');
const ApiError = require('../utils/ApiError');
const { normaliseReading } = require('../services/ecosystem-score.service');

const LAYERS = ['parks', 'trees', 'water', 'wildlife', 'pollution', 'trails', 'sensors', 'reports'];

/** Wrap features in a FeatureCollection. */
const collection = (features) => ({ type: 'FeatureCollection', features });

/** Build one GeoJSON Feature. */
const feature = (geometry, properties) => ({ type: 'Feature', geometry, properties });

/**
 * GET /api/gis/layers?layers=parks,trees&park=<id>
 * Returns one FeatureCollection per requested layer.
 */
const getLayers = asyncHandler(async (req, res) => {
  const requested = req.query.layers
    ? String(req.query.layers).split(',').map((l) => l.trim()).filter((l) => LAYERS.includes(l))
    : LAYERS;

  if (!requested.length) {
    throw ApiError.badRequest(`\`layers\` must name at least one of: ${LAYERS.join(', ')}`);
  }

  const parkFilter = req.query.park ? { park: req.query.park } : {};
  const layers = {};

  const builders = {
    parks: async () => {
      const filter = { active: true };
      if (req.query.park) filter._id = req.query.park;
      const parks = await Park.find(filter).lean();
      return collection(
        parks.map((p) =>
          feature(p.location, {
            id: String(p._id),
            layer: 'parks',
            name: p.name,
            description: p.description,
            areaAcres: p.areaAcres,
            weeklyVisitors: p.weeklyVisitors,
            ecosystemHealth: p.scores?.ecosystemHealth ?? 0,
            biodiversity: p.scores?.biodiversity ?? 0,
            boundary: p.boundary || null,
          })
        )
      );
    },

    trees: async () => {
      const assets = await Asset.find({ ...parkFilter, type: { $in: ['tree', 'plant'] }, active: true })
        .populate('park', 'name').lean();
      return collection(
        assets.map((a) =>
          feature(a.location, {
            id: String(a._id),
            layer: 'trees',
            name: a.name,
            assetCode: a.assetCode,
            type: a.type,
            condition: a.condition,
            status: a.status,
            park: a.park?.name,
            species: a.attributes?.species || '',
          })
        )
      );
    },

    water: async () => {
      const assets = await Asset.find({ ...parkFilter, type: 'lake', active: true })
        .populate('park', 'name').lean();
      return collection(
        assets.map((a) =>
          feature(a.location, {
            id: String(a._id),
            layer: 'water',
            name: a.name,
            condition: a.condition,
            status: a.status,
            park: a.park?.name,
            depth: a.attributes?.depth || '',
            area: a.attributes?.area || '',
          })
        )
      );
    },

    trails: async () => {
      const assets = await Asset.find({ ...parkFilter, type: 'path', active: true })
        .populate('park', 'name').lean();
      return collection(
        assets.map((a) =>
          // Trails render as a polyline when the geometry exists, otherwise as
          // the representative point.
          feature(a.path || a.location, {
            id: String(a._id),
            layer: 'trails',
            name: a.name,
            condition: a.condition,
            park: a.park?.name,
            length: a.attributes?.length || '',
            difficulty: a.attributes?.difficulty || '',
          })
        )
      );
    },

    wildlife: async () => {
      const observations = await Observation.find({ ...parkFilter, verified: true })
        .sort({ observedAt: -1 })
        .limit(500)
        .populate('species', 'commonName scientificName class conservationStatus')
        .populate('park', 'name')
        .lean();
      return collection(
        observations.map((o) =>
          feature(o.location, {
            id: String(o._id),
            layer: 'wildlife',
            name: o.species?.commonName || 'Sighting',
            scientificName: o.species?.scientificName,
            class: o.species?.class,
            conservationStatus: o.species?.conservationStatus,
            count: o.count,
            observedAt: o.observedAt,
            observer: o.observerName,
            park: o.park?.name,
          })
        )
      );
    },

    pollution: async () => {
      // Pollution hotspots are open incidents of a pollution-related type —
      // derived rather than hand-maintained, so the map cannot go stale.
      const incidents = await Incident.find({
        ...parkFilter,
        type: { $in: ['water-pollution', 'air-pollution', 'illegal-dumping'] },
        status: { $nin: ['resolved', 'closed'] },
      }).populate('park', 'name').lean();

      return collection(
        incidents.map((i) =>
          feature(i.location, {
            id: String(i._id),
            layer: 'pollution',
            name: i.title,
            type: i.type,
            priority: i.priority,
            priorityScore: i.priorityScore,
            status: i.status,
            reportedAt: i.reportedAt,
            park: i.park?.name,
            /** Heatmap weight — the priority score normalised to [0, 1]. */
            intensity: Math.round((i.priorityScore / 100) * 100) / 100,
          })
        )
      );
    },

    sensors: async () => {
      const sensors = await Sensor.find({ ...parkFilter, active: true }).populate('park', 'name').lean();
      return collection(
        sensors.map((s) =>
          feature(s.location, {
            id: String(s._id),
            layer: 'sensors',
            name: s.name,
            sensorCode: s.sensorCode,
            type: s.type,
            value: s.currentValue,
            unit: s.unit,
            score: normaliseReading(s.type, s.currentValue),
            status: s.status,
            park: s.park?.name,
          })
        )
      );
    },

    reports: async () => {
      const reports = await CitizenReport.find({ ...parkFilter, status: { $ne: 'rejected' } })
        .sort({ createdAt: -1 }).limit(300).populate('park', 'name').lean();
      return collection(
        reports.map((r) =>
          feature(r.location, {
            id: String(r._id),
            layer: 'reports',
            name: r.title,
            category: r.category,
            status: r.status,
            upvotes: r.upvotes,
            submittedBy: r.submittedByName,
            park: r.park?.name,
          })
        )
      );
    },
  };

  await Promise.all(
    requested.map(async (layer) => {
      layers[layer] = await builders[layer]();
    })
  );

  return ok(res, layers, {
    layers: requested,
    counts: Object.fromEntries(requested.map((l) => [l, layers[l].features.length])),
  });
});

/**
 * GET /api/gis/heatmap?metric=pollution|wildlife|incidents
 * Weighted points for a Leaflet heat layer, as `[lat, lng, intensity]`.
 */
const getHeatmap = asyncHandler(async (req, res) => {
  const metric = req.query.metric || 'pollution';
  const parkFilter = req.query.park ? { park: req.query.park } : {};

  let points = [];

  if (metric === 'pollution' || metric === 'incidents') {
    const filter = { ...parkFilter, status: { $nin: ['resolved', 'closed'] } };
    if (metric === 'pollution') {
      filter.type = { $in: ['water-pollution', 'air-pollution', 'illegal-dumping'] };
    }
    const incidents = await Incident.find(filter).select('location priorityScore').lean();
    points = incidents.map((i) => [
      i.location.coordinates[1],
      i.location.coordinates[0],
      Math.max(0.1, i.priorityScore / 100),
    ]);
  } else if (metric === 'wildlife') {
    const observations = await Observation.find({ ...parkFilter, verified: true })
      .select('location count').lean();
    const maxCount = Math.max(1, ...observations.map((o) => o.count));
    points = observations.map((o) => [
      o.location.coordinates[1],
      o.location.coordinates[0],
      Math.max(0.1, o.count / maxCount),
    ]);
  } else {
    throw ApiError.badRequest("`metric` must be one of 'pollution', 'incidents' or 'wildlife'");
  }

  return ok(res, points, { metric, points: points.length });
});

/**
 * GET /api/gis/within?lng=&lat=&radius=
 * Everything within a radius of a point — the "what is near me" query a
 * citizen app would make. Uses the 2dsphere indexes on each collection.
 */
const getWithinRadius = asyncHandler(async (req, res) => {
  const lng = Number.parseFloat(req.query.lng);
  const lat = Number.parseFloat(req.query.lat);
  const radius = Math.min(20000, Math.max(50, Number.parseInt(req.query.radius, 10) || 1000));

  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    throw ApiError.badRequest('Both `lng` and `lat` query parameters are required');
  }

  const near = {
    $near: { $geometry: { type: 'Point', coordinates: [lng, lat] }, $maxDistance: radius },
  };

  const [parks, assets, observations, incidents] = await Promise.all([
    Park.find({ location: near, active: true }).select('name slug scores').lean(),
    Asset.find({ location: near, active: true }).select('name type condition assetCode').limit(50).lean(),
    Observation.find({ location: near, verified: true }).populate('species', 'commonName').limit(50).lean(),
    Incident.find({ location: near, status: { $nin: ['resolved', 'closed'] } }).select('title type priority').limit(50).lean(),
  ]);

  return ok(res, {
    centre: [lng, lat],
    radiusMetres: radius,
    parks: parks.map((p) => ({ id: String(p._id), name: p.name, health: p.scores?.ecosystemHealth ?? 0 })),
    assets: assets.map((a) => ({ id: String(a._id), name: a.name, type: a.type, condition: a.condition })),
    wildlife: observations.map((o) => ({ id: String(o._id), species: o.species?.commonName, count: o.count })),
    incidents: incidents.map((i) => ({ id: String(i._id), title: i.title, type: i.type, priority: i.priority })),
  });
});

module.exports = { getLayers, getHeatmap, getWithinRadius, LAYERS };

'use strict';

/**
 * Module 3 (part) — Park management, plus each park's computed health profile.
 */

const { Park, Asset, Sensor, Incident, Observation } = require('../models');
const { createCrudController, normaliseId } = require('./crud.factory');
const asyncHandler = require('../middleware/asyncHandler');
const { ok } = require('../utils/response');
const ApiError = require('../utils/ApiError');
const { parseCoordinates } = require('../utils/query');
const { computeEcosystemHealth, healthTrend } = require('../services/ecosystem-score.service');
const { analyseBiodiversity } = require('../services/biodiversity.service');

/** Derive a URL-safe slug from a park name. */
const slugify = (name) =>
  String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const crud = createCrudController({
  model: Park,
  name: 'Park',
  filterable: ['active', 'city'],
  searchable: ['name', 'description', 'address'],
  defaultSort: { name: 1 },
  softDelete: true,
  beforeCreate: async (body) => ({ ...body, slug: body.slug || slugify(body.name) }),
  beforeUpdate: async (body, doc) => ({
    ...body,
    slug: body.name && body.name !== doc.name ? slugify(body.name) : doc.slug,
  }),
});

/**
 * GET /api/parks/:id/health
 * Recompute the full index for one park rather than reading the cache, so the
 * detail page always reflects the latest sensor state.
 */
const getHealth = asyncHandler(async (req, res) => {
  const park = await Park.findById(req.params.id);
  if (!park) throw ApiError.notFound('Park');

  const health = await computeEcosystemHealth(park._id);

  // Refresh the cached copy while we have the freshly computed numbers.
  park.scores = {
    ecosystemHealth: health.ecosystemHealth,
    biodiversity: health.subIndices.biodiversity,
    airQuality: health.subIndices.airQuality,
    waterQuality: health.subIndices.waterQuality,
    soilHealth: health.subIndices.soilHealth,
    treeHealth: health.subIndices.treeHealth,
    computedAt: health.computedAt,
  };
  await park.save();

  return ok(res, { park: { id: park.id, name: park.name }, ...health });
});

/** GET /api/parks/:id/summary — counts used by the park detail header. */
const getSummary = asyncHandler(async (req, res) => {
  const park = await Park.findById(req.params.id).lean();
  if (!park) throw ApiError.notFound('Park');

  const [assets, sensors, openIncidents, observations, biodiversity] = await Promise.all([
    Asset.countDocuments({ park: park._id, active: true }),
    Sensor.countDocuments({ park: park._id, active: true }),
    Incident.countDocuments({ park: park._id, status: { $nin: ['resolved', 'closed'] } }),
    Observation.countDocuments({ park: park._id, verified: true }),
    analyseBiodiversity({ parkId: park._id }),
  ]);

  return ok(res, {
    park: normaliseId(park),
    counts: { assets, sensors, openIncidents, observations, species: biodiversity.richness },
    biodiversity: {
      score: biodiversity.score,
      richness: biodiversity.richness,
      shannon: biodiversity.shannon,
      evenness: biodiversity.evenness,
    },
  });
});

/** GET /api/parks/:id/trend?days=30 */
const getTrend = asyncHandler(async (req, res) => {
  const days = Math.min(365, Math.max(1, Number.parseInt(req.query.days, 10) || 30));
  const trend = await healthTrend({ parkId: req.params.id, days });
  return ok(res, trend, { days, points: trend.length });
});

/**
 * GET /api/parks/near?lng=&lat=&radius=
 * A 2dsphere `$near` query — the geospatial capability the GIS module needs
 * and the reason park geometry is stored as GeoJSON rather than a lat/lng pair.
 */
const findNearby = asyncHandler(async (req, res) => {
  const { lng, lat } = parseCoordinates(req.query);
  const radius = Math.min(50000, Number.parseInt(req.query.radius, 10) || 2000);

  const parks = await Park.find({
    active: true,
    location: {
      $near: {
        $geometry: { type: 'Point', coordinates: [lng, lat] },
        $maxDistance: radius,
      },
    },
  }).lean();

  return ok(res, parks.map(normaliseId), { centre: [lng, lat], radiusMetres: radius });
});

module.exports = { ...crud, getHealth, getSummary, getTrend, findNearby, slugify };

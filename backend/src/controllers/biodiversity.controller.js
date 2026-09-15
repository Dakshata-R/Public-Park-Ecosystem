'use strict';

/**
 * Module 4 — Biodiversity Management: species catalogue and observations,
 * plus the ecological indices computed over them.
 */

const { Species, Observation, Park } = require('../models');
const { createCrudController, normaliseId } = require('./crud.factory');
const asyncHandler = require('../middleware/asyncHandler');
const { ok, created } = require('../utils/response');
const ApiError = require('../utils/ApiError');
const { analyseBiodiversity, computeIndices } = require('../services/biodiversity.service');
const { parsePagination, buildMeta } = require('../utils/query');
const { queryObjectId } = require('../utils/objectId');

const speciesCrud = createCrudController({
  model: Species,
  name: 'Species',
  filterable: ['class', 'conservationStatus', 'isInvasive', 'isIndicator'],
  searchable: ['commonName', 'scientificName', 'habitat', 'family'],
  populate: { path: 'parks', select: 'name slug' },
  defaultSort: { commonName: 1 },
});

const observationCrud = createCrudController({
  model: Observation,
  name: 'Observation',
  filterable: ['species', 'park', 'source', 'verified'],
  searchable: ['notes', 'locationName', 'observerName'],
  populate: [
    { path: 'species', select: 'commonName scientificName class conservationStatus images' },
    { path: 'park', select: 'name slug' },
    { path: 'observer', select: 'name role' },
  ],
  defaultSort: { observedAt: -1 },
  beforeCreate: async (body, req) => ({
    ...body,
    observer: req.user?._id || null,
    observerName: body.observerName || req.user?.name || 'Anonymous',
    // Officers and above record verified data directly; citizens do not.
    verified: ['officer', 'admin', 'ecologist'].includes(req.user?.role) ? true : false,
  }),
  afterCreate: async (doc) => {
    // Keep the species' park list in step with where it has actually been seen.
    await Species.updateOne({ _id: doc.species }, { $addToSet: { parks: doc.park } });
  },
});

/**
 * GET /api/biodiversity/indices?park=&days=
 * The mathematical core of Module 4 — Shannon, Simpson, Pielou, Margalef and
 * the composite score, with the per-species abundance vector they were
 * computed from.
 */
const getIndices = asyncHandler(async (req, res) => {
  const { park, days } = req.query;
  const since = days ? new Date(Date.now() - Number(days) * 86_400_000) : undefined;

  const analysis = await analyseBiodiversity({ parkId: park || null, since });

  return ok(res, {
    scope: park ? 'park' : 'citywide',
    park: park || null,
    windowDays: days ? Number(days) : null,
    indices: {
      richness: analysis.richness,
      totalIndividuals: analysis.total,
      shannon: analysis.shannon,
      shannonMax: analysis.shannonMax,
      evenness: analysis.evenness,
      simpson: analysis.simpson,
      simpsonDiversity: analysis.simpsonDiversity,
      margalef: analysis.margalef,
      dominance: analysis.dominance,
    },
    score: analysis.score,
    conservationComponent: analysis.conservationComponent,
    threatenedSpecies: analysis.threatenedSpecies,
    invasiveIndividuals: analysis.invasiveCount,
    byClass: analysis.byClass,
    /** Per-taxocene indices — the methodologically sound comparison view. */
    byClassIndices: analysis.byClassIndices,
    byConservation: analysis.byConservation,
    abundance: analysis.species,
  });
});

/**
 * GET /api/biodiversity/compare
 * Indices for every park side by side — the view that answers "which park
 * needs conservation attention first".
 */
const compareParks = asyncHandler(async (_req, res) => {
  const parks = await Park.find({ active: true }).select('name slug').lean();

  const rows = await Promise.all(
    parks.map(async (park) => {
      const analysis = await analyseBiodiversity({ parkId: park._id });
      return {
        park: park.name,
        parkId: String(park._id),
        score: analysis.score,
        richness: analysis.richness,
        shannon: analysis.shannon,
        evenness: analysis.evenness,
        simpsonDiversity: analysis.simpsonDiversity,
        threatenedSpecies: analysis.threatenedSpecies,
        totalIndividuals: analysis.total,
      };
    })
  );

  return ok(res, rows.sort((a, b) => b.score - a.score));
});

/** GET /api/biodiversity/species/:id/observations */
const getSpeciesObservations = asyncHandler(async (req, res) => {
  const species = await Species.findById(req.params.id).lean();
  if (!species) throw ApiError.notFound('Species');

  const { page, limit, skip } = parsePagination(req.query);

  const [observations, total] = await Promise.all([
    Observation.find({ species: species._id })
      .sort({ observedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('park', 'name slug')
      .lean(),
    Observation.countDocuments({ species: species._id }),
  ]);

  const verifiedCount = await Observation.aggregate([
    { $match: { species: species._id, verified: true } },
    { $group: { _id: null, individuals: { $sum: '$count' } } },
  ]);

  return ok(
    res,
    {
      species: normaliseId(species),
      observations: observations.map(normaliseId),
      verifiedIndividuals: verifiedCount[0]?.individuals || 0,
    },
    buildMeta(total, { page, limit })
  );
});

/**
 * POST /api/biodiversity/observations/:id/verify
 * Verification is what admits a citizen sighting into the indices, so it is
 * restricted to ecologists and above at the route level.
 */
const verifyObservation = asyncHandler(async (req, res) => {
  const observation = await Observation.findById(req.params.id);
  if (!observation) throw ApiError.notFound('Observation');

  observation.verified = req.body.verified !== false;
  observation.verifiedBy = req.user._id;
  await observation.save();

  return ok(res, observation);
});

/**
 * GET /api/biodiversity/seasonality?species=
 * Monthly observation counts — the seasonal migration view named in the
 * module specification.
 */
const getSeasonality = asyncHandler(async (req, res) => {
  // Aggregation pipelines skip Mongoose casting — ids must be ObjectIds.
  const match = { verified: true };
  const species = queryObjectId(req.query.species, 'species');
  const park = queryObjectId(req.query.park, 'park');
  if (species) match.species = species;
  if (park) match.park = park;

  const rows = await Observation.aggregate([
    { $match: match },
    {
      $group: {
        _id: { month: { $month: '$observedAt' } },
        individuals: { $sum: '$count' },
        sightings: { $sum: 1 },
        species: { $addToSet: '$species' },
      },
    },
    { $sort: { '_id.month': 1 } },
  ]);

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Emit all twelve months so the chart has no gaps.
  const byMonth = new Map(rows.map((r) => [r._id.month, r]));
  const series = MONTHS.map((label, index) => {
    const row = byMonth.get(index + 1);
    return {
      month: label,
      individuals: row?.individuals || 0,
      sightings: row?.sightings || 0,
      richness: row?.species?.length || 0,
    };
  });

  return ok(res, series);
});

/**
 * POST /api/biodiversity/indices/preview
 * Compute the indices for an arbitrary abundance vector without touching the
 * database — used by the report and the viva demonstration to show the
 * formulas responding to hand-entered numbers.
 */
const previewIndices = asyncHandler(async (req, res) => {
  const abundances = req.body.abundances;
  if (!Array.isArray(abundances) || !abundances.length) {
    throw ApiError.badRequest('Provide `abundances` as a non-empty array of positive numbers');
  }
  return ok(res, computeIndices(abundances.map(Number)));
});

module.exports = {
  species: speciesCrud,
  observations: observationCrud,
  getIndices,
  compareParks,
  getSpeciesObservations,
  verifyObservation,
  getSeasonality,
  previewIndices,
};

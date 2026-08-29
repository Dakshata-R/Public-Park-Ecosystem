'use strict';

/**
 * The Ecosystem Health Index — Module 1.
 *
 * ---------------------------------------------------------------------------
 * Definition
 * ---------------------------------------------------------------------------
 * Five sub-indices, each normalised to [0, 100] where higher is better, are
 * combined as a weighted arithmetic mean:
 *
 *   EHI = Σ w_k · S_k  ⁄  Σ w_k        k ∈ {air, water, soil, tree, biodiversity}
 *
 * with default weights
 *
 *   w_air = 0.25   w_water = 0.20   w_soil = 0.15
 *   w_tree = 0.20  w_biodiversity = 0.20              (Σ w = 1.00)
 *
 * Air carries the highest weight because it is the fastest-moving indicator
 * and the one with the most direct effect on visitors. Soil carries the lowest
 * because it changes slowly and is the least directly experienced. The weights
 * are stored in the `Setting` document so an administrator can retune them
 * without a redeploy; the denominator Σ w makes the formula robust to weights
 * that no longer sum to 1.
 *
 * Dividing by Σ w over the *available* sub-indices also handles missing data
 * correctly: a park with no soil sensor is scored on the four indicators it
 * does have rather than being penalised with a zero.
 *
 * ---------------------------------------------------------------------------
 * Normalising raw sensor readings
 * ---------------------------------------------------------------------------
 * Sensors report in incompatible units and directions. Three normalisation
 * shapes cover every sensor type in the system:
 *
 *   higher-is-better   S = 100 · (x − min) / (max − min)
 *   lower-is-better    S = 100 · (max − x) / (max − min)
 *   band (optimal)     S = 100 · (1 − |x − c| / h),  clipped at 0
 *                      where the comfortable band is [c − h, c + h]
 *
 * AQI is special-cased: it goes through the CPCB category map in
 * `aqi.service.js` rather than a linear rescale, because AQI is itself already
 * a piecewise-linear index and a second linear stretch would distort the
 * category boundaries.
 */

const { Park, Sensor, Asset, SensorReading } = require('../models');
const Setting = require('../models/Setting');
const { aqiToScore } = require('./aqi.service');
const { analyseBiodiversity } = require('./biodiversity.service');
const { toObjectId } = require('../utils/objectId');

const clamp = (v, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));
const round1 = (v) => Math.round(v * 10) / 10;

/**
 * Comfortable bands for "band"-type sensors: [centre, half-width].
 * Outside the band the score falls off linearly and is clipped at 0.
 */
const COMFORT_BANDS = {
  temperature: { centre: 24, halfWidth: 14 }, // 10 °C – 38 °C
  humidity: { centre: 55, halfWidth: 35 },    // 20 % – 90 %
};

/**
 * Normalise one raw sensor reading onto the 0–100 "higher is better" scale.
 *
 * @param {string} type  Sensor type: aqi | temperature | humidity | noise | water | soil
 * @param {number} value Raw reading in the sensor's own unit
 * @returns {number} 0–100
 */
function normaliseReading(type, value) {
  if (!Number.isFinite(value)) return 0;

  switch (type) {
    case 'aqi':
      return aqiToScore(value);

    case 'noise': {
      // 35 dB (quiet park) → 100; 85 dB (traffic) → 0.
      const MIN = 35;
      const MAX = 85;
      return round1(clamp((100 * (MAX - value)) / (MAX - MIN)));
    }

    case 'water':
    case 'soil':
      // Both already arrive on a 0–100 "higher is better" index.
      return round1(clamp(value));

    case 'temperature':
    case 'humidity': {
      const { centre, halfWidth } = COMFORT_BANDS[type];
      return round1(clamp(100 * (1 - Math.abs(value - centre) / halfWidth)));
    }

    default:
      return round1(clamp(value));
  }
}

/**
 * Read the configured weights, defensively normalised so they sum to 1.
 * @returns {Promise<Record<string, number>>}
 */
async function getWeights() {
  const settings = await Setting.current();
  const raw = settings.healthIndexWeights || {};
  const weights = {
    air: raw.air ?? 0.25,
    water: raw.water ?? 0.2,
    soil: raw.soil ?? 0.15,
    tree: raw.tree ?? 0.2,
    biodiversity: raw.biodiversity ?? 0.2,
  };
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  if (sum <= 0) return { air: 0.25, water: 0.2, soil: 0.15, tree: 0.2, biodiversity: 0.2 };
  return Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, v / sum]));
}

/**
 * Weighted mean over whichever sub-indices are present.
 *
 * @param {Record<string, number|null>} subIndices
 * @param {Record<string, number>} weights
 * @returns {{score: number, contributions: Array<{key:string,score:number,weight:number,contribution:number}>}}
 */
function combine(subIndices, weights) {
  let weightedSum = 0;
  let weightTotal = 0;
  const contributions = [];

  for (const [key, score] of Object.entries(subIndices)) {
    if (score === null || score === undefined || !Number.isFinite(score)) continue;
    const weight = weights[key] ?? 0;
    weightedSum += weight * score;
    weightTotal += weight;
    contributions.push({ key, score: round1(score), weight, contribution: round1(weight * score) });
  }

  return {
    score: weightTotal > 0 ? round1(weightedSum / weightTotal) : 0,
    contributions,
  };
}

/**
 * Mean of the most recent reading of every sensor of a given type in a park.
 *
 * @param {import('mongoose').Types.ObjectId|null} parkId null → citywide
 * @returns {Promise<Record<string, number>>} type → mean normalised score
 */
async function sensorSubIndices(parkId) {
  const match = { active: true, status: { $ne: 'offline' } };
  if (parkId) match.park = parkId;

  const sensors = await Sensor.find(match).select('type currentValue lastReadingAt').lean();

  const buckets = {};
  for (const sensor of sensors) {
    if (sensor.lastReadingAt === null && sensor.currentValue === 0) continue;
    const normalised = normaliseReading(sensor.type, sensor.currentValue);
    (buckets[sensor.type] ||= []).push(normalised);
  }

  return Object.fromEntries(
    Object.entries(buckets).map(([type, values]) => [
      type,
      round1(values.reduce((a, b) => a + b, 0) / values.length),
    ])
  );
}

/**
 * Tree health sub-index: the mean condition of living assets (trees and
 * plants), which the asset module maintains on a 0–100 scale already.
 *
 * @param {import('mongoose').Types.ObjectId|null} parkId
 * @returns {Promise<number|null>} null when the park has no vegetation assets
 */
async function treeHealthSubIndex(parkId) {
  const match = { type: { $in: ['tree', 'plant'] }, active: true };
  if (parkId) match.park = parkId;

  const [result] = await Asset.aggregate([
    { $match: match },
    { $group: { _id: null, avg: { $avg: '$condition' }, count: { $sum: 1 } } },
  ]);

  return result && result.count > 0 ? round1(result.avg) : null;
}

/**
 * Compute the full health picture for one park (or citywide when `parkId`
 * is null).
 *
 * @param {string|import('mongoose').Types.ObjectId|null} parkRef
 * @returns {Promise<object>} sub-indices, weights, contributions and the EHI
 */
async function computeEcosystemHealth(parkRef = null) {
  const parkId = parkRef ? toObjectId(parkRef) : null;

  const [weights, sensorScores, treeScore, biodiversity] = await Promise.all([
    getWeights(),
    sensorSubIndices(parkId),
    treeHealthSubIndex(parkId),
    analyseBiodiversity({ parkId }),
  ]);

  // Air blends AQI with the noise index — both are "atmospheric nuisance"
  // indicators and neither alone describes the air a visitor experiences.
  const airComponents = [sensorScores.aqi, sensorScores.noise].filter(Number.isFinite);
  const air = airComponents.length
    ? round1(airComponents.reduce((a, b) => a + b, 0) / airComponents.length)
    : null;

  const subIndices = {
    air,
    water: sensorScores.water ?? null,
    soil: sensorScores.soil ?? null,
    tree: treeScore,
    biodiversity: biodiversity.score || null,
  };

  const { score, contributions } = combine(subIndices, weights);

  return {
    park: parkId ? String(parkId) : null,
    ecosystemHealth: score,
    grade: gradeFor(score),
    subIndices: {
      airQuality: subIndices.air ?? 0,
      waterQuality: subIndices.water ?? 0,
      soilHealth: subIndices.soil ?? 0,
      treeHealth: subIndices.tree ?? 0,
      biodiversity: subIndices.biodiversity ?? 0,
    },
    /** Raw comfort/AQI readings behind the sub-indices, for tooltips. */
    sensorScores,
    weights,
    contributions,
    biodiversityDetail: {
      richness: biodiversity.richness,
      shannon: biodiversity.shannon,
      evenness: biodiversity.evenness,
      simpsonDiversity: biodiversity.simpsonDiversity,
      margalef: biodiversity.margalef,
      threatenedSpecies: biodiversity.threatenedSpecies,
      invasiveCount: biodiversity.invasiveCount,
    },
    computedAt: new Date(),
  };
}

/** Five-band label for a 0–100 score. */
function gradeFor(score) {
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 55) return 'moderate';
  if (score >= 40) return 'poor';
  return 'critical';
}

/**
 * Recompute every park's cached scores and write them back to `Park.scores`.
 * Called after seeding and by the sensor simulator on each tick.
 *
 * @returns {Promise<Array<{park: string, ecosystemHealth: number}>>}
 */
async function refreshAllParkScores() {
  const parks = await Park.find({ active: true }).select('_id name').lean();
  const results = [];

  for (const park of parks) {
    const health = await computeEcosystemHealth(park._id);
    await Park.updateOne(
      { _id: park._id },
      {
        $set: {
          'scores.ecosystemHealth': health.ecosystemHealth,
          'scores.biodiversity': health.subIndices.biodiversity,
          'scores.airQuality': health.subIndices.airQuality,
          'scores.waterQuality': health.subIndices.waterQuality,
          'scores.soilHealth': health.subIndices.soilHealth,
          'scores.treeHealth': health.subIndices.treeHealth,
          'scores.computedAt': health.computedAt,
        },
      }
    );
    results.push({ park: park.name, ecosystemHealth: health.ecosystemHealth });
  }

  return results;
}

/**
 * Historical trend of the health indicators, bucketed by day.
 *
 * Sub-indices are reconstructed from stored readings rather than from the
 * cached park scores, so the chart shows what the indicators actually were on
 * each day instead of repeating today's snapshot.
 *
 * @param {object} options
 * @param {string|null} [options.parkId]
 * @param {number} [options.days=30]
 * @returns {Promise<Array<{date:string, air:number, water:number, soil:number, temperature:number, noise:number}>>}
 */
async function healthTrend({ parkId = null, days = 30 } = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const match = { recordedAt: { $gte: since } };
  const oid = parkId ? toObjectId(parkId) : null;
  if (oid) match.park = oid;

  const rows = await SensorReading.aggregate([
    { $match: match },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: '%Y-%m-%d', date: '$recordedAt' } },
          type: '$type',
        },
        avg: { $avg: '$value' },
      },
    },
    { $sort: { '_id.date': 1 } },
  ]);

  /** @type {Map<string, Record<string, number>>} */
  const byDate = new Map();
  for (const row of rows) {
    const bucket = byDate.get(row._id.date) || { date: row._id.date };
    bucket[row._id.type] = normaliseReading(row._id.type, row.avg);
    byDate.set(row._id.date, bucket);
  }

  return [...byDate.values()].map((bucket) => ({
    date: bucket.date,
    air: bucket.aqi ?? 0,
    water: bucket.water ?? 0,
    soil: bucket.soil ?? 0,
    noise: bucket.noise ?? 0,
    temperature: bucket.temperature ?? 0,
    humidity: bucket.humidity ?? 0,
  }));
}

module.exports = {
  normaliseReading,
  combine,
  getWeights,
  computeEcosystemHealth,
  refreshAllParkScores,
  healthTrend,
  gradeFor,
  COMFORT_BANDS,
};

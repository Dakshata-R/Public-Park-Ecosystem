'use strict';

/**
 * Module 6 — Environmental Sensor Monitoring.
 */

const { Sensor, SensorReading } = require('../models');
const { createCrudController, normaliseId } = require('./crud.factory');
const asyncHandler = require('../middleware/asyncHandler');
const { ok, created } = require('../utils/response');
const ApiError = require('../utils/ApiError');
const sensorService = require('../services/sensor.service');
const anomalyService = require('../services/anomaly.service');
const { normaliseReading } = require('../services/ecosystem-score.service');

const crud = createCrudController({
  model: Sensor,
  name: 'Sensor',
  filterable: ['type', 'status', 'park', 'active', 'source'],
  searchable: ['name', 'sensorCode'],
  populate: { path: 'park', select: 'name slug' },
  defaultSort: { name: 1 },
  softDelete: true,
});

/**
 * GET /api/sensors/:id/readings?hours=24
 * The chart series for one sensor, with the normalised 0–100 score alongside
 * each raw value so the frontend does not have to re-implement the mapping.
 */
const getReadings = asyncHandler(async (req, res) => {
  const sensor = await Sensor.findById(req.params.id).lean();
  if (!sensor) throw ApiError.notFound('Sensor');

  const hours = Math.min(720, Math.max(1, Number.parseInt(req.query.hours, 10) || 24));
  const since = new Date(Date.now() - hours * 3_600_000);

  const readings = await SensorReading.find({ sensor: sensor._id, recordedAt: { $gte: since } })
    .sort({ recordedAt: 1 })
    .lean();

  const values = readings.map((r) => r.value);
  const stats = values.length
    ? {
        min: Math.min(...values),
        max: Math.max(...values),
        mean: Math.round(anomalyService.mean(values) * 100) / 100,
        stdDev: Math.round(anomalyService.stdDev(values) * 100) / 100,
        median: anomalyService.median(values),
        anomalies: readings.filter((r) => r.isAnomaly).length,
      }
    : null;

  return ok(
    res,
    {
      sensor: normaliseId(sensor),
      readings: readings.map((r) => ({
        time: r.recordedAt,
        value: r.value,
        score: normaliseReading(sensor.type, r.value),
        isAnomaly: r.isAnomaly,
        zScore: r.zScore,
      })),
      stats,
    },
    { hours, points: readings.length }
  );
});

/**
 * POST /api/sensors/:id/readings
 * The ingestion door. A physical gateway would POST here; the simulator calls
 * the same service function internally.
 */
const ingestReading = asyncHandler(async (req, res) => {
  const sensor = await Sensor.findById(req.params.id);
  if (!sensor) throw ApiError.notFound('Sensor');
  if (sensor.source !== 'device') {
    throw ApiError.conflict(
      `${sensor.name} is ${sensor.source === 'open-meteo' ? 'a virtual sensor fed by Open-Meteo' : 'a simulated sensor'}; ` +
        'only physical devices accept posted readings'
    );
  }

  const value = Number(req.body.value);
  if (!Number.isFinite(value)) throw ApiError.badRequest('`value` must be a number');

  const recordedAt = req.body.recordedAt ? new Date(req.body.recordedAt) : new Date();
  const result = await sensorService.ingestReading(sensor, value, recordedAt);

  return created(res, {
    reading: result.reading,
    anomaly: result.verdict,
    alertsRaised: result.alerts.length,
    sensor: { id: sensor.id, status: sensor.status, currentValue: sensor.currentValue },
  });
});

/** GET /api/sensors/live — every sensor's current state, for the live wall. */
const getLive = asyncHandler(async (req, res) => {
  const filter = { active: true };
  if (req.query.park) filter.park = req.query.park;

  const sensors = await Sensor.find(filter).populate('park', 'name slug').lean();

  const live = sensors.map((s) => {
    const hasReading = Boolean(s.lastReadingAt);
    return {
      ...normaliseId(s),
      currentValue: hasReading ? s.currentValue : null,
      score: hasReading ? normaliseReading(s.type, s.currentValue) : null,
      breached:
        hasReading &&
        ((s.warnAbove != null && s.currentValue > s.warnAbove) ||
          (s.warnBelow != null && s.currentValue < s.warnBelow)),
      // Open-Meteo publishes a new observation every 15 minutes; a simulated
      // or hardware sensor reports every tick.
      stale: hasReading ? Date.now() - new Date(s.lastReadingAt) > (s.source === 'open-meteo' ? 2 : 1) * 3_600_000 : true,
    };
  });

  const byType = live.reduce((acc, s) => {
    if (s.score !== null && s.status !== 'offline') (acc[s.type] ||= []).push(s.score);
    return acc;
  }, {});

  return ok(res, {
    sensors: live,
    summary: {
      total: live.length,
      online: live.filter((s) => s.status === 'online').length,
      warning: live.filter((s) => s.status === 'warning').length,
      offline: live.filter((s) => s.status === 'offline').length,
      maintenance: live.filter((s) => s.status === 'maintenance').length,
      bySource: live.reduce((acc, s) => ({ ...acc, [s.source]: (acc[s.source] || 0) + 1 }), {}),
      averageScoreByType: Object.fromEntries(
        Object.entries(byType).map(([type, scores]) => [
          type,
          Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10,
        ])
      ),
    },
  });
});

/** GET /api/sensors/:id/anomalies — historical anomaly scan for one sensor. */
const getAnomalies = asyncHandler(async (req, res) => {
  const sensor = await Sensor.findById(req.params.id).lean();
  if (!sensor) throw ApiError.notFound('Sensor');

  const limit = Math.min(1000, Math.max(20, Number.parseInt(req.query.limit, 10) || 200));
  const anomalies = await anomalyService.scanSensorHistory(sensor._id, limit);

  return ok(res, { sensor: normaliseId(sensor), anomalies }, { scanned: limit, found: anomalies.length });
});

/**
 * POST /api/sensors/refresh
 * Run one refresh now: pull any newer Open-Meteo observations for the
 * virtual sensors and, if enabled, one simulated reading per simulated sensor.
 */
const refresh = asyncHandler(async (_req, res) => {
  const result = await sensorService.refreshSensors();
  return ok(res, { ...result, errors: [...new Set(result.errors)] });
});

module.exports = { ...crud, getReadings, ingestReading, getLive, getAnomalies, refresh };

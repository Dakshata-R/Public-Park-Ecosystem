'use strict';

/**
 * Sensor ingestion and simulation — Module 6.
 *
 * ---------------------------------------------------------------------------
 * Why simulate
 * ---------------------------------------------------------------------------
 * The Week-4 log records the hardware layer as "conceptual": a physical
 * deployment of AQI, water, soil and noise probes is out of scope for a
 * semester project. What is *not* out of scope is the software that would
 * receive them, so `ingestReading` is written as the real ingestion path —
 * validation, persistence, anomaly detection, threshold alerting, cached
 * current value — and the simulator merely calls it on a timer.
 *
 * Replacing the simulator with an MQTT subscriber or an HTTP POST from a real
 * gateway requires no change to anything below this file. The public
 * `POST /api/sensors/:id/readings` endpoint is exactly that ingestion door.
 *
 * ---------------------------------------------------------------------------
 * The generative model
 * ---------------------------------------------------------------------------
 * Readings are not white noise — real environmental variables have a daily
 * cycle and are strongly autocorrelated. Each new value is drawn as
 *
 *   x_t = α·x_{t−1} + (1 − α)·( base + A·sin(2π(h − φ)/24) ) + ε
 *
 *   α  persistence (0.7) — an AR(1) term, so the series drifts rather than
 *      jumping between independent samples
 *   A  diurnal amplitude, φ the hour of the peak
 *   ε  ~ N(0, σ) Gaussian noise via the Box–Muller transform
 *
 * With small probability a spike is injected, so the anomaly detector has
 * something real to find during a demonstration.
 *
 * ---------------------------------------------------------------------------
 * Anchoring to reality
 * ---------------------------------------------------------------------------
 * `base` is not a hard-coded constant when the machine is online. Every 15
 * minutes the simulator pulls live weather and CAMS air-quality data for each
 * park's actual coordinates and uses those values as the baseline, so a
 * simulated AQI sensor tracks the genuine pollution level at that location and
 * a temperature sensor reports something close to the real temperature
 * outside. The diurnal, autocorrelation and noise terms then vary around that
 * anchor at sensor cadence, which no public API provides.
 *
 * Offline, the anchors simply never populate and the constants in `DIURNAL`
 * take over. Nothing breaks; the data is just synthetic rather than tethered.
 */

const { Sensor, SensorReading, Setting, Park } = require('../models');
const anomalyService = require('./anomaly.service');
const alertService = require('./alert.service');
const external = require('./external.service');
const logger = require('../utils/logger');
const env = require('../config/env');

/**
 * Diurnal profile per sensor type: baseline value, sine amplitude, hour of
 * the daily peak, and noise standard deviation.
 */
const DIURNAL = {
  aqi:         { base: 72,  amplitude: 28, peakHour: 9,  sigma: 6 },   // rush-hour peaks
  temperature: { base: 24,  amplitude: 6,  peakHour: 15, sigma: 0.8 }, // warmest mid-afternoon
  humidity:    { base: 62,  amplitude: 15, peakHour: 5,  sigma: 3 },   // highest before dawn
  noise:       { base: 50,  amplitude: 14, peakHour: 18, sigma: 3 },   // evening footfall
  water:       { base: 82,  amplitude: 4,  peakHour: 12, sigma: 2 },
  soil:        { base: 45,  amplitude: 8,  peakHour: 6,  sigma: 2.5 },
};

/** Probability that any given tick injects an anomalous spike. */
const SPIKE_PROBABILITY = 0.03;

// ---------------------------------------------------------------------------
// Live anchors
// ---------------------------------------------------------------------------

/**
 * parkId → { aqi, temperature, humidity, fetchedAt }, refreshed from the
 * public APIs. Types absent from the map fall back to the `DIURNAL` constants.
 */
const liveAnchors = new Map();
const ANCHOR_TTL_MS = 15 * 60_000;

/**
 * Refresh the live baseline for every park.
 *
 * Parks are fetched one at a time rather than in parallel: six sequential
 * requests every fifteen minutes is well inside Open-Meteo's free tier, while
 * six simultaneous ones from many deployments is the kind of traffic that gets
 * a service to add a key requirement.
 *
 * @returns {Promise<{anchored: number, failed: number}>}
 */
async function refreshLiveAnchors() {
  const parks = await Park.find({ active: true }).select('_id name location').lean();
  let anchored = 0;
  let failed = 0;

  for (const park of parks) {
    const [lng, lat] = park.location.coordinates;
    const [weather, air] = await Promise.all([
      external.getWeather(lat, lng),
      external.getAirQuality(lat, lng),
    ]);

    const anchor = { fetchedAt: Date.now() };
    if (weather.ok && weather.current) {
      if (Number.isFinite(weather.current.temperature)) anchor.temperature = weather.current.temperature;
      if (Number.isFinite(weather.current.humidity)) anchor.humidity = weather.current.humidity;
    }
    if (air.ok && Number.isFinite(air.aqi)) anchor.aqi = air.aqi;

    if (anchor.temperature !== undefined || anchor.aqi !== undefined) {
      liveAnchors.set(String(park._id), anchor);
      anchored += 1;
    } else {
      failed += 1;
    }
  }

  if (anchored) logger.info(`Live anchors refreshed for ${anchored}/${parks.length} parks`);
  return { anchored, failed };
}

/** The live baseline for a sensor, or null when none is available or fresh. */
function anchorFor(sensor) {
  const anchor = liveAnchors.get(String(sensor.park));
  if (!anchor) return null;
  if (Date.now() - anchor.fetchedAt > ANCHOR_TTL_MS) return null;
  const value = anchor[sensor.type];
  return Number.isFinite(value) ? value : null;
}

/**
 * Standard normal sample via the Box–Muller transform.
 *
 *   z = √(−2 ln u₁) · cos(2π u₂),  u₁,u₂ ~ U(0,1)
 *
 * u₁ is nudged off zero because ln(0) is −∞.
 */
function gaussian() {
  const u1 = Math.random() || Number.EPSILON;
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Generate the next plausible value for a sensor.
 *
 * @param {object} sensor  Sensor document (uses `type`, `currentValue`, bounds)
 * @param {Date} [now]
 * @returns {{value: number, spiked: boolean}}
 */
function nextValue(sensor, now = new Date()) {
  const profile = DIURNAL[sensor.type] || { base: 50, amplitude: 10, peakHour: 12, sigma: 4 };
  const hour = now.getHours() + now.getMinutes() / 60;

  // Real conditions at this park when the machine is online, otherwise the
  // configured constant. The live figure already includes the time of day, so
  // the diurnal swing is halved when anchored to avoid double-counting it.
  const anchored = anchorFor(sensor);
  const base = anchored ?? profile.base;
  const amplitude = anchored != null ? profile.amplitude * 0.5 : profile.amplitude;

  // Deterministic seasonal component.
  const seasonal = base + amplitude * Math.sin((2 * Math.PI * (hour - profile.peakHour)) / 24);

  // AR(1) persistence against the previous reading.
  const alpha = 0.7;
  const previous = Number.isFinite(sensor.currentValue) && sensor.currentValue > 0
    ? sensor.currentValue
    : seasonal;

  let value = alpha * previous + (1 - alpha) * seasonal + gaussian() * profile.sigma;

  // Occasional excursion, so the detector has genuine anomalies to catch.
  const spiked = Math.random() < SPIKE_PROBABILITY;
  if (spiked) {
    const magnitude = profile.amplitude * (2.5 + Math.random() * 2);
    value += Math.random() < 0.5 ? magnitude : -magnitude;
  }

  // Clip to the sensor's calibrated range.
  value = Math.min(sensor.maxValue, Math.max(sensor.minValue, value));

  return { value: Math.round(value * 10) / 10, spiked };
}

/**
 * The real ingestion path: persist a reading, test it for anomalies, update
 * the sensor's cached state, and raise or clear alerts.
 *
 * @param {object} sensor A Sensor document (not a lean object — it is saved)
 * @param {number} value
 * @param {Date} [recordedAt]
 * @returns {Promise<{reading: object, verdict: object, alerts: object[]}>}
 */
async function ingestReading(sensor, value, recordedAt = new Date()) {
  const settings = await Setting.current();

  const verdict = await anomalyService.detectForSensor(sensor._id, value, {
    zThreshold: settings.anomalyZThreshold,
  });

  const reading = await SensorReading.create({
    sensor: sensor._id,
    park: sensor.park,
    type: sensor.type,
    value,
    unit: sensor.unit,
    recordedAt,
    isAnomaly: verdict.isAnomaly,
    zScore: verdict.zScore,
  });

  sensor.currentValue = value;
  sensor.lastReadingAt = recordedAt;
  // Battery drains slowly; a flat battery takes the sensor offline.
  sensor.batteryLevel = Math.max(0, sensor.batteryLevel - 0.01);
  if (sensor.status !== 'maintenance') {
    const breached =
      (sensor.warnAbove != null && value > sensor.warnAbove) ||
      (sensor.warnBelow != null && value < sensor.warnBelow);
    sensor.status = sensor.batteryLevel <= 0 ? 'offline' : breached ? 'warning' : 'online';
  }
  await sensor.save();

  const alerts = [];
  const thresholdAlert = await alertService.evaluateSensorThreshold(sensor, value);
  if (thresholdAlert) alerts.push(thresholdAlert);
  if (verdict.isAnomaly) {
    alerts.push(await alertService.raiseAnomalyAlert(sensor, value, verdict));
  }

  return { reading, verdict, alerts };
}

/** Run one simulation tick across every active sensor. */
async function simulateTick() {
  const settings = await Setting.current();
  if (!settings.enableSensorSimulation) return { skipped: true, count: 0 };

  /**
   * A device that is offline or under maintenance transmits nothing. The
   * simulator must respect that: generating a reading for an offline sensor
   * would silently bring it back online, erasing the fault the sensor-health
   * panel exists to surface. Only a real reading arriving through
   * `POST /sensors/:id/readings` should clear an offline status.
   */
  const sensors = await Sensor.find({
    active: true,
    status: { $nin: ['maintenance', 'offline'] },
  });

  let anomalies = 0;
  for (const sensor of sensors) {
    const { value } = nextValue(sensor);
    const { verdict } = await ingestReading(sensor, value);
    if (verdict.isAnomaly) anomalies += 1;
  }

  return { skipped: false, count: sensors.length, anomalies };
}

let timer = null;
let anchorTimer = null;

/**
 * Start the periodic simulator and the live-anchor refresh. Idempotent —
 * calling it twice does not create a second pair of timers.
 */
function startSimulator() {
  if (timer || env.sensorIntervalMs <= 0) return;

  // Anchor once immediately so the first tick is already tethered to reality,
  // then on a slower cycle than the simulation itself.
  refreshLiveAnchors().catch((err) => logger.warn('Initial anchor refresh failed:', err.message));

  anchorTimer = setInterval(() => {
    refreshLiveAnchors().catch((err) => logger.warn('Anchor refresh failed:', err.message));
  }, ANCHOR_TTL_MS);

  timer = setInterval(async () => {
    try {
      const result = await simulateTick();
      if (!result.skipped && result.anomalies) {
        logger.info(`Sensor tick: ${result.count} readings, ${result.anomalies} anomalies`);
      }
    } catch (err) {
      logger.error('Sensor simulation tick failed:', err.message);
    }
  }, env.sensorIntervalMs);

  // Do not hold the event loop open on shutdown.
  if (timer.unref) timer.unref();
  if (anchorTimer.unref) anchorTimer.unref();

  logger.info(
    `Sensor simulator running every ${env.sensorIntervalMs / 1000}s, ` +
      `live anchors refreshing every ${ANCHOR_TTL_MS / 60000} min`
  );
}

function stopSimulator() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (anchorTimer) {
    clearInterval(anchorTimer);
    anchorTimer = null;
  }
}

/**
 * Backfill a sensor's history so charts and the anomaly detector have data on
 * a freshly seeded database.
 *
 * @param {object} sensor
 * @param {number} [hours=48] How far back to generate
 * @param {number} [stepMinutes=30] Spacing between synthetic readings
 */
async function backfillHistory(sensor, hours = 48, stepMinutes = 30) {
  const steps = Math.floor((hours * 60) / stepMinutes);
  const docs = [];
  let previous = null;

  for (let i = steps; i >= 0; i -= 1) {
    const at = new Date(Date.now() - i * stepMinutes * 60_000);
    const pseudo = { ...sensor.toObject?.() ?? sensor, currentValue: previous ?? 0 };
    const { value } = nextValue(pseudo, at);
    previous = value;
    docs.push({
      sensor: sensor._id,
      park: sensor.park,
      type: sensor.type,
      value,
      unit: sensor.unit,
      recordedAt: at,
      isAnomaly: false,
      zScore: 0,
    });
  }

  if (docs.length) await SensorReading.insertMany(docs);

  // Leave the sensor holding its most recent backfilled value.
  sensor.currentValue = previous;
  sensor.lastReadingAt = docs[docs.length - 1].recordedAt;
  await sensor.save();

  return docs.length;
}

module.exports = {
  nextValue,
  ingestReading,
  simulateTick,
  startSimulator,
  stopSimulator,
  backfillHistory,
  refreshLiveAnchors,
  anchorFor,
  gaussian,
  DIURNAL,
  liveAnchors,
};

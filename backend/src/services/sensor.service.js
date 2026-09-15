'use strict';

/**
 * Sensor ingestion — Module 6.
 *
 * ---------------------------------------------------------------------------
 * Three kinds of sensor, one ingestion path
 * ---------------------------------------------------------------------------
 * The Week-4 log records the hardware layer as out of scope: there are no
 * physical probes in these parks. Rather than inventing readings for every
 * type, each sensor declares where its data comes from (`Sensor.source`):
 *
 *   open-meteo  Air quality, temperature and humidity. A *virtual* sensor:
 *               every reading is a real observation for the park's
 *               coordinates — Open-Meteo's forecast model for weather, and
 *               CAMS pollutant concentrations scored through this project's
 *               CPCB implementation for AQI. A reading is stored only when
 *               the upstream observation time advances, and nothing at all is
 *               stored while the service is unreachable — the sensor goes
 *               stale and then offline, exactly as a real one would.
 *
 *   simulated   Noise, soil moisture and water quality. No public source
 *               measures these at park scale, so values are generated and
 *               labelled "simulated" in the API and the interface.
 *
 *   device      A physical gateway POSTing to /api/sensors/:id/readings.
 *
 * All three go through `ingestReading` — validation, persistence, anomaly
 * detection, threshold alerting, cached current value — so replacing a
 * simulated or virtual sensor with real hardware changes nothing downstream.
 *
 * ---------------------------------------------------------------------------
 * The generative model for simulated sensors
 * ---------------------------------------------------------------------------
 *   x_t = α·x_{t−1} + (1 − α)·( base + A·sin(2π(h − φ)/24) ) + ε
 *
 *   α  persistence (0.7) — an AR(1) term, so the series drifts rather than
 *      jumping between independent samples
 *   A  diurnal amplitude, φ the hour of the peak
 *   ε  ~ N(0, σ) Gaussian noise via the Box–Muller transform
 *
 * With small probability a spike is injected so the anomaly detector has
 * something to find; a spike is only ever injected into simulated data.
 */

const { Sensor, SensorReading, Setting, Park } = require('../models');
const { LIVE_TYPES } = require('../models/Sensor');
const anomalyService = require('./anomaly.service');
const alertService = require('./alert.service');
const external = require('./external.service');
const logger = require('../utils/logger');
const env = require('../config/env');

/**
 * Diurnal profile per simulated type: baseline value, sine amplitude, hour of
 * the daily peak, and noise standard deviation.
 */
const DIURNAL = {
  noise: { base: 52, amplitude: 12, peakHour: 18, sigma: 3 },  // evening footfall
  water: { base: 68, amplitude: 4, peakHour: 12, sigma: 2 },   // urban lake WQI
  soil: { base: 42, amplitude: 8, peakHour: 6, sigma: 2.5 },   // moisture, highest at dawn
  // Used only if a live type is ever marked simulated.
  aqi: { base: 90, amplitude: 25, peakHour: 9, sigma: 6 },
  temperature: { base: 25, amplitude: 5, peakHour: 15, sigma: 0.8 },
  humidity: { base: 65, amplitude: 15, peakHour: 5, sigma: 3 },
};

/** Probability that a simulated tick injects an anomalous spike. */
const SPIKE_PROBABILITY = 0.03;

/** A virtual sensor with no new observation for this long is offline. */
const LIVE_OFFLINE_AFTER_MS = 3 * 3_600_000;

/** The parks' time zone — diurnal cycles follow local, not server, time. */
const TIMEZONE = 'Asia/Kolkata';

// ---------------------------------------------------------------------------
// Simulated values
// ---------------------------------------------------------------------------

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

/** Local hour of day in the parks' time zone, so diurnal peaks land correctly on any server. */
function localHour(at) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(at);
  const get = (type) => Number(parts.find((p) => p.type === type)?.value || 0);
  return get('hour') + get('minute') / 60;
}

/**
 * Generate the next value for a simulated sensor.
 *
 * @param {object} sensor  Uses `type`, `currentValue`, `minValue`, `maxValue`
 * @param {Date} [now]
 * @returns {{value: number, spiked: boolean}}
 */
function nextValue(sensor, now = new Date()) {
  const profile = DIURNAL[sensor.type] || { base: 50, amplitude: 10, peakHour: 12, sigma: 4 };
  const hour = localHour(now);

  const seasonal = profile.base + profile.amplitude * Math.sin((2 * Math.PI * (hour - profile.peakHour)) / 24);

  const alpha = 0.7;
  const previous = Number.isFinite(sensor.currentValue) && sensor.currentValue > 0 ? sensor.currentValue : seasonal;
  let value = alpha * previous + (1 - alpha) * seasonal + gaussian() * profile.sigma;

  const spiked = Math.random() < SPIKE_PROBABILITY;
  if (spiked) {
    const magnitude = profile.amplitude * (2.5 + Math.random() * 2);
    value += Math.random() < 0.5 ? magnitude : -magnitude;
  }

  value = Math.min(sensor.maxValue, Math.max(sensor.minValue, value));
  return { value: Math.round(value * 10) / 10, spiked };
}

// ---------------------------------------------------------------------------
// Live values
// ---------------------------------------------------------------------------

/**
 * Current Open-Meteo observations for a park, keyed by sensor type.
 * The external service caches upstream responses (10–15 min), so calling
 * this every tick costs at most a few requests per quarter-hour.
 *
 * @returns {Promise<{values: Record<string, {value:number, observedAt:string}>, errors: string[]}>}
 */
async function liveObservations(park) {
  const [lng, lat] = park.location.coordinates;
  const [weather, air] = await Promise.all([external.getWeather(lat, lng), external.getAirQuality(lat, lng)]);

  const values = {};
  const errors = [];

  if (weather.ok && weather.current?.observedAt) {
    if (Number.isFinite(weather.current.temperature)) {
      values.temperature = { value: weather.current.temperature, observedAt: weather.current.observedAt };
    }
    if (Number.isFinite(weather.current.humidity)) {
      values.humidity = { value: weather.current.humidity, observedAt: weather.current.observedAt };
    }
  } else {
    errors.push(`weather: ${weather.reason || 'no current observation'}`);
  }

  if (air.ok && Number.isFinite(air.aqi) && air.observedAt) {
    values.aqi = { value: air.aqi, observedAt: air.observedAt };
  } else {
    errors.push(`air quality: ${air.reason || 'no current observation'}`);
  }

  return { values, errors };
}

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

/**
 * The single ingestion path: persist a reading, test it for anomalies, update
 * the sensor's cached state, and raise or clear alerts.
 *
 * @param {object} sensor A Sensor document (not a lean object — it is saved)
 * @param {number} value
 * @param {Date} [recordedAt]
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
    source: sensor.source,
    isAnomaly: verdict.isAnomaly,
    zScore: verdict.zScore,
  });

  sensor.currentValue = value;
  sensor.lastReadingAt = recordedAt;
  if (sensor.source !== 'open-meteo' && Number.isFinite(sensor.batteryLevel)) {
    // A hardware battery drains slowly; a flat battery takes the sensor offline.
    sensor.batteryLevel = Math.max(0, sensor.batteryLevel - 0.01);
  }
  if (sensor.status !== 'maintenance') {
    const breached =
      (sensor.warnAbove != null && value > sensor.warnAbove) ||
      (sensor.warnBelow != null && value < sensor.warnBelow);
    const flat = Number.isFinite(sensor.batteryLevel) && sensor.batteryLevel <= 0;
    sensor.status = flat ? 'offline' : breached ? 'warning' : 'online';
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

/**
 * One refresh across every active sensor.
 *
 *   • virtual sensors ingest a reading only when Open-Meteo has a newer
 *     observation than the one already stored;
 *   • simulated sensors emit one generated reading, unless an administrator
 *     has switched simulation off;
 *   • sensors in maintenance, and simulated sensors that are offline,
 *     transmit nothing — only a real reading may bring a device back.
 *
 * @returns {Promise<{live: number, simulated: number, anomalies: number, stale: number, simulationEnabled: boolean, errors: string[]}>}
 */
async function refreshSensors() {
  const settings = await Setting.current();
  const sensors = await Sensor.find({ active: true, status: { $ne: 'maintenance' }, source: { $in: ['open-meteo', 'simulated'] } });
  const parks = await Park.find({ _id: { $in: [...new Set(sensors.map((s) => String(s.park)))] } }).select('name location').lean();
  const parkById = new Map(parks.map((p) => [String(p._id), p]));

  const result = { live: 0, simulated: 0, anomalies: 0, stale: 0, simulationEnabled: settings.enableSensorSimulation, errors: [] };
  const observations = new Map();

  for (const sensor of sensors) {
    const park = parkById.get(String(sensor.park));
    if (!park) continue;

    if (sensor.source === 'open-meteo') {
      if (!observations.has(String(park._id))) {
        const live = await liveObservations(park);
        observations.set(String(park._id), live);
        result.errors.push(...live.errors.map((e) => `${park.name} — ${e}`));
      }
      const observation = observations.get(String(park._id)).values[sensor.type];
      const newer = observation && (!sensor.lastReadingAt || Date.parse(observation.observedAt) > sensor.lastReadingAt.getTime());

      if (newer) {
        const { verdict } = await ingestReading(sensor, Math.round(observation.value * 10) / 10, new Date(observation.observedAt));
        result.live += 1;
        if (verdict.isAnomaly) result.anomalies += 1;
      } else if (!observation && sensor.lastReadingAt && Date.now() - sensor.lastReadingAt.getTime() > LIVE_OFFLINE_AFTER_MS && sensor.status !== 'offline') {
        sensor.status = 'offline';
        await sensor.save();
        result.stale += 1;
      }
    } else if (settings.enableSensorSimulation && sensor.status !== 'offline') {
      const { value } = nextValue(sensor);
      const { verdict } = await ingestReading(sensor, value);
      result.simulated += 1;
      if (verdict.isAnomaly) result.anomalies += 1;
    }
  }

  if (result.live || result.simulated) {
    // Loaded lazily: ecosystem-score depends on the models this file loads.
    const { refreshAllParkScores } = require('./ecosystem-score.service');
    await refreshAllParkScores();
  }

  return result;
}

let timer = null;

/** Start periodic refreshes. Idempotent. */
function startSensorRefresh() {
  if (timer || env.sensorIntervalMs <= 0) return;

  const tick = async () => {
    try {
      const result = await refreshSensors();
      if (result.errors.length) logger.warn(`Live sensor data unavailable: ${[...new Set(result.errors)].slice(0, 3).join('; ')}`);
      if (result.anomalies) logger.info(`Sensor refresh: ${result.live} live, ${result.simulated} simulated, ${result.anomalies} anomalies`);
    } catch (err) {
      logger.error('Sensor refresh failed:', err.message);
    }
  };

  tick();
  timer = setInterval(tick, env.sensorIntervalMs);
  if (timer.unref) timer.unref();
  logger.info(`Sensor refresh every ${env.sensorIntervalMs / 1000}s (live: Open-Meteo; simulated: noise, soil, water)`);
}

function stopSensorRefresh() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

// ---------------------------------------------------------------------------
// History for a new database
// ---------------------------------------------------------------------------

/**
 * Give freshly created sensors a history so charts and the anomaly detector
 * have data from the first page load.
 *
 *   virtual sensors  → the real hourly observations of the past `hours`
 *                      (skipped, with a warning, if Open-Meteo is unreachable)
 *   simulated sensors → generated readings at `stepMinutes` spacing
 *
 * @param {object[]} sensors Sensor documents
 * @param {object[]} parks   Park documents
 * @param {object} [options]
 * @param {boolean} [options.fetchLive=true]
 */
async function backfillHistory(sensors, parks, { hours = 48, stepMinutes = 60, fetchLive = true } = {}) {
  const parkById = new Map(parks.map((p) => [String(p._id), p]));
  const historyByPark = new Map();
  const summary = { live: 0, simulated: 0, liveUnavailable: [] };

  for (const sensor of sensors) {
    const docs = [];

    if (sensor.source === 'open-meteo') {
      if (!fetchLive) continue;
      const park = parkById.get(String(sensor.park));
      if (!historyByPark.has(String(park._id))) {
        const [lng, lat] = park.location.coordinates;
        historyByPark.set(String(park._id), await external.getHourlyHistory(lat, lng, { pastDays: Math.ceil(hours / 24) }));
      }
      const history = historyByPark.get(String(park._id));
      if (!history.ok) {
        summary.liveUnavailable.push(park.name);
        continue;
      }
      const since = Date.now() - hours * 3_600_000;
      for (const row of history.hours) {
        const value = row[sensor.type];
        if (Date.parse(row.time) < since || !Number.isFinite(value)) continue;
        docs.push({ value: Math.round(value * 10) / 10, recordedAt: new Date(row.time) });
      }
      summary.live += docs.length;
    } else if (sensor.source === 'simulated') {
      let previous = 0;
      for (let t = Date.now() - hours * 3_600_000; t <= Date.now(); t += stepMinutes * 60_000) {
        const { value } = nextValue({ ...sensor.toObject(), currentValue: previous }, new Date(t));
        previous = value;
        docs.push({ value, recordedAt: new Date(t) });
      }
      summary.simulated += docs.length;
    }

    if (!docs.length) continue;

    // Anomaly verdicts are computed over the series as it would have arrived.
    const values = [];
    const readings = docs.map(({ value, recordedAt }) => {
      const verdict = anomalyService.detect(value, values.slice(-anomalyService.WINDOW_SIZE).reverse());
      values.push(value);
      return {
        sensor: sensor._id,
        park: sensor.park,
        type: sensor.type,
        value,
        unit: sensor.unit,
        recordedAt,
        source: sensor.source,
        isAnomaly: verdict.isAnomaly,
        zScore: verdict.zScore,
      };
    });
    await SensorReading.insertMany(readings);

    const last = readings[readings.length - 1];
    sensor.currentValue = last.value;
    sensor.lastReadingAt = last.recordedAt;
    const breached = (sensor.warnAbove != null && last.value > sensor.warnAbove) || (sensor.warnBelow != null && last.value < sensor.warnBelow);
    if (sensor.status !== 'offline' && sensor.status !== 'maintenance') sensor.status = breached ? 'warning' : 'online';
    await sensor.save();
  }

  return summary;
}

module.exports = {
  nextValue,
  ingestReading,
  refreshSensors,
  startSensorRefresh,
  stopSensorRefresh,
  backfillHistory,
  liveObservations,
  localHour,
  gaussian,
  DIURNAL,
  LIVE_TYPES,
};

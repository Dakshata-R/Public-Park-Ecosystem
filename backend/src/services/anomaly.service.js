'use strict';

/**
 * Environmental anomaly detection — Module 5 / Module 6.
 *
 * The system must flag a reading that is unusual *for that sensor*, not merely
 * one that crosses a fixed threshold: 30 °C is unremarkable in a car park and
 * alarming inside a shaded wetland. Three complementary detectors run over a
 * rolling window of the sensor's own recent history.
 *
 * ---------------------------------------------------------------------------
 * 1. Z-score (parametric)
 * ---------------------------------------------------------------------------
 *   μ = (1/n) Σ xᵢ            σ = √( (1/(n−1)) Σ (xᵢ − μ)² )
 *   z = (x − μ) / σ
 *
 * Flagged when |z| > k (k = 3 by default, the ~99.7 % interval of a normal
 * distribution). Cheap and interpretable, but σ is itself dragged upward by
 * the very outliers it is meant to detect.
 *
 * ---------------------------------------------------------------------------
 * 2. Modified z-score (robust)
 * ---------------------------------------------------------------------------
 *   MAD = median(|xᵢ − median(x)|)
 *   M   = 0.6745 · (x − median(x)) / MAD
 *
 * The constant 0.6745 is Φ⁻¹(0.75), which makes MAD a consistent estimator of
 * σ for normally distributed data — so the threshold |M| > 3.5 is comparable
 * to the z-score's k = 3. Because the median has a 50 % breakdown point, this
 * detector is not fooled by a handful of extreme values.
 *
 * ---------------------------------------------------------------------------
 * 3. Tukey's IQR fence (non-parametric)
 * ---------------------------------------------------------------------------
 *   IQR = Q₃ − Q₁
 *   outlier ⟺ x < Q₁ − 1.5·IQR  or  x > Q₃ + 1.5·IQR
 *
 * Assumes no distribution at all, which matters for skewed variables such as
 * AQI where the upper tail is genuinely long.
 *
 * A reading is reported as anomalous when at least two of the three detectors
 * agree. Majority voting cuts the false-positive rate that any single detector
 * produces on the noisy, non-stationary data a park sensor generates.
 */

const { SensorReading } = require('../models');

/** Readings of history used as the reference window. */
const WINDOW_SIZE = 50;
/** Minimum history before detection is meaningful. */
const MIN_SAMPLES = 8;

/** Arithmetic mean. */
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Sample standard deviation (Bessel-corrected, n − 1). */
function stdDev(xs, mu = mean(xs)) {
  if (xs.length < 2) return 0;
  const variance = xs.reduce((sum, x) => sum + (x - mu) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

/** Median of an unsorted array. */
function median(xs) {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Quantile by linear interpolation between order statistics
 * (the "type 7" definition used by R and NumPy).
 * @param {number[]} xs
 * @param {number} q 0–1
 */
function quantile(xs, q) {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (pos - lower) * (sorted[upper] - sorted[lower]);
}

/**
 * Run all three detectors on one value against a history window.
 *
 * @param {number} value    The reading under test
 * @param {number[]} history Previous readings, most recent first or last — order is irrelevant
 * @param {object} [options]
 * @param {number} [options.zThreshold=3]        k for the z-score test
 * @param {number} [options.modifiedZThreshold=3.5]
 * @param {number} [options.iqrMultiplier=1.5]
 * @returns {{isAnomaly:boolean, votes:number, zScore:number, modifiedZScore:number,
 *            bounds:{lower:number, upper:number}, mean:number, stdDev:number,
 *            detectors:{zScore:boolean, modifiedZScore:boolean, iqr:boolean},
 *            reason:string, sampleSize:number}}
 */
function detect(value, history, options = {}) {
  const {
    zThreshold = 3,
    modifiedZThreshold = 3.5,
    iqrMultiplier = 1.5,
  } = options;

  const xs = (history || []).filter(Number.isFinite);

  if (xs.length < MIN_SAMPLES) {
    return {
      isAnomaly: false,
      votes: 0,
      zScore: 0,
      modifiedZScore: 0,
      bounds: { lower: -Infinity, upper: Infinity },
      mean: xs.length ? mean(xs) : value,
      stdDev: 0,
      detectors: { zScore: false, modifiedZScore: false, iqr: false },
      reason: `insufficient history (${xs.length}/${MIN_SAMPLES} samples)`,
      sampleSize: xs.length,
    };
  }

  // --- 1. Z-score -------------------------------------------------------
  const mu = mean(xs);
  const sigma = stdDev(xs, mu);
  const zScore = sigma > 0 ? (value - mu) / sigma : 0;
  const zFlag = Math.abs(zScore) > zThreshold;

  // --- 2. Modified z-score ---------------------------------------------
  const med = median(xs);
  const mad = median(xs.map((x) => Math.abs(x - med)));
  // MAD = 0 means over half the window is identical; fall back to σ so a
  // constant-then-jump series is still caught.
  const scale = mad > 0 ? mad / 0.6745 : sigma;
  const modifiedZScore = scale > 0 ? (value - med) / scale : 0;
  const modifiedFlag = Math.abs(modifiedZScore) > modifiedZThreshold;

  // --- 3. Tukey fence ---------------------------------------------------
  const q1 = quantile(xs, 0.25);
  const q3 = quantile(xs, 0.75);
  const iqr = q3 - q1;
  const lower = q1 - iqrMultiplier * iqr;
  const upper = q3 + iqrMultiplier * iqr;
  const iqrFlag = iqr > 0 && (value < lower || value > upper);

  const detectors = { zScore: zFlag, modifiedZScore: modifiedFlag, iqr: iqrFlag };
  const votes = Object.values(detectors).filter(Boolean).length;
  const isAnomaly = votes >= 2; // majority of three

  const direction = value > mu ? 'above' : 'below';
  const reason = isAnomaly
    ? `Unusual reading: well ${direction} the recent average of ${mu.toFixed(1)}`
    : 'within expected range';

  const round = (v) => Math.round(v * 1000) / 1000;

  return {
    isAnomaly,
    votes,
    zScore: round(zScore),
    modifiedZScore: round(modifiedZScore),
    bounds: { lower: round(lower), upper: round(upper) },
    mean: round(mu),
    stdDev: round(sigma),
    detectors,
    reason,
    sampleSize: xs.length,
  };
}

/**
 * Fetch a sensor's recent history from MongoDB and test a candidate value.
 *
 * @param {import('mongoose').Types.ObjectId|string} sensorId
 * @param {number} value
 * @param {object} [options] Forwarded to `detect`
 */
async function detectForSensor(sensorId, value, options = {}) {
  const history = await SensorReading.find({ sensor: sensorId })
    .sort({ recordedAt: -1 })
    .limit(WINDOW_SIZE)
    .select('value')
    .lean();

  return detect(value, history.map((r) => r.value), options);
}

/**
 * Scan a sensor's stored series and return every reading the ensemble flags.
 * Used by the analytics module to chart historical anomalies.
 *
 * @param {import('mongoose').Types.ObjectId|string} sensorId
 * @param {number} [limit=200]
 */
async function scanSensorHistory(sensorId, limit = 200) {
  const readings = await SensorReading.find({ sensor: sensorId })
    .sort({ recordedAt: 1 })
    .limit(limit)
    .select('value recordedAt')
    .lean();

  const anomalies = [];
  for (let i = MIN_SAMPLES; i < readings.length; i += 1) {
    const window = readings.slice(Math.max(0, i - WINDOW_SIZE), i).map((r) => r.value);
    const result = detect(readings[i].value, window);
    if (result.isAnomaly) {
      anomalies.push({
        recordedAt: readings[i].recordedAt,
        value: readings[i].value,
        zScore: result.zScore,
        reason: result.reason,
      });
    }
  }
  return anomalies;
}

module.exports = {
  detect,
  detectForSensor,
  scanSensorHistory,
  mean,
  stdDev,
  median,
  quantile,
  WINDOW_SIZE,
  MIN_SAMPLES,
};

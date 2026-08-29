'use strict';

/**
 * Alert generation with de-duplication — Module 1 / Module 8.
 *
 * A sensor that stays out of range produces a reading every minute. Raising a
 * new alert for each one buries the operator in noise, so alerts are keyed by
 * the *condition* rather than the event: a repeat of an already-active
 * condition bumps its occurrence counter and refreshes its timestamp instead
 * of creating a second row.
 */

const { Alert } = require('../models');
const logger = require('../utils/logger');

/**
 * Raise (or refresh) an alert.
 *
 * @param {object} input
 * @param {string} input.title
 * @param {string} [input.message]
 * @param {string} input.module            Human-readable module name
 * @param {'sensor'|'ai'|'incident'|'system'|'anomaly'} input.source
 * @param {'low'|'medium'|'high'|'critical'} input.severity
 * @param {import('mongoose').Types.ObjectId} [input.park]
 * @param {string} [input.relatedModel]
 * @param {import('mongoose').Types.ObjectId} [input.relatedId]
 * @param {string} input.dedupeKey         Stable identity of the condition
 * @returns {Promise<{alert: object, created: boolean}>}
 */
async function raise(input) {
  const { dedupeKey } = input;

  if (dedupeKey) {
    const existing = await Alert.findOne({ dedupeKey, status: { $ne: 'resolved' } });
    if (existing) {
      existing.occurrences += 1;
      // A condition that worsens should escalate the existing alert.
      const rank = { low: 1, medium: 2, high: 3, critical: 4 };
      if (rank[input.severity] > rank[existing.severity]) existing.severity = input.severity;
      existing.message = input.message || existing.message;
      existing.updatedAt = new Date();
      await existing.save();
      return { alert: existing, created: false };
    }
  }

  const alert = await Alert.create(input);
  logger.warn(`Alert raised [${input.severity}] ${input.title}`);
  return { alert, created: true };
}

/**
 * Close any active alert matching a dedupe key — used when a sensor returns
 * to its normal range, so the dashboard clears itself without manual action.
 *
 * @param {string} dedupeKey
 * @returns {Promise<number>} Number of alerts resolved
 */
async function autoResolve(dedupeKey) {
  const result = await Alert.updateMany(
    { dedupeKey, status: { $ne: 'resolved' } },
    { $set: { status: 'resolved', resolvedAt: new Date() } }
  );
  return result.modifiedCount || 0;
}

/**
 * Evaluate one sensor reading against its thresholds and raise/clear the
 * corresponding threshold alert.
 *
 * @param {object} sensor  A Sensor document
 * @param {number} value   The new reading
 */
async function evaluateSensorThreshold(sensor, value) {
  const dedupeKey = `sensor:${sensor._id}:threshold`;

  const overHigh = sensor.warnAbove != null && value > sensor.warnAbove;
  const underLow = sensor.warnBelow != null && value < sensor.warnBelow;

  if (!overHigh && !underLow) {
    await autoResolve(dedupeKey);
    return null;
  }

  const bound = overHigh ? sensor.warnAbove : sensor.warnBelow;
  const direction = overHigh ? 'above' : 'below';
  // How far past the threshold, relative to the threshold itself.
  const exceedance = bound !== 0 ? Math.abs((value - bound) / bound) : 1;
  const severity = exceedance > 0.5 ? 'critical' : exceedance > 0.2 ? 'high' : 'medium';

  const { alert } = await raise({
    title: `${sensor.name}: ${sensor.type.toUpperCase()} ${direction} threshold`,
    message: `Reading ${value} ${sensor.unit} is ${direction} the ${bound} ${sensor.unit} threshold.`,
    module: 'Environmental Sensors',
    source: 'sensor',
    severity,
    park: sensor.park,
    relatedModel: 'Sensor',
    relatedId: sensor._id,
    dedupeKey,
  });

  return alert;
}

/**
 * Raise an alert for a statistically anomalous reading.
 *
 * @param {object} sensor
 * @param {number} value
 * @param {{zScore:number, reason:string, votes:number}} verdict
 */
async function raiseAnomalyAlert(sensor, value, verdict) {
  const { alert } = await raise({
    title: `Anomalous ${sensor.type} reading at ${sensor.name}`,
    message: `Value ${value} ${sensor.unit}. ${verdict.reason}`,
    module: 'Anomaly Detection',
    source: 'anomaly',
    severity: verdict.votes === 3 ? 'high' : 'medium',
    park: sensor.park,
    relatedModel: 'Sensor',
    relatedId: sensor._id,
    // Not deduped by condition: each anomaly is a distinct statistical event.
    dedupeKey: `anomaly:${sensor._id}:${new Date().toISOString().slice(0, 13)}`,
  });
  return alert;
}

module.exports = { raise, autoResolve, evaluateSensorThreshold, raiseAnomalyAlert };

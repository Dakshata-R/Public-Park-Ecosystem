'use strict';

/**
 * Module 6 — sensor anomaly detection.
 *
 * The detector is a majority vote of three independent tests (z-score,
 * modified z-score on the MAD, and a Tukey fence). These tests pin the
 * voting rule and the degenerate cases that break naive implementations:
 * a constant history, a short history, and a zero IQR.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { detect } = require('../../src/services/anomaly.service');

/** A calm, slightly noisy series to act as "normal". */
const calm = [20.1, 19.8, 20.0, 20.3, 19.9, 20.2, 20.0, 19.7, 20.1, 20.4, 19.95, 20.05];

test('a value sitting in the middle of the history is not an anomaly', () => {
  const result = detect(20.0, calm);

  assert.equal(result.isAnomaly, false);
  assert.equal(result.votes, 0);
  assert.equal(result.reason, 'within expected range');
  assert.ok(Math.abs(result.zScore) < 1);
});

test('a large spike is flagged by a majority of detectors', () => {
  const result = detect(95, calm);

  assert.equal(result.isAnomaly, true);
  assert.ok(result.votes >= 2, `expected >= 2 votes, got ${result.votes}`);
  assert.ok(result.zScore > 3, `expected a large z-score, got ${result.zScore}`);
  assert.match(result.reason, /Unusual reading/);
});

test('a large drop is flagged just as a spike is', () => {
  const result = detect(-40, calm);

  assert.equal(result.isAnomaly, true);
  assert.ok(result.zScore < -3);
  assert.match(result.reason, /below/);
});

test('anomaly requires two of three votes, never a single detector', () => {
  // Whatever the input, the published verdict must agree with the vote count.
  for (const candidate of [20, 21, 25, 30, 50, -10, 0]) {
    const result = detect(candidate, calm);
    assert.equal(
      result.isAnomaly,
      result.votes >= 2,
      `verdict disagreed with ${result.votes} votes for value ${candidate}`
    );
  }
});

test('too little history suppresses detection instead of dividing by zero', () => {
  const result = detect(500, [20, 21]);

  assert.equal(result.isAnomaly, false);
  assert.equal(result.votes, 0);
  assert.equal(result.sampleSize, 2);
  assert.match(result.reason, /insufficient history/);
  assert.equal(result.bounds.lower, -Infinity);
  assert.equal(result.bounds.upper, Infinity);
});

test('an empty history is handled without NaN', () => {
  const result = detect(42, []);

  assert.equal(result.isAnomaly, false);
  assert.equal(result.sampleSize, 0);
  assert.equal(result.mean, 42, 'falls back to the candidate value');
  for (const key of ['zScore', 'modifiedZScore', 'stdDev']) {
    assert.ok(Number.isFinite(result[key]), `${key} should be finite`);
  }
});

test('non-numeric history entries are filtered out before the statistics', () => {
  const dirty = [...calm, NaN, undefined, null, 'twenty', Infinity];
  const result = detect(20.0, dirty);

  assert.equal(result.sampleSize, calm.length);
  assert.ok(Number.isFinite(result.mean));
  assert.ok(Number.isFinite(result.stdDev));
});

test('a perfectly constant history still catches a jump (MAD falls back to sigma)', () => {
  // MAD is 0 here, which would make the modified z-score divide by zero.
  const constant = Array(15).fill(20);
  const result = detect(20, constant);

  assert.equal(result.isAnomaly, false, 'the constant value itself is normal');
  assert.ok(Number.isFinite(result.modifiedZScore), 'must not be NaN');
  assert.ok(Number.isFinite(result.zScore));
});

test('a zero-IQR history does not let the Tukey fence fire spuriously', () => {
  const constant = Array(15).fill(20);
  const result = detect(999, constant);

  // σ and MAD are both 0, so no detector has a usable scale: the
  // implementation must report finite numbers rather than Infinity/NaN.
  assert.ok(Number.isFinite(result.zScore));
  assert.ok(Number.isFinite(result.modifiedZScore));
  assert.equal(result.detectors.iqr, false, 'IQR of 0 must not flag');
});

test('thresholds are configurable and tighten detection', () => {
  const lenient = detect(21.5, calm, { zThreshold: 10, modifiedZThreshold: 10, iqrMultiplier: 10 });
  const strict = detect(21.5, calm, { zThreshold: 0.5, modifiedZThreshold: 0.5, iqrMultiplier: 0.1 });

  assert.equal(lenient.isAnomaly, false);
  assert.equal(strict.isAnomaly, true);
});

test('the reported bounds bracket the calm history', () => {
  const result = detect(20, calm);

  assert.ok(result.bounds.lower < Math.min(...calm));
  assert.ok(result.bounds.upper > Math.max(...calm));
});

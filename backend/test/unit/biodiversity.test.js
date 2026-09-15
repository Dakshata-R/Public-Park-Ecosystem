'use strict';

/**
 * Module 4 — diversity index mathematics.
 *
 * Expected values are derived from the textbook definitions, not from the
 * implementation, so the tests check the mathematics rather than the code's
 * agreement with itself.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeIndices,
  biodiversityScore,
  RICHNESS_REFERENCE,
} = require('../../src/services/biodiversity.service');

/** Assert two floats agree to `places` decimal places. */
const close = (actual, expected, places = 3, label = '') => {
  const tolerance = 0.5 * 10 ** -places;
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `${label || 'value'}: expected ≈${expected}, got ${actual}`
  );
};

test('a perfectly even community has evenness 1 and H′ = ln S', () => {
  const indices = computeIndices([10, 10, 10, 10]);

  assert.equal(indices.richness, 4);
  assert.equal(indices.total, 40);
  close(indices.shannon, Math.log(4), 3, 'shannon');
  close(indices.evenness, 1, 3, 'evenness');
  // Every species holds 1/4, so Σp² = 4 × 0.0625 = 0.25.
  close(indices.simpson, 0.25, 4, 'simpson');
  close(indices.simpsonDiversity, 0.75, 4, 'simpsonDiversity');
  close(indices.dominance, 0.25, 4, 'dominance');
});

test('a single-species community has zero diversity by definition', () => {
  const indices = computeIndices([25]);

  assert.equal(indices.richness, 1);
  assert.equal(indices.total, 25);
  assert.equal(indices.shannon, 0);
  assert.equal(indices.shannonMax, 0);
  // J' is undefined when ln(S) = 0; the project defines it as 0.
  assert.equal(indices.evenness, 0);
  assert.equal(indices.simpson, 1);
  assert.equal(indices.simpsonDiversity, 0);
  assert.equal(indices.dominance, 1);
});

test('Shannon matches a hand-computed uneven community', () => {
  // p = [0.5, 0.3, 0.2]
  // H' = −(0.5 ln0.5 + 0.3 ln0.3 + 0.2 ln0.2) = 1.029653…
  const indices = computeIndices([50, 30, 20]);

  close(indices.shannon, 1.0297, 3, 'shannon');
  close(indices.simpson, 0.38, 3, 'simpson');
  close(indices.dominance, 0.5, 3, 'dominance');
  close(indices.evenness, 1.0297 / Math.log(3), 3, 'evenness');
});

test('Margalef richness uses (S−1)/ln N and is 0 for a single individual', () => {
  const indices = computeIndices([50, 30, 20]);
  close(indices.margalef, 2 / Math.log(100), 3, 'margalef');

  // N = 1 makes ln N = 0, which the implementation reports as 0 rather than ∞.
  assert.equal(computeIndices([1]).margalef, 0);
});

test('dominance rises and evenness falls as one species takes over', () => {
  const even = computeIndices([25, 25, 25, 25]);
  const skewed = computeIndices([97, 1, 1, 1]);

  assert.equal(even.richness, skewed.richness, 'richness is unchanged');
  assert.ok(skewed.dominance > even.dominance, 'dominance should rise');
  assert.ok(skewed.evenness < even.evenness, 'evenness should fall');
  assert.ok(skewed.shannon < even.shannon, 'Shannon should fall');
});

test('non-positive and non-finite abundances are discarded, not counted', () => {
  const cleaned = computeIndices([10, 0, -5, NaN, Infinity, undefined, null, 10]);
  const expected = computeIndices([10, 10]);

  assert.deepEqual(cleaned, expected);
});

test('an empty community returns a zeroed index set rather than NaN', () => {
  const indices = computeIndices([]);

  assert.equal(indices.richness, 0);
  assert.equal(indices.total, 0);
  for (const [key, value] of Object.entries(indices)) {
    assert.ok(Number.isFinite(value), `${key} should be finite, got ${value}`);
    assert.equal(value, 0, `${key} should be 0`);
  }
});

test('an all-zero community is treated as empty', () => {
  assert.deepEqual(computeIndices([0, 0, 0]), computeIndices([]));
});

test('the composite score is 0 for an empty community and bounded elsewhere', () => {
  assert.equal(biodiversityScore(computeIndices([]), 0), 0);
  assert.equal(biodiversityScore(null, 0), 0);

  const rich = biodiversityScore(computeIndices(Array(RICHNESS_REFERENCE).fill(10)), 1);
  assert.ok(rich > 0 && rich <= 100, `score out of range: ${rich}`);
});

test('the composite score rewards richer, more even communities', () => {
  const poor = biodiversityScore(computeIndices([90, 5, 5]), 0);
  const rich = biodiversityScore(computeIndices(Array(20).fill(10)), 0);

  assert.ok(rich > poor, `expected ${rich} > ${poor}`);
});

test('conservation weighting can only raise the score', () => {
  const indices = computeIndices([20, 15, 10, 5]);
  const withoutThreatened = biodiversityScore(indices, 0);
  const withThreatened = biodiversityScore(indices, 1);

  assert.ok(withThreatened >= withoutThreatened);
  assert.ok(withThreatened <= 100);
});

test('the composite score stays within 0–100 across extreme inputs', () => {
  const cases = [
    computeIndices([1]),
    computeIndices([1, 1]),
    computeIndices(Array(500).fill(1000)),
    computeIndices([1e9, 1]),
  ];

  for (const indices of cases) {
    for (const conservation of [0, 0.5, 1]) {
      const score = biodiversityScore(indices, conservation);
      assert.ok(
        Number.isFinite(score) && score >= 0 && score <= 100,
        `score out of range: ${score} for richness ${indices.richness}`
      );
    }
  }
});

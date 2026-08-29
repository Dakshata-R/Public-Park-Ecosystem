'use strict';

/**
 * Seeded pseudo-random number generator.
 *
 * The demonstration dataset must be reproducible: a viva that shows a
 * Shannon index of 2.41 should still show 2.41 after a reseed, and a bug in
 * an aggregation should be reproducible from the same starting data. Node's
 * `Math.random` cannot be seeded, so mulberry32 is used instead — 32-bit
 * state, a few operations per value, and good enough statistical quality for
 * generating plausible sample data.
 */

/**
 * @param {number} seed
 * @returns {() => number} generator yielding uniform values in [0, 1)
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build the helper set used throughout the seed script. */
function createRandom(seed = 20260828) {
  const next = mulberry32(seed);

  /** Uniform float in [min, max). */
  const float = (min, max) => min + next() * (max - min);

  /** Uniform integer in [min, max] inclusive. */
  const int = (min, max) => Math.floor(float(min, max + 1));

  /** Uniform choice from an array. */
  const pick = (items) => items[int(0, items.length - 1)];

  /** `n` distinct choices (or all of them, if n exceeds the length). */
  const sample = (items, n) => {
    const pool = [...items];
    const out = [];
    while (out.length < n && pool.length) {
      out.push(pool.splice(int(0, pool.length - 1), 1)[0]);
    }
    return out;
  };

  /** True with probability `p`. */
  const chance = (p) => next() < p;

  /**
   * Weighted choice: `items` is an array of objects each carrying a numeric
   * `weight`. Used to give common species realistic dominance over rare ones.
   */
  const weighted = (items, weightKey = 'weight') => {
    const total = items.reduce((sum, item) => sum + (item[weightKey] || 1), 0);
    let threshold = float(0, total);
    for (const item of items) {
      threshold -= item[weightKey] || 1;
      if (threshold <= 0) return item;
    }
    return items[items.length - 1];
  };

  /** Standard normal via Box–Muller, for jittering coordinates and values. */
  const gaussian = (mean = 0, stdDev = 1) => {
    const u1 = next() || Number.EPSILON;
    const u2 = next();
    return mean + stdDev * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };

  /** A date `daysAgoMax`…`daysAgoMin` days in the past. */
  const pastDate = (daysAgoMax, daysAgoMin = 0) =>
    new Date(Date.now() - float(daysAgoMin, daysAgoMax) * 86_400_000);

  /** A date up to `daysAhead` days in the future. */
  const futureDate = (daysAhead) => new Date(Date.now() + float(0, daysAhead) * 86_400_000);

  return { next, float, int, pick, sample, chance, weighted, gaussian, pastDate, futureDate };
}

module.exports = { createRandom, mulberry32 };

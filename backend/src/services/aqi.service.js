'use strict';

/**
 * Air quality mathematics.
 *
 * ---------------------------------------------------------------------------
 * 1. Sub-index (piecewise linear interpolation)
 * ---------------------------------------------------------------------------
 * A pollutant concentration C is mapped to an index value using the breakpoint
 * table published by the Central Pollution Control Board (CPCB, India) — the
 * same piecewise-linear scheme the US EPA uses, with Indian breakpoints:
 *
 *        I_high − I_low
 *   I = ─────────────── · (C − C_low) + I_low
 *        C_high − C_low
 *
 * where [C_low, C_high] is the concentration band containing C and
 * [I_low, I_high] is the matching index band.
 *
 * ---------------------------------------------------------------------------
 * 2. Overall AQI (maximum operator)
 * ---------------------------------------------------------------------------
 *   AQI = max(I_PM2.5, I_PM10, I_NO2, I_SO2, I_CO, I_O3)
 *
 * The maximum — not the mean — is used deliberately: air is only as clean as
 * its worst pollutant, and averaging would let one hazardous pollutant hide
 * behind five clean ones.
 *
 * ---------------------------------------------------------------------------
 * 3. Normalisation to a "goodness" score
 * ---------------------------------------------------------------------------
 * AQI is an inverted scale (0 is best, 500 is worst) while every other index
 * in this project is 0–100 where higher is better. `aqiToScore` performs the
 * inversion with a piecewise map anchored on the CPCB category boundaries, so
 * a category boundary in AQI space lands on a round number in score space.
 */

/**
 * CPCB breakpoints. Concentrations in µg/m³ except CO (mg/m³).
 * Each row: [C_low, C_high, I_low, I_high].
 */
const BREAKPOINTS = {
  pm25: [
    [0, 30, 0, 50], [31, 60, 51, 100], [61, 90, 101, 200],
    [91, 120, 201, 300], [121, 250, 301, 400], [251, 500, 401, 500],
  ],
  pm10: [
    [0, 50, 0, 50], [51, 100, 51, 100], [101, 250, 101, 200],
    [251, 350, 201, 300], [351, 430, 301, 400], [431, 600, 401, 500],
  ],
  no2: [
    [0, 40, 0, 50], [41, 80, 51, 100], [81, 180, 101, 200],
    [181, 280, 201, 300], [281, 400, 301, 400], [401, 600, 401, 500],
  ],
  so2: [
    [0, 40, 0, 50], [41, 80, 51, 100], [81, 380, 101, 200],
    [381, 800, 201, 300], [801, 1600, 301, 400], [1601, 2400, 401, 500],
  ],
  co: [
    [0, 1, 0, 50], [1.1, 2, 51, 100], [2.1, 10, 101, 200],
    [10.1, 17, 201, 300], [17.1, 34, 301, 400], [34.1, 50, 401, 500],
  ],
  o3: [
    [0, 50, 0, 50], [51, 100, 51, 100], [101, 168, 101, 200],
    [169, 208, 201, 300], [209, 748, 301, 400], [749, 1000, 401, 500],
  ],
};

/** CPCB category bands, used for labels and for score normalisation. */
const CATEGORIES = [
  { max: 50,  label: 'Good',         score: 100, advice: 'Air quality is satisfactory; outdoor activity is safe for everyone.' },
  { max: 100, label: 'Satisfactory', score: 80,  advice: 'Minor breathing discomfort possible for sensitive individuals.' },
  { max: 200, label: 'Moderate',     score: 60,  advice: 'Breathing discomfort for people with lung or heart disease.' },
  { max: 300, label: 'Poor',         score: 40,  advice: 'Breathing discomfort on prolonged exposure; limit strenuous activity.' },
  { max: 400, label: 'Very Poor',    score: 20,  advice: 'Respiratory illness on prolonged exposure; avoid outdoor exertion.' },
  { max: 500, label: 'Severe',       score: 0,   advice: 'Serious health impact even for healthy people; avoid outdoor activity.' },
];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Sub-index for one pollutant.
 *
 * @param {keyof typeof BREAKPOINTS} pollutant
 * @param {number} concentration µg/m³ (mg/m³ for CO)
 * @returns {number|null} 0–500, or null when the pollutant is unknown
 */
function subIndex(pollutant, concentration) {
  const table = BREAKPOINTS[pollutant];
  if (!table || !Number.isFinite(concentration)) return null;

  const c = Math.max(0, concentration);

  for (const [cLow, cHigh, iLow, iHigh] of table) {
    if (c >= cLow && c <= cHigh) {
      // Guard the degenerate band width case.
      if (cHigh === cLow) return iHigh;
      return Math.round(((iHigh - iLow) / (cHigh - cLow)) * (c - cLow) + iLow);
    }
  }

  // Above the top breakpoint the index saturates at 500.
  return 500;
}

/**
 * Overall AQI as the maximum of the available sub-indices.
 *
 * @param {Record<string, number>} concentrations e.g. { pm25: 42, no2: 18 }
 * @returns {{aqi: number, dominant: string|null, subIndices: Record<string, number>}}
 */
function computeAqi(concentrations = {}) {
  const subIndices = {};
  let aqi = 0;
  let dominant = null;

  for (const [pollutant, value] of Object.entries(concentrations)) {
    const index = subIndex(pollutant, value);
    if (index === null) continue;
    subIndices[pollutant] = index;
    if (index > aqi) {
      aqi = index;
      dominant = pollutant;
    }
  }

  return { aqi, dominant, subIndices };
}

/** CPCB category for an AQI value. */
function categorise(aqi) {
  const value = clamp(aqi, 0, 500);
  return CATEGORIES.find((c) => value <= c.max) || CATEGORIES[CATEGORIES.length - 1];
}

/**
 * Invert AQI onto the project's 0–100 "higher is better" scale.
 *
 * Linear interpolation is applied *within* each CPCB band so the mapping is
 * continuous, while the band edges land on the round anchor values in
 * `CATEGORIES` (AQI 50 → 100, 100 → 80, 200 → 60, 300 → 40, 400 → 20, 500 → 0).
 *
 * @param {number} aqi
 * @returns {number} 0–100, one decimal place
 */
function aqiToScore(aqi) {
  const value = clamp(aqi, 0, 500);

  let lowAqi = 0;
  let lowScore = 100;

  for (const band of CATEGORIES) {
    if (value <= band.max) {
      const span = band.max - lowAqi;
      if (span <= 0) return band.score;
      const t = (value - lowAqi) / span;
      return Math.round((lowScore + t * (band.score - lowScore)) * 10) / 10;
    }
    lowAqi = band.max;
    lowScore = band.score;
  }
  return 0;
}

/**
 * Convenience wrapper: raw AQI reading → everything the UI needs.
 * @param {number} aqi
 */
function describeAqi(aqi) {
  const category = categorise(aqi);
  return {
    aqi: Math.round(aqi),
    score: aqiToScore(aqi),
    label: category.label,
    advice: category.advice,
  };
}

module.exports = { subIndex, computeAqi, categorise, aqiToScore, describeAqi, BREAKPOINTS, CATEGORIES };

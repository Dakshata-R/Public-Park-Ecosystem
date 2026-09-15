'use strict';

/**
 * Module 6 — CPCB Air Quality Index mathematics.
 *
 * These assertions are computed by hand from the CPCB breakpoint table rather
 * than copied from the implementation's own output, so a regression in the
 * interpolation cannot pass by agreeing with itself.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { subIndex, computeAqi, categorise, aqiToScore, describeAqi } = require('../../src/services/aqi.service');

test('sub-index interpolates linearly inside a breakpoint band', () => {
  // PM2.5 band [0,30] → [0,50]. 15 µg/m³ is the midpoint, so I = 25.
  assert.equal(subIndex('pm25', 15), 25);

  // PM10 band [51,100] → [51,100]: the band is 1:1, so I equals C.
  assert.equal(subIndex('pm10', 75), 75);
});

test('sub-index lands exactly on the CPCB band edges', () => {
  assert.equal(subIndex('pm25', 0), 0);
  assert.equal(subIndex('pm25', 30), 50);
  assert.equal(subIndex('pm10', 50), 50);
  assert.equal(subIndex('no2', 40), 50);
  assert.equal(subIndex('o3', 50), 50);
});

test('sub-index clamps above the top breakpoint rather than extrapolating', () => {
  const extreme = subIndex('pm25', 10000);
  assert.ok(extreme <= 500, `expected <= 500, got ${extreme}`);
});

test('sub-index rejects unknown pollutants and non-numeric input', () => {
  assert.equal(subIndex('lead', 20), null);
  assert.equal(subIndex('pm25', NaN), null);
  assert.equal(subIndex('pm25', undefined), null);
});

test('overall AQI is the maximum sub-index and names the dominant pollutant', () => {
  // pm25 15 → 25; pm10 75 → 75; no2 20 → 25. The worst is pm10.
  const result = computeAqi({ pm25: 15, pm10: 75, no2: 20 });

  assert.equal(result.aqi, 75);
  assert.equal(result.dominant, 'pm10');
  assert.deepEqual(Object.keys(result.subIndices).sort(), ['no2', 'pm10', 'pm25']);
});

test('AQI ignores pollutants it has no breakpoints for', () => {
  const result = computeAqi({ pm25: 15, benzene: 900 });

  assert.equal(result.aqi, 25);
  assert.equal(result.dominant, 'pm25');
  assert.ok(!('benzene' in result.subIndices));
});

test('AQI of an empty reading set is zero with no dominant pollutant', () => {
  const result = computeAqi({});

  assert.equal(result.aqi, 0);
  assert.equal(result.dominant, null);
  assert.deepEqual(result.subIndices, {});
});

test('categories follow the CPCB bands at their boundaries', () => {
  assert.equal(categorise(0).label, 'Good');
  assert.equal(categorise(50).label, 'Good');
  assert.equal(categorise(51).label, 'Satisfactory');
  assert.equal(categorise(100).label, 'Satisfactory');
  assert.equal(categorise(101).label, 'Moderate');
  assert.equal(categorise(200).label, 'Moderate');
  assert.equal(categorise(300).label, 'Poor');
  assert.equal(categorise(400).label, 'Very Poor');
  assert.equal(categorise(500).label, 'Severe');
});

test('categories clamp outside 0–500 instead of returning undefined', () => {
  assert.equal(categorise(-20).label, 'Good');
  assert.equal(categorise(9999).label, 'Severe');
});

test('score inversion anchors each category edge on a round number', () => {
  // The whole of the "Good" band maps to 100; each subsequent CPCB ceiling
  // steps the score down by 20.
  assert.equal(aqiToScore(0), 100);
  assert.equal(aqiToScore(50), 100);
  assert.equal(aqiToScore(100), 80);
  assert.equal(aqiToScore(200), 60);
  assert.equal(aqiToScore(300), 40);
  assert.equal(aqiToScore(400), 20);
  assert.equal(aqiToScore(500), 0);
});

test('score inversion interpolates inside a band', () => {
  // Midway through the "Satisfactory" band [50,100] → [100,80].
  assert.equal(aqiToScore(75), 90);
  // Midway through the "Moderate" band [100,200] → [80,60].
  assert.equal(aqiToScore(150), 70);
});

test('score inversion is monotonically decreasing in AQI', () => {
  let previous = Infinity;
  for (let aqi = 0; aqi <= 500; aqi += 10) {
    const score = aqiToScore(aqi);
    assert.ok(score <= previous, `score rose at AQI ${aqi}: ${score} > ${previous}`);
    assert.ok(score >= 0 && score <= 100, `score out of range at AQI ${aqi}: ${score}`);
    previous = score;
  }
});

test('describeAqi bundles the rounded value, score, label and advice', () => {
  const described = describeAqi(126.4);

  assert.equal(described.aqi, 126);
  assert.equal(described.label, 'Moderate');
  assert.equal(described.score, aqiToScore(126.4));
  assert.ok(described.advice.length > 0);
});

'use strict';

/**
 * Smaller pure functions introduced for the real-data pipeline: Open-Meteo
 * time handling, assistant intent routing, and report interpretation.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.LOG_LEVEL = 'silent';

const { openMeteoInstant } = require('../../src/services/external.service');
const { classifyIntent, tokenise } = require('../../src/services/assistant.service');
const { interpret } = require('../../src/services/report.service');
const { localHour } = require('../../src/services/sensor.service');

test('Open-Meteo local times become UTC instants using the reported offset', () => {
  // Bengaluru is UTC+05:30 (19800 s): 10:00 local is 04:30 UTC.
  assert.equal(openMeteoInstant('2026-09-15T10:00', 19800), '2026-09-15T04:30:00.000Z');
  assert.equal(openMeteoInstant('2026-09-15T10:00', 0), '2026-09-15T10:00:00.000Z');
  assert.equal(openMeteoInstant(null, 19800), null);
  assert.equal(openMeteoInstant('garbage', 0), null);
});

test('diurnal cycles use the parks\' local hour, not the server\'s', () => {
  // 04:30 UTC is 10:00 in Bengaluru.
  assert.equal(localHour(new Date('2026-09-15T04:30:00Z')), 10);
});

test('naming a park does not hijack the question\'s intent', () => {
  const route = (q) => classifyIntent(tokenise(q), q).intent;
  assert.equal(route('How is the air quality at Cubbon Park?'), 'airQuality');
  assert.equal(route('How diverse are the species recorded at Lalbagh?'), 'biodiversity');
  assert.equal(route('Show me the open incidents in Coles Park'), 'incidents');
  assert.equal(route('Tell me about Cubbon Park'), 'parks');
  assert.equal(route('What is the water quality like?'), 'health');
});

const METRICS = {
  ecosystemHealth: 64.2,
  healthGrade: 'moderate',
  subIndices: { airQuality: 48, waterQuality: null, soilHealth: 70, treeHealth: 75, biodiversity: 80 },
  biodiversity: { score: 80, richness: 120, shannon: 3.9, evenness: 0.55, threatenedSpecies: 4, invasiveRecords: 12, richnessInPeriod: 60, recordsInPeriod: 900, topSpecies: [{ commonName: 'Common Myna', records: 80 }] },
  incidents: { total: 10, resolved: 7, resolutionRate: 70, avgResolutionHours: 20.5, critical: 1 },
  citizenReports: { total: 8, accepted: 3, sightings: 2, upvotes: 14 },
  maintenance: { total: 12, completed: 9, overdue: 2, completionRate: 75, actualCost: 42000 },
  aiDetections: { total: 3, reviewed: 1, confirmed: 1 },
  sensors: { aqi: { mean: 112, min: 60, max: 180, readings: 48, anomalies: 1, sources: ['open-meteo'] }, water: null, soil: null, noise: null },
};

test('report findings quote the metrics they are derived from', () => {
  const { findings, recommendations } = interpret('ecosystem', METRICS);
  assert.ok(findings.some((f) => f.includes('64.2/100')));
  assert.ok(findings.some((f) => f.includes('Air quality is the weakest component at 48/100')));
  assert.ok(findings.some((f) => f.includes('120 species')));
  assert.ok(recommendations.some((r) => r.includes('air quality')));
  assert.ok(recommendations.some((r) => r.includes('2 work orders are overdue')));
  assert.ok(recommendations.some((r) => r.includes('invasive')));
});

test('a report with no data says so rather than inventing figures', () => {
  const empty = {
    ...METRICS,
    ecosystemHealth: null,
    subIndices: { airQuality: null, waterQuality: null, soilHealth: null, treeHealth: null, biodiversity: null },
    biodiversity: { ...METRICS.biodiversity, richness: 0, topSpecies: [] },
    sensors: { aqi: null, water: null, soil: null, noise: null },
  };
  const { findings } = interpret('ecosystem', empty);
  assert.ok(findings.some((f) => f.includes('could not be computed')));
  assert.ok(findings.some((f) => f.includes('No verified species observations')));
  assert.ok(interpret('air', empty).findings.some((f) => f.includes('No AQI readings')));
});

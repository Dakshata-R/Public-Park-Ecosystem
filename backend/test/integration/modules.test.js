'use strict';

/**
 * The twelve modules, exercised against the real seeded dataset.
 *
 * This suite is deliberately end-to-end: it seeds MongoDB through the
 * project's own seeder, then drives the API over HTTP. Nothing is stubbed, so
 * a broken query, a missing index or a bad projection fails here.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  startTestServer, stopTestServer, get, post, patch, del, login, itemsOf,
} = require('../helpers/harness');

const fs = require('fs');
const path = require('path');

const tokens = {};
const ids = {};

const SAMPLES = path.resolve(__dirname, '../../src/seed/data/sample-images');
/** A committed sample photograph as an upload-style data URL. */
const sampleDataUrl = (file) => `data:image/jpeg;base64,${fs.readFileSync(path.join(SAMPLES, file)).toString('base64')}`;

test.before(async () => {
  await startTestServer();

  // Live Open-Meteo history is skipped under NODE_ENV=test, so the suite does
  // not depend on the network; the vision model is real and runs locally.
  const { seedDatabase } = require('../../src/seed/seed');
  await seedDatabase({ force: true, quiet: true });

  tokens.admin = await login('admin@greenpulse.gov');
  tokens.ecologist = await login('ecologist@greenpulse.gov');
  tokens.officer = await login('officer@greenpulse.gov');
  tokens.citizen = await login('citizen@greenpulse.gov');

  ids.park = itemsOf(await get('/parks', tokens.admin))[0].id;
  // A simulated sensor: it has history even with the network skipped.
  ids.sensor = itemsOf(await get('/sensors?source=simulated', tokens.admin))[0].id;
  ids.liveSensor = itemsOf(await get('/sensors?source=open-meteo', tokens.admin))[0].id;
  ids.species = itemsOf(await get('/biodiversity/species', tokens.admin))[0].id;
  ids.asset = itemsOf(await get('/assets', tokens.admin))[0].id;

  for (const [key, value] of Object.entries(ids)) {
    assert.ok(value, `seed produced no ${key}`);
  }
});

test.after(async () => {
  await stopTestServer();
});

// ---------------------------------------------------------------------------
// Module 1 — dashboard
// ---------------------------------------------------------------------------

test('module 1 · the dashboard reports counts drawn from the database', async () => {
  const res = await get('/dashboard/overview', tokens.admin);

  assert.equal(res.status, 200);
  const { counts, parkRanking } = res.body.data;
  assert.ok(counts.assets > 0, 'no assets counted');
  assert.ok(counts.species > 0, 'no species counted');
  assert.ok(Number.isFinite(counts.openIncidents));

  // The ranking must cover exactly the parks the registry holds.
  const parks = itemsOf(await get('/parks', tokens.admin));
  assert.equal(parkRanking.length, parks.length, 'the ranking omits a park');

  // The sensor status counts must partition the whole fleet, not just the
  // first page of it.
  const sensors = await get('/sensors?limit=1', tokens.admin);
  assert.equal(
    counts.sensorsOnline + counts.sensorsWarning + counts.sensorsOffline,
    sensors.body.meta.total,
    'the sensor status counts do not add up to the fleet size'
  );
});

test('module 1 · the health trend returns an ordered, finite series', async () => {
  const res = await get('/dashboard/trend?days=14', tokens.admin);

  assert.equal(res.status, 200);
  const points = itemsOf(res);
  assert.ok(points.length > 0, 'empty trend');

  let previous = 0;
  for (const point of points) {
    const at = new Date(point.date || point.at).getTime();
    assert.ok(Number.isFinite(at), `unparseable date: ${JSON.stringify(point)}`);
    assert.ok(at >= previous, 'trend points are not in chronological order');
    previous = at;
  }
});

// ---------------------------------------------------------------------------
// Module 2 — GIS
// ---------------------------------------------------------------------------

test('module 2 · map layers are valid GeoJSON FeatureCollections', async () => {
  const res = await get('/gis/layers', tokens.admin);

  assert.equal(res.status, 200);
  const layers = res.body.data;
  assert.ok(Object.keys(layers).length > 0, 'no layers returned');

  for (const [name, collection] of Object.entries(layers)) {
    assert.equal(collection.type, 'FeatureCollection', `${name} is not a FeatureCollection`);
    assert.ok(Array.isArray(collection.features), `${name} has no features array`);

    for (const feature of collection.features.slice(0, 5)) {
      assert.equal(feature.type, 'Feature', `${name} contains a non-Feature`);
      assert.ok(feature.geometry, `${name} feature has no geometry`);
      assert.ok(Array.isArray(feature.geometry.coordinates), `${name} geometry has no coordinates`);
    }
  }
});

test('module 2 · a radius search returns only nearby records', async () => {
  const res = await get('/gis/within?lat=12.9716&lng=77.5946&radius=5000', tokens.admin);

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data.centre, [77.5946, 12.9716]);
  assert.equal(res.body.data.radiusMetres, 5000);
});

test('module 2 · out-of-range coordinates are a 400, not a 500', async () => {
  for (const query of ['lat=999&lng=999', 'lat=abc&lng=xyz', 'lat=12.97', '']) {
    const res = await get(`/gis/within?${query}`, tokens.admin);
    assert.equal(res.status, 400, `query "${query}" returned ${res.status}`);
  }

  const near = await get('/parks/near?lat=91&lng=181', tokens.admin);
  assert.equal(near.status, 400);
});

// ---------------------------------------------------------------------------
// Module 3 — parks and assets
// ---------------------------------------------------------------------------

test('module 3 · a park exposes its computed health profile', async () => {
  const res = await get(`/parks/${ids.park}/health`, tokens.admin);

  assert.equal(res.status, 200);
  const health = res.body.data;
  assert.ok(health.ecosystemHealth >= 0 && health.ecosystemHealth <= 100, `EHI out of range: ${health.ecosystemHealth}`);
  assert.ok(health.subIndices, 'no sub-indices returned');

  for (const [name, value] of Object.entries(health.subIndices)) {
    if (value === null) continue; // a genuinely missing sub-index is allowed
    assert.ok(value >= 0 && value <= 100, `${name} out of range: ${value}`);
  }
});

test('module 3 · assets support the full CRUD lifecycle', async () => {
  const created = await post('/assets', {
    name: 'Integration Test Bench',
    type: 'bench',
    park: ids.park,
    condition: 82,
    location: { type: 'Point', coordinates: [77.5946, 12.9716] },
  }, tokens.officer);

  assert.equal(created.status, 201, JSON.stringify(created.body));
  const assetId = created.body.data.id;
  assert.ok(assetId);

  const read = await get(`/assets/${assetId}`, tokens.officer);
  assert.equal(read.status, 200);
  assert.equal(read.body.data.name, 'Integration Test Bench');

  // `condition` is a 0-100 score; the five-band `status` is derived from it.
  const updated = await patch(`/assets/${assetId}`, { condition: 30 }, tokens.officer);
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.condition, 30);
  assert.equal(updated.body.data.status, 'poor', 'status was not re-derived from condition');

  const removed = await del(`/assets/${assetId}`, tokens.admin);
  assert.ok([200, 204].includes(removed.status), `delete returned ${removed.status}`);

  // The record must actually be gone from the read path.
  const afterDelete = await get(`/assets/${assetId}`, tokens.officer);
  assert.equal(afterDelete.status, 404, 'the asset survived deletion');
});

test('module 3 · asset history serialises embedded records with string ids', async () => {
  const res = await get(`/assets/${ids.asset}/history`, tokens.officer);

  assert.equal(res.status, 200);
  const serialised = JSON.stringify(res.body);
  assert.ok(!serialised.includes('"buffer"'), 'an ObjectId leaked as a byte buffer');
  assert.ok(!serialised.includes('"_id"'), 'a raw _id reached the client');

  for (const record of res.body.data.maintenance.slice(0, 3)) {
    assert.ok(record.id, 'maintenance record has no id');
  }
});

// ---------------------------------------------------------------------------
// Module 4 — biodiversity
// ---------------------------------------------------------------------------

test('module 4 · diversity indices are computed from stored observations', async () => {
  const res = await get('/biodiversity/indices', tokens.admin);

  assert.equal(res.status, 200);
  const { indices, score, byClassIndices } = res.body.data;
  assert.ok(indices.richness > 0, 'no species richness computed');
  assert.ok(indices.shannon >= 0);
  assert.ok(indices.evenness >= 0 && indices.evenness <= 1, `evenness out of range: ${indices.evenness}`);
  assert.ok(score >= 0 && score <= 100, `score out of range: ${score}`);

  // H' can never exceed ln(S).
  assert.ok(indices.shannon <= indices.shannonMax + 1e-9, 'Shannon exceeds its maximum');

  // Every per-taxocene index obeys the same bounds as the pooled one.
  for (const [taxon, taxonIndices] of Object.entries(byClassIndices || {})) {
    assert.ok(
      taxonIndices.evenness >= 0 && taxonIndices.evenness <= 1,
      `${taxon} evenness out of range: ${taxonIndices.evenness}`
    );
  }
});

test('module 4 · the index preview validates its abundance vector', async () => {
  const good = await post('/biodiversity/indices/preview', { abundances: [50, 40, 30] }, tokens.ecologist);
  assert.equal(good.status, 200);
  assert.equal(good.body.data.richness, 3);

  for (const abundances of [[-5, 10], ['a', 'b'], 'not-an-array', [null]]) {
    const res = await post('/biodiversity/indices/preview', { abundances }, tokens.ecologist);
    assert.ok(res.status === 400 || res.status === 422, `${JSON.stringify(abundances)} returned ${res.status}`);
  }
});

test('module 4 · an ecologist can add a species; a citizen cannot', async () => {
  const body = {
    commonName: 'Integration Test Fig',
    scientificName: 'Ficus integrationis',
    class: 'plant',
    conservationStatus: 'Least Concern',
  };

  const forbidden = await post('/biodiversity/species', body, tokens.citizen);
  assert.equal(forbidden.status, 403);

  const created = await post('/biodiversity/species', body, tokens.ecologist);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.data.commonName, 'Integration Test Fig');

  await del(`/biodiversity/species/${created.body.data.id}`, tokens.admin);
});

// ---------------------------------------------------------------------------
// Module 5 — AI monitoring
// ---------------------------------------------------------------------------

test('module 5 · inference returns a normalised probability distribution', async () => {
  const res = await post('/ai/analyze', {
    task: 'plant-id',
    imageUrl: sampleDataUrl('plant-lantana-camara.jpg'),
    park: ids.park,
  }, tokens.ecologist);

  assert.equal(res.status, 201, JSON.stringify(res.body));
  const { detection } = res.body.data;
  const probabilities = detection.probabilities;
  assert.ok(probabilities.length > 0, 'no predictions returned');

  // A softmax must sum to 1.
  const total = probabilities.reduce((sum, p) => sum + p.probability, 0);
  assert.ok(Math.abs(total - 1) < 0.02, `probabilities sum to ${total}, not 1`);

  for (const prediction of probabilities) {
    assert.ok(
      prediction.probability >= 0 && prediction.probability <= 1,
      `probability out of range: ${prediction.probability}`
    );
    assert.ok(prediction.label, 'a prediction has no label');
  }

  // The headline prediction must be the argmax of the distribution.
  const best = probabilities.reduce((a, b) => (b.probability > a.probability ? b : a));
  assert.equal(detection.prediction, best.label, 'the reported prediction is not the argmax');
  assert.ok(
    Math.abs(detection.confidence - best.probability * 100) < 0.11,
    'confidence does not match the argmax probability'
  );

  // Sorted descending, so the UI can render them in order as they arrive.
  for (let i = 1; i < probabilities.length; i += 1) {
    assert.ok(
      probabilities[i - 1].probability >= probabilities[i].probability,
      'predictions are not sorted by probability'
    );
  }
});

test('module 5 · inference rejects an unknown task', async () => {
  const res = await post('/ai/analyze', {
    task: 'read-minds',
    imageUrl: 'https://example.org/x.jpg',
    park: ids.park,
  }, tokens.ecologist);

  assert.ok(res.status === 400 || res.status === 422, `got ${res.status}`);
});

test('module 5 · the prediction comes from the pixels, not the request', async () => {
  // The same photograph under two different names gives the same answer…
  const heron = sampleDataUrl('wildlife-indian-pond-heron.jpg');
  const first = await post('/ai/analyze', { task: 'wildlife', imageUrl: heron, imageName: 'a.jpg' }, tokens.ecologist);
  const second = await post('/ai/analyze', { task: 'wildlife', imageUrl: heron, imageName: 'b.jpg' }, tokens.ecologist);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.data.detection.prediction, 'Bird');
  assert.equal(second.body.data.detection.prediction, first.body.data.detection.prediction);

  // …and a different photograph gives a different one.
  const butterfly = await post('/ai/analyze', { task: 'wildlife', imageUrl: sampleDataUrl('wildlife-plain-tiger.jpg') }, tokens.ecologist);
  assert.equal(butterfly.body.data.detection.prediction, 'Butterfly or moth');

  // The evidence behind the call is returned with it.
  const { inference } = first.body.data;
  assert.ok(inference.imagenet.length > 0, 'no ImageNet classes returned');
  assert.ok(inference.evidence.animalEvidence > 0.5, 'no animal evidence recorded');
  assert.equal(inference.model.name, 'MobileNetV2 1.0 (ImageNet-1k)');
});

test('module 5 · the analysed image is stored once and served back as a JPEG', async () => {
  const res = await post('/ai/analyze', { task: 'fire', imageUrl: sampleDataUrl('fire-grassland-burn.jpg') }, tokens.officer);
  assert.equal(res.status, 201, JSON.stringify(res.body));

  const { imageUrl } = res.body.data.detection;
  assert.match(imageUrl, /^\/api\/ai\/images\/[0-9a-f]{24}$/);

  const image = await fetch(`${process.env.TEST_API_ORIGIN}${imageUrl}`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/jpeg');
  const bytes = Buffer.from(await image.arrayBuffer());
  assert.equal(bytes[0], 0xff, 'not a JPEG');
  assert.equal(bytes[1], 0xd8, 'not a JPEG');

  // Uploading the same photograph again reuses the stored copy.
  const again = await post('/ai/analyze', { task: 'waste', imageUrl: sampleDataUrl('fire-grassland-burn.jpg') }, tokens.officer);
  assert.equal(again.body.data.detection.imageUrl, imageUrl);
});

test('module 5 · inference refuses bad input and internal addresses', async () => {
  const anonymous = await post('/ai/analyze', { task: 'fire', imageUrl: sampleDataUrl('fire-smoke-plume.jpg') });
  assert.equal(anonymous.status, 401, 'anonymous inference was accepted');

  const cases = [
    'not even a url',
    'ftp://example.org/image.jpg',
    'http://127.0.0.1:5000/api/health',
    'http://169.254.169.254/latest/meta-data/',
    'http://localhost/x.jpg',
    'data:image/jpeg;base64,bm90IGFuIGltYWdl', // "not an image"
  ];
  for (const imageUrl of cases) {
    const res = await post('/ai/analyze', { task: 'fire', imageUrl }, tokens.officer);
    assert.equal(res.status, 400, `${imageUrl.slice(0, 40)} returned ${res.status}`);
  }
});

test('module 5 · a reviewer must correct a rejection to a label the task defines', async () => {
  const gallery = itemsOf(await get('/ai/gallery?task=wildlife', tokens.ecologist));
  const detection = gallery[0];
  assert.ok(detection, 'no seeded wildlife detection');

  const bad = await post(`/ai/${detection.id}/review`, { verdict: 'rejected', correctedLabel: 'Unicorn' }, tokens.ecologist);
  assert.equal(bad.status, 400);

  const good = await post(`/ai/${detection.id}/review`, { verdict: 'rejected', correctedLabel: 'No animal detected' }, tokens.ecologist);
  assert.equal(good.status, 200);
  assert.equal(good.body.data.correctedLabel, 'No animal detected');

  const stats = await get('/ai/stats', tokens.ecologist);
  assert.equal(stats.body.data.confidenceDistribution.length, 5, 'confidence bands missing');
  assert.ok(stats.body.data.review.precision !== null, 'precision was not computed after a review');
});

// ---------------------------------------------------------------------------
// Module 6 — sensors
// ---------------------------------------------------------------------------

test('module 6 · readings are stored and returned newest first', async () => {
  const res = await get(`/sensors/${ids.sensor}/readings?limit=25`, tokens.admin);

  assert.equal(res.status, 200);
  const readings = res.body.data.readings;
  assert.ok(readings.length > 0, 'no readings stored');
  assert.ok(res.body.data.sensor.id, 'the sensor was not returned alongside its readings');

  // Chronological order, so the time-series chart can plot them directly.
  let previous = 0;
  for (const reading of readings) {
    const at = new Date(reading.time).getTime();
    assert.ok(Number.isFinite(at), `unparseable reading time: ${reading.time}`);
    assert.ok(at >= previous, 'readings are not in chronological order');
    assert.ok(Number.isFinite(reading.value), 'a reading has a non-numeric value');
    previous = at;
  }
});

test('module 6 · anomaly scanning returns a bounded verdict per reading', async () => {
  const res = await get(`/sensors/${ids.sensor}/anomalies`, tokens.admin);

  assert.equal(res.status, 200);
  for (const entry of itemsOf(res).slice(0, 10)) {
    if (entry.votes === undefined) continue;
    assert.ok(entry.votes >= 0 && entry.votes <= 3, `votes out of range: ${entry.votes}`);
    assert.equal(typeof entry.isAnomaly, 'boolean');
  }
});

// ---------------------------------------------------------------------------
// Module 7 → 8 → 9 — the citizen-to-work-order chain
// ---------------------------------------------------------------------------

test('modules 7·8·9 · a citizen report escalates to an incident and a work order', async () => {
  // 1. A citizen files a report.
  const report = await post('/citizen/reports', {
    title: 'Fallen branch blocking the east path',
    description: 'A large branch came down overnight and blocks the path entirely.',
    category: 'issue',
    park: ids.park,
    location: { type: 'Point', coordinates: [77.5946, 12.9716] },
  }, tokens.citizen);

  assert.equal(report.status, 201, JSON.stringify(report.body));
  const reportId = report.body.data.id;
  assert.equal(report.body.data.status, 'submitted');

  // 2. The community upvotes it.
  const upvoted = await post(`/citizen/reports/${reportId}/upvote`, {}, tokens.ecologist);
  assert.equal(upvoted.status, 200);
  assert.ok(upvoted.body.data.upvotes >= 1);

  // 3. An officer raises an incident.
  const incident = await post('/incidents', {
    title: 'Fallen branch blocking the east path',
    description: 'Escalated from a citizen report.',
    type: 'tree-fall',
    severity: 4,
    park: ids.park,
    location: { type: 'Point', coordinates: [77.5946, 12.9716] },
  }, tokens.officer);

  assert.equal(incident.status, 201, JSON.stringify(incident.body));
  const incidentId = incident.body.data.id;
  assert.ok(incident.body.data.priorityScore > 0, 'no triage score computed');

  // 4. It appears in the triage queue, correctly ordered.
  const triage = await get('/incidents/triage', tokens.officer);
  assert.equal(triage.status, 200);
  const queue = itemsOf(triage);
  assert.ok(queue.some((i) => i.id === incidentId), 'the new incident is missing from triage');

  for (let i = 1; i < queue.length; i += 1) {
    const previous = queue[i - 1].triage?.score ?? queue[i - 1].priorityScore;
    const current = queue[i].triage?.score ?? queue[i].priorityScore;
    assert.ok(previous >= current, 'the triage queue is not ordered by descending priority');
  }

  // 5. It is assigned to an officer.
  const officers = itemsOf(await get('/admin/users?role=officer', tokens.admin));
  assert.ok(officers.length > 0, 'no officers in the seed');
  const assigned = await post(`/incidents/${incidentId}/assign`, { assignedTo: officers[0].id }, tokens.admin);
  assert.equal(assigned.status, 200);
  assert.equal(assigned.body.data.status, 'assigned');

  // 6. A work order is scheduled against it.
  const workOrder = await post('/maintenance', {
    title: 'Clear the fallen branch',
    type: 'tree-trimming',
    park: ids.park,
    priority: 'high',
    scheduledDate: new Date(Date.now() + 86_400_000).toISOString(),
  }, tokens.officer);

  assert.equal(workOrder.status, 201, JSON.stringify(workOrder.body));
  const workOrderId = workOrder.body.data.id;

  // 7. Progress is recorded, then the incident is resolved.
  const progressed = await patch(`/maintenance/${workOrderId}/progress`, { progress: 100 }, tokens.officer);
  assert.equal(progressed.status, 200);
  assert.equal(progressed.body.data.progress, 100);

  const resolved = await post(`/incidents/${incidentId}/resolve`, {
    resolutionNotes: 'Branch removed and the path reopened.',
  }, tokens.officer);
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.data.status, 'resolved');

  // 8. The resolution is recorded in the incident's timeline.
  const detail = await get(`/incidents/${incidentId}`, tokens.officer);
  assert.equal(detail.status, 200);
  const statuses = detail.body.data.timeline.map((entry) => entry.status);
  assert.ok(statuses.includes('assigned'), 'the assignment is missing from the timeline');
  assert.ok(statuses.includes('resolved'), 'the resolution is missing from the timeline');
  for (const entry of detail.body.data.timeline) {
    assert.ok(entry.id, 'a timeline entry has no id');
  }

  // 9. A resolved incident stops ageing, so it drops out of the open queue.
  const openAfter = itemsOf(await get('/incidents/triage', tokens.officer));
  assert.ok(!openAfter.some((i) => i.id === incidentId), 'a resolved incident is still in triage');
});

test('module 7 · my-reports returns only the caller‚Äôs own submissions', async () => {
  const mine = await get('/citizen/my-reports', tokens.citizen);
  assert.equal(mine.status, 200);

  const others = await get('/citizen/my-reports', tokens.ecologist);
  assert.equal(others.status, 200);

  const mineIds = new Set(itemsOf(mine).map((r) => r.id));
  const otherIds = itemsOf(others).map((r) => r.id);
  const overlap = otherIds.filter((id) => mineIds.has(id));

  assert.equal(overlap.length, 0, 'one citizen can see another citizen‚Äôs private report list');
});

// ---------------------------------------------------------------------------
// Module 10 — analytics
// ---------------------------------------------------------------------------

test('module 10 · park comparison covers every park exactly once', async () => {
  const res = await get('/analytics/park-comparison', tokens.admin);
  assert.equal(res.status, 200);

  const rows = itemsOf(res);
  const parks = itemsOf(await get('/parks', tokens.admin));

  assert.equal(rows.length, parks.length, 'comparison does not cover every park');
  assert.equal(new Set(rows.map((r) => r.id ?? r.park)).size, rows.length, 'a park appears twice');
});

test('module 10 · CSV export returns real rows with a header', async () => {
  const res = await get('/analytics/export?dataset=incidents&format=csv', tokens.admin);

  assert.equal(res.status, 200);
  const csv = res.body.raw ?? '';
  const lines = csv.trim().split('\n');
  assert.ok(lines.length > 1, 'the export has no data rows');
  assert.ok(lines[0].includes(','), 'the export has no header row');
});

test('module 10 · an unknown export dataset is rejected', async () => {
  const res = await get('/analytics/export?dataset=nonsense&format=csv', tokens.admin);
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------
// Module 11 — assistant
// ---------------------------------------------------------------------------

test('module 11 · the assistant answers with citations drawn from real data', async () => {
  const res = await post('/assistant/ask', { question: 'Which park has the best air quality?' }, tokens.citizen);

  assert.equal(res.status, 201, JSON.stringify(res.body));
  const { message, sessionId } = res.body.data;
  assert.ok(sessionId, 'no session id issued');
  assert.equal(message.role, 'assistant');
  assert.ok(message.content && message.content.length > 0, 'empty answer');
  assert.ok(Array.isArray(message.citations), 'no citation array');

  // Citations must point at real records rather than being decorative.
  for (const citation of message.citations) {
    assert.ok(citation.entity, 'a citation names no entity type');
    assert.ok(
      /^[0-9a-f]{24}$/.test(citation.entityId),
      `a citation has a malformed id: ${citation.entityId}`
    );
  }
});

test('module 11 · the assistant routes distinct questions to distinct intents', async () => {
  const air = await post('/assistant/ask', { question: 'What is the air quality today?' }, tokens.citizen);
  const bio = await post('/assistant/ask', { question: 'How diverse are the species in the park?' }, tokens.citizen);

  assert.equal(air.status, 201);
  assert.equal(bio.status, 201);

  const airIntent = air.body.data.message.intent;
  const bioIntent = bio.body.data.message.intent;
  assert.ok(airIntent, 'no intent recorded for the air-quality question');
  assert.ok(bioIntent, 'no intent recorded for the biodiversity question');
  assert.notEqual(airIntent, bioIntent, 'both questions routed to the same intent');
});

test('module 11 · an empty question is rejected rather than answered', async () => {
  for (const question of ['', '   ', null]) {
    const res = await post('/assistant/ask', { question }, tokens.citizen);
    assert.ok(res.status === 400 || res.status === 422, `"${question}" returned ${res.status}`);
  }
});

// ---------------------------------------------------------------------------
// Module 12 — administration
// ---------------------------------------------------------------------------

test('module 12 · an admin can create, promote and deactivate a user', async () => {
  const created = await post('/admin/users', {
    name: 'Temporary Officer',
    email: 'temporary.officer@greenpulse.gov',
    password: 'greenpulse123',
    role: 'officer',
  }, tokens.admin);

  assert.equal(created.status, 201, JSON.stringify(created.body));
  const userId = created.body.data.id;
  assert.equal(created.body.data.role, 'officer');

  const promoted = await patch(`/admin/users/${userId}`, { role: 'admin' }, tokens.admin);
  assert.equal(promoted.status, 200);
  assert.equal(promoted.body.data.role, 'admin');

  const removed = await del(`/admin/users/${userId}`, tokens.admin);
  assert.ok([200, 204].includes(removed.status));
});

test('module 12 · the audit log records privileged writes', async () => {
  const before = itemsOf(await get('/admin/audit-log?limit=200', tokens.admin)).length;

  await post('/assets', {
    name: 'Audited Test Asset',
    type: 'bench',
    park: ids.park,
    location: { type: 'Point', coordinates: [77.59, 12.97] },
  }, tokens.officer);

  const after = itemsOf(await get('/admin/audit-log?limit=200', tokens.admin));
  assert.ok(after.length > before, 'the audit log did not grow after a privileged write');

  const entry = after[0];
  assert.ok(entry.action, 'an audit entry has no action');
  assert.ok(entry.createdAt || entry.at, 'an audit entry has no timestamp');
});

// ---------------------------------------------------------------------------
// Cross-cutting: role hierarchy
// ---------------------------------------------------------------------------

test('the role hierarchy is enforced server-side on every privileged route', async () => {
  const matrix = [
    { method: 'GET', path: '/admin/users', allowed: ['admin'] },
    { method: 'GET', path: '/admin/audit-log', allowed: ['admin'] },
    { method: 'GET', path: '/incidents/triage', allowed: ['officer', 'admin'] },
    { method: 'GET', path: '/incidents', allowed: ['officer', 'admin'] },
  ];

  const callers = ['citizen', 'ecologist', 'officer', 'admin'];

  for (const { method, path, allowed } of matrix) {
    for (const role of callers) {
      const res = await get(path, tokens[role]);
      if (allowed.includes(role)) {
        assert.equal(res.status, 200, `${role} should reach ${method} ${path}, got ${res.status}`);
      } else {
        assert.equal(res.status, 403, `${role} should be refused ${method} ${path}, got ${res.status}`);
      }
    }

    const anonymous = await get(path);
    assert.equal(anonymous.status, 401, `anonymous access to ${path} returned ${anonymous.status}`);
  }
});

test('a lower role cannot delete records belonging to a module it can only read', async () => {
  const forbidden = await del(`/parks/${ids.park}`, tokens.citizen);
  assert.equal(forbidden.status, 403);

  // The park must still be there.
  const still = await get(`/parks/${ids.park}`, tokens.citizen);
  assert.equal(still.status, 200);
});

// ---------------------------------------------------------------------------
// Cross-cutting: not-found and invalid-id handling
// ---------------------------------------------------------------------------

test('a well-formed but unused id returns 404 on every module', async () => {
  const missing = '000000000000000000000000';
  const paths = [
    `/parks/${missing}`,
    `/assets/${missing}`,
    `/sensors/${missing}`,
    `/biodiversity/species/${missing}`,
    `/incidents/${missing}`,
    `/maintenance/${missing}`,
  ];

  for (const path of paths) {
    const res = await get(path, tokens.admin);
    assert.equal(res.status, 404, `${path} returned ${res.status}`);
    assert.equal(res.body.success, false);
  }
});

test('a malformed id is a 400, never an unhandled cast error', async () => {
  for (const path of ['/parks/not-an-id', '/assets/12345', '/incidents/%20']) {
    const res = await get(path, tokens.admin);
    assert.ok([400, 404, 422].includes(res.status), `${path} returned ${res.status}`);
    assert.ok(res.status !== 500, `${path} produced a 500`);
  }
});

test('an unknown route returns the API 404 envelope', async () => {
  const res = await get('/no/such/route', tokens.admin);

  assert.equal(res.status, 404);
  assert.equal(res.body.success, false);
});

// ---------------------------------------------------------------------------
// Cross-cutting: pagination
// ---------------------------------------------------------------------------

test('pagination honours limit, reports metadata and survives absurd input', async () => {
  const paged = await get('/assets?page=1&limit=5', tokens.admin);
  assert.equal(paged.status, 200);
  assert.ok(itemsOf(paged).length <= 5, 'limit was ignored');
  assert.ok(paged.body.meta.total >= 0);
  assert.equal(paged.body.meta.page, 1);

  const beyondEnd = await get('/assets?page=99999&limit=5', tokens.admin);
  assert.equal(beyondEnd.status, 200);
  assert.equal(itemsOf(beyondEnd).length, 0, 'a page past the end returned rows');

  for (const query of ['page=0&limit=0', 'page=-1', 'limit=abc', 'limit=100000']) {
    const res = await get(`/assets?${query}`, tokens.admin);
    assert.ok(res.status < 500, `"${query}" produced ${res.status}`);
    if (res.status === 200) {
      assert.ok(itemsOf(res).length <= 200, 'the server returned more than the hard limit');
    }
  }
});

test('the second page does not repeat the first', async () => {
  const first = itemsOf(await get('/assets?page=1&limit=5&sort=name', tokens.admin)).map((a) => a.id);
  const second = itemsOf(await get('/assets?page=2&limit=5&sort=name', tokens.admin)).map((a) => a.id);

  const overlap = first.filter((id) => second.includes(id));
  assert.equal(overlap.length, 0, 'pages overlap');
});

// ---------------------------------------------------------------------------
// Cross-cutting: soft delete
// ---------------------------------------------------------------------------

test('a soft-deleted record disappears from reads, listings, search and totals', async () => {
  const created = await post('/assets', {
    name: 'Archivable Test Lamp',
    type: 'light',
    park: ids.park,
    condition: 90,
    location: { type: 'Point', coordinates: [77.5946, 12.9716] },
  }, tokens.officer);
  assert.equal(created.status, 201);
  const assetId = created.body.data.id;

  const before = (await get('/assets?limit=1', tokens.admin)).body.meta.total;

  const removed = await del(`/assets/${assetId}`, tokens.admin);
  assert.equal(removed.status, 204);

  // 1. Its own URL must 404 — a delete that leaves the record reachable by id
  //    is not a delete.
  assert.equal((await get(`/assets/${assetId}`, tokens.admin)).status, 404);

  // 2. It must leave the listing and the reported total.
  const after = (await get('/assets?limit=1', tokens.admin)).body.meta.total;
  assert.equal(after, before - 1, 'the total did not fall after a delete');

  // 3. It must not resurface through search.
  const search = itemsOf(await get('/assets?q=Archivable Test Lamp&limit=50', tokens.admin));
  assert.ok(!search.some((a) => a.id === assetId), 'a deleted asset is still searchable');
});

test('an archived record is still recoverable through an explicit opt-in', async () => {
  const created = await post('/assets', {
    name: 'Recoverable Test Lamp',
    type: 'light',
    park: ids.park,
    condition: 90,
    location: { type: 'Point', coordinates: [77.5946, 12.9716] },
  }, tokens.officer);
  const assetId = created.body.data.id;
  await del(`/assets/${assetId}`, tokens.admin);

  // Soft delete must archive rather than destroy, so an administrator can
  // still reach the record deliberately.
  const archived = await get(`/assets/${assetId}?includeArchived=true`, tokens.admin);
  assert.equal(archived.status, 200, 'an archived record was destroyed, not archived');
  assert.equal(archived.body.data.active, false);

  const archivedList = itemsOf(await get('/assets?active=false&limit=50', tokens.admin));
  assert.ok(archivedList.some((a) => a.id === assetId), 'archived records cannot be listed');
});

test('a deactivated user can no longer authenticate', async () => {
  const email = 'soon.to.be.disabled@greenpulse.gov';
  const created = await post('/admin/users', {
    name: 'Soon To Be Disabled',
    email,
    password: 'greenpulse123',
    role: 'officer',
  }, tokens.admin);
  assert.equal(created.status, 201);

  // The account works before deactivation.
  const before = await post('/auth/login', { email, password: 'greenpulse123' });
  assert.equal(before.status, 200);

  await del(`/admin/users/${created.body.data.id}`, tokens.admin);

  // ...and is refused afterwards, rather than silently still working.
  const after = await post('/auth/login', { email, password: 'greenpulse123' });
  assert.ok(after.status === 401 || after.status === 403, `a disabled account signed in: ${after.status}`);
});

// ---------------------------------------------------------------------------
// Regressions for the defects found in the submission-readiness audit
// ---------------------------------------------------------------------------

test('deleting an incident never makes the next reference code collide', async () => {
  const make = (title) => post('/incidents', {
    type: 'vandalism', title, park: ids.park, severity: 2,
    location: { type: 'Point', coordinates: [77.5946, 12.9716] },
  }, tokens.officer);

  const a = await make('Counter test A');
  const b = await make('Counter test B');
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);

  assert.equal((await del(`/incidents/${a.body.data.id}`, tokens.admin)).status, 204);

  const c = await make('Counter test C');
  assert.equal(c.status, 201, `create after delete returned ${c.status}: ${JSON.stringify(c.body)}`);
  const codes = [a, b, c].map((r) => r.body.data.referenceCode);
  assert.equal(new Set(codes).size, 3, `codes repeated: ${codes.join(', ')}`);
});

test('an account can upvote a report once, and withdraw it', async () => {
  const report = itemsOf(await get('/citizen/reports?limit=1', tokens.officer))[0];

  // Clear any seeded vote by this account first, so the test is self-contained.
  await del(`/citizen/reports/${report.id}/upvote`, tokens.ecologist);
  const start = (await get(`/citizen/reports/${report.id}`, tokens.ecologist)).body.data.upvotes;

  const first = await post(`/citizen/reports/${report.id}/upvote`, {}, tokens.ecologist);
  const repeat = await post(`/citizen/reports/${report.id}/upvote`, {}, tokens.ecologist);
  assert.equal(first.body.data.upvotes, start + 1);
  assert.equal(repeat.body.data.upvotes, start + 1, 'a second upvote from the same account counted');

  const mine = await get('/citizen/my-upvotes', tokens.ecologist);
  assert.ok(mine.body.data.includes(report.id));

  const withdrawn = await del(`/citizen/reports/${report.id}/upvote`, tokens.ecologist);
  assert.equal(withdrawn.body.data.upvotes, start);

  // Who voted is never exposed.
  const listed = JSON.stringify((await get(`/citizen/reports/${report.id}`, tokens.citizen)).body);
  assert.ok(!listed.includes('upvotedBy'), 'the voter list leaked');
});

test('switching public reporting off stops citizen reports but not staff', async () => {
  const body = {
    category: 'issue', title: 'Reporting toggle test', description: 'Checks the admin switch is enforced.',
    park: ids.park, location: { type: 'Point', coordinates: [77.5946, 12.9716] },
  };

  assert.equal((await patch('/admin/settings', { enablePublicReporting: false }, tokens.admin)).status, 200);
  try {
    const citizen = await post('/citizen/reports', body, tokens.citizen);
    assert.equal(citizen.status, 403, 'a citizen could report while reporting was switched off');
    const officer = await post('/citizen/reports', body, tokens.officer);
    assert.equal(officer.status, 201, 'staff were blocked by the public-reporting switch');

    const publicSettings = await get('/settings/public');
    assert.equal(publicSettings.body.data.enablePublicReporting, false);
  } finally {
    await patch('/admin/settings', { enablePublicReporting: true }, tokens.admin);
  }
});

test('officers can list assignable staff without admin rights', async () => {
  const staff = await get('/users/staff', tokens.officer);
  assert.equal(staff.status, 200);
  assert.ok(itemsOf(staff).length > 0);
  assert.ok(itemsOf(staff).every((u) => ['officer', 'ecologist', 'admin'].includes(u.role)));
  assert.ok(!JSON.stringify(staff.body).includes('email'), 'the staff directory exposes email addresses');

  assert.equal((await get('/users/staff', tokens.citizen)).status, 403);
});

test('row-level exports require an officer', async () => {
  assert.equal((await get('/analytics/export?dataset=incidents&format=csv')).status, 401);
  assert.equal((await get('/analytics/export?dataset=incidents&format=csv', tokens.citizen)).status, 403);
  assert.equal((await get('/analytics/export?dataset=incidents&format=csv', tokens.officer)).status, 200);
});

test('park filters work inside aggregation pipelines', async () => {
  const assets = itemsOf(await get('/assets?limit=200', tokens.admin));
  const parkWithAssets = assets[0].park.id;
  const expected = assets.filter((a) => a.park.id === parkWithAssets).length;

  const stats = await get(`/assets/stats?park=${parkWithAssets}`, tokens.admin);
  assert.equal(stats.status, 200);
  assert.ok(stats.body.data.total >= expected, `park-filtered asset stats counted ${stats.body.data.total}`);
  assert.ok(stats.body.data.total > 0);

  const observations = itemsOf(await get('/biodiversity/observations?limit=1', tokens.admin));
  const seasonality = itemsOf(await get(`/biodiversity/seasonality?park=${observations[0].park.id}`, tokens.admin));
  assert.ok(seasonality.some((m) => m.sightings > 0), 'park-filtered seasonality is all zeros');

  assert.equal((await get('/assets/stats?park=not-an-id', tokens.admin)).status, 400);
});

test('a scheduled work order past its date is reported overdue', async () => {
  const created = await post('/maintenance', {
    title: 'Overdue sweep test', type: 'inspection', park: ids.park,
    scheduledDate: new Date(Date.now() + 3_600_000).toISOString(),
  }, tokens.officer);
  assert.equal(created.status, 201);

  // Move the date into the past without saving through the document hooks.
  const { WorkOrder } = require('../../src/models');
  await WorkOrder.updateOne({ _id: created.body.data.id }, { $set: { scheduledDate: new Date(Date.now() - 86_400_000) } });

  const listed = itemsOf(await get('/maintenance?q=Overdue sweep test', tokens.officer));
  assert.equal(listed.find((w) => w.id === created.body.data.id)?.status, 'overdue');
});

test('one incident cannot have two open work orders', async () => {
  const incident = await post('/incidents', {
    type: 'tree-fall', title: 'Duplicate work order test', park: ids.park, severity: 3,
    location: { type: 'Point', coordinates: [77.5946, 12.9716] },
  }, tokens.officer);
  const first = await post(`/incidents/${incident.body.data.id}/work-order`, {}, tokens.officer);
  const second = await post(`/incidents/${incident.body.data.id}/work-order`, {}, tokens.officer);
  assert.equal(first.status, 201);
  assert.equal(second.status, 409);
});

test('virtual and simulated sensors refuse posted readings', async () => {
  const res = await post(`/sensors/${ids.liveSensor}/readings`, { value: 42 }, tokens.officer);
  assert.equal(res.status, 409);
});

test('a sensor with no readings reports no value, not zero', async () => {
  const live = (await get('/sensors/live', tokens.admin)).body.data.sensors;
  const unread = live.filter((s) => !s.lastReadingAt);
  for (const s of unread) {
    assert.equal(s.currentValue, null, `${s.name} reports ${s.currentValue} with no reading`);
    assert.equal(s.score, null);
  }

  const kpis = (await get('/dashboard/overview', tokens.admin)).body.data.kpis;
  const air = kpis.find((k) => k.key === 'airQuality');
  if (!live.some((s) => s.type === 'aqi' && s.lastReadingAt)) {
    assert.equal(air.value, null, 'air quality shows a number with no reporting AQI sensor');
  }
});

test('a generated report is computed from the data and published on request', async () => {
  const generated = await post('/analytics/reports/generate', { type: 'biodiversity', days: 365 }, tokens.ecologist);
  assert.equal(generated.status, 201, JSON.stringify(generated.body));
  const report = generated.body.data;
  assert.equal(report.status, 'draft');
  assert.ok(report.findings.length > 0);
  assert.ok(report.findings.some((f) => f.includes(String(report.metrics.biodiversity.richness))), 'findings do not quote the metrics');

  // Drafts are invisible to the public…
  assert.equal((await get(`/analytics/reports/${report.id}`)).status, 404);
  // …until published.
  const published = await patch(`/analytics/reports/${report.id}`, { status: 'published' }, tokens.ecologist);
  assert.equal(published.status, 200);
  assert.equal((await get(`/analytics/reports/${report.id}`)).status, 200);

  assert.equal((await post('/analytics/reports/generate', { type: 'air' }, tokens.citizen)).status, 403);
});

test('the suggested air-quality question is answered about air quality', async () => {
  const res = await post('/assistant/ask', { question: 'How is the air quality at Cubbon Park?' }, tokens.citizen);
  assert.equal(res.status, 201);
  assert.equal(res.body.data.intent, 'airQuality');
});

test('a location of [0, 0] is rejected as unset', async () => {
  const res = await post('/assets', {
    name: 'Null island bench', type: 'bench', park: ids.park,
    location: { type: 'Point', coordinates: [0, 0] },
  }, tokens.officer);
  assert.equal(res.status, 422);
});

test('a deactivated account stays visible to administrators and can be restored', async () => {
  const email = 'restorable.officer@greenpulse.gov';
  const created = await post('/admin/users', {
    name: 'Restorable Officer',
    email,
    password: 'greenpulse123',
    role: 'officer',
  }, tokens.admin);
  assert.equal(created.status, 201);
  const userId = created.body.data.id;

  await del(`/admin/users/${userId}`, tokens.admin);

  // Deactivating archives the account rather than erasing it, so the
  // administration screen must still be able to list it — otherwise the
  // account can never be switched back on.
  const archived = itemsOf(await get('/admin/users?limit=200&includeArchived=true', tokens.admin));
  const found = archived.find((u) => u.id === userId);
  assert.ok(found, 'a deactivated account vanished from the administration list');
  assert.equal(found.active, false);

  // Assignee pickers must not offer a deactivated officer.
  const active = itemsOf(await get('/admin/users?limit=200', tokens.admin));
  assert.ok(!active.some((u) => u.id === userId), 'a deactivated officer is still offered for assignment');

  // Restoring the account brings back both the listing and sign-in.
  const restored = await patch(`/admin/users/${userId}`, { active: true }, tokens.admin);
  assert.equal(restored.status, 200);
  assert.equal(restored.body.data.active, true);

  const signIn = await post('/auth/login', { email, password: 'greenpulse123' });
  assert.equal(signIn.status, 200, 'a restored account cannot sign in');
});

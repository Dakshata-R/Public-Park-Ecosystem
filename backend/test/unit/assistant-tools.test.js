'use strict';

/**
 * The Eco Assistant's data tools and the built-in engine's new intents,
 * against an in-memory MongoDB with a small hand-built dataset. The live
 * weather service is stubbed, so the suite needs no network.
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const models = require('../../src/models');
const external = require('../../src/services/external.service');
const tools = require('../../src/services/assistant-tools.service');
const assistant = require('../../src/services/assistant.service');

const { Park, User, WorkOrder, Incident, CitizenReport, Observation, AiDetection, Sensor, Species } = models;

let memory;
const users = {};
const parks = {};
const ctx = {};
const realWeather = external.getWeather;
const realAir = external.getAirQuality;

const pt = (lng, lat) => ({ type: 'Point', coordinates: [lng, lat] });
const DAY = 86_400_000;

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());

  external.getWeather = async () => ({
    ok: true,
    current: {
      condition: 'Partly cloudy', temperature: 27.4, feelsLike: 29.1, humidity: 64, windSpeed: 9.2,
      precipitation: 0, cloudCover: 40, uvIndexMax: 8.5, observedAt: new Date('2026-10-29T05:00:00Z').toISOString(),
    },
  });
  external.getAirQuality = async () => ({
    ok: true, aqi: 84, label: 'Satisfactory', dominantPollutant: 'PM2.5', advice: 'Air quality is acceptable.',
    observedAt: new Date('2026-10-29T05:00:00Z').toISOString(),
  });

  const [cubbon, lalbagh, jp] = await Park.create([
    { name: 'Cubbon Park', slug: 'cubbon-park', location: pt(77.5926, 12.9763), areaAcres: 300 },
    { name: 'Lalbagh Botanical Garden', slug: 'lalbagh-botanical-garden', location: pt(77.5848, 12.9507), areaAcres: 240 },
    { name: 'JP Park', slug: 'jp-park', location: pt(77.5476, 13.0285), areaAcres: 85 },
  ]);
  Object.assign(parks, { cubbon, lalbagh, jp });

  const [admin, officer, other, citizen] = await User.create([
    { name: 'Ananya Rao', email: 'admin@test.gov', password: 'password123', role: 'admin', park: cubbon._id },
    { name: 'Priya Nair', email: 'officer@test.gov', password: 'password123', role: 'officer', park: lalbagh._id },
    { name: 'Rahul Patil', email: 'rahul@test.gov', password: 'password123', role: 'officer', park: jp._id },
    { name: 'Rohan Shetty', email: 'citizen@test.gov', password: 'password123', role: 'citizen', park: jp._id },
  ]);
  Object.assign(users, { admin, officer, other, citizen });

  const soon = new Date(Date.now() + 3 * DAY);
  await WorkOrder.insertMany([
    { orderCode: 'WO-T-1', type: 'repair', title: 'Fix the lake fence', park: cubbon._id, assignedTo: officer._id, scheduledDate: soon, priority: 'critical', status: 'scheduled' },
    { orderCode: 'WO-T-2', type: 'cleaning', title: 'Clear the drains', park: lalbagh._id, assignedTo: officer._id, scheduledDate: new Date(Date.now() - 2 * DAY), priority: 'high', status: 'overdue' },
    { orderCode: 'WO-T-3', type: 'cleaning', title: 'Sweep the bandstand', park: lalbagh._id, assignedTo: officer._id, scheduledDate: soon, priority: 'low', status: 'scheduled' },
    { orderCode: 'WO-T-4', type: 'repair', title: 'Repaint benches', park: jp._id, assignedTo: other._id, scheduledDate: soon, priority: 'high', status: 'scheduled' },
    { orderCode: 'WO-T-5', type: 'repair', title: 'Old finished job', park: jp._id, assignedTo: officer._id, scheduledDate: soon, priority: 'high', status: 'completed', progress: 100 },
  ]);

  await Incident.insertMany([
    { referenceCode: 'INC-T-1', type: 'illegal-dumping', title: 'Dumping near the lake', park: lalbagh._id, location: pt(77.5848, 12.9507), priority: 'high', priorityScore: 78, status: 'assigned', assignedTo: officer._id, reportedAt: new Date(Date.now() - 3 * DAY) },
    { referenceCode: 'INC-T-2', type: 'fire', title: 'Smouldering leaf pile', park: cubbon._id, location: pt(77.5926, 12.9763), priority: 'critical', priorityScore: 91, status: 'reported' },
    { referenceCode: 'INC-T-3', type: 'tree-fall', title: 'Branch on path', park: jp._id, location: pt(77.5476, 13.0285), priority: 'medium', priorityScore: 40, status: 'resolved', assignedTo: officer._id },
  ]);

  await CitizenReport.insertMany([
    { referenceCode: 'CR-T-1', category: 'issue', title: 'Broken bench', description: 'Seat snapped', park: cubbon._id, location: pt(77.5926, 12.9763), submittedBy: citizen._id, status: 'submitted', createdAt: new Date(Date.now() - 12 * DAY) },
    { referenceCode: 'CR-T-2', category: 'issue', title: 'Overflowing bin', description: 'Bin full', park: lalbagh._id, location: pt(77.5848, 12.9507), submittedBy: citizen._id, status: 'in-review' },
    { referenceCode: 'CR-T-3', category: 'feedback', title: 'Lovely walk', description: 'Thanks', park: jp._id, location: pt(77.5476, 13.0285), status: 'accepted' },
  ]);

  const [kingfisher] = await Species.create([
    { commonName: 'White-throated Kingfisher', scientificName: 'Halcyon smyrnensis', class: 'bird' },
  ]);
  await Observation.insertMany([
    { species: kingfisher._id, park: lalbagh._id, location: pt(77.5848, 12.9507), source: 'citizen-report', verified: false },
    { species: kingfisher._id, park: lalbagh._id, location: pt(77.5848, 12.9507), source: 'gbif', verified: true },
    { species: kingfisher._id, park: cubbon._id, location: pt(77.5926, 12.9763), source: 'gbif', verified: false },
  ]);
  await AiDetection.insertMany([
    // Whatever tasks the AI module currently supports — only the review status matters here.
    { task: AiDetection.AI_TASKS[0], imageUrl: '/x.jpg', prediction: 'Bird', confidence: 88, park: cubbon._id, reviewStatus: 'pending' },
    { task: AiDetection.AI_TASKS[0], imageUrl: '/y.jpg', prediction: 'Butterfly or moth', confidence: 70, park: cubbon._id, reviewStatus: 'confirmed' },
  ]);

  await Sensor.insertMany([
    { sensorCode: 'S-T-1', name: 'Noise · Cubbon Park', type: 'noise', park: cubbon._id, location: pt(77.5926, 12.9763), unit: 'dB', currentValue: 56.2, lastReadingAt: new Date(), status: 'online', source: 'simulated' },
    { sensorCode: 'S-T-2', name: 'Soil moisture · Cubbon Park', type: 'soil', park: cubbon._id, location: pt(77.5926, 12.9763), unit: '%', currentValue: 31, lastReadingAt: new Date(), status: 'online', source: 'simulated' },
    { sensorCode: 'S-T-3', name: 'Temperature · Cubbon Park', type: 'temperature', park: cubbon._id, location: pt(77.5926, 12.9763), unit: '°C', currentValue: 26.9, lastReadingAt: new Date(), status: 'online', source: 'open-meteo' },
  ]);

  tools.clearParkCache();
  ctx.guest = await tools.buildContext(null);
  ctx.citizen = await tools.buildContext(citizen);
  ctx.officer = await tools.buildContext(officer);
  ctx.admin = await tools.buildContext(admin);
});

test.after(async () => {
  external.getWeather = realWeather;
  external.getAirQuality = realAir;
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

// ---------------------------------------------------------------------------
// Context and park matching
// ---------------------------------------------------------------------------

test('the context carries the role, name and home park', () => {
  assert.equal(ctx.guest.access, 'guest');
  assert.equal(ctx.citizen.access, 'citizen');
  assert.equal(ctx.officer.access, 'officer');
  assert.equal(ctx.officer.user.name, 'Priya Nair');
  assert.equal(ctx.officer.homePark.name, 'Lalbagh Botanical Garden');
});

test('park names match partially, misspelt, run together, or as "my park"', async () => {
  assert.equal((await tools.findPark('cubbon', ctx.guest)).name, 'Cubbon Park');
  assert.equal((await tools.findPark('Cubon park', ctx.guest)).name, 'Cubbon Park');
  assert.equal((await tools.findPark('lal bagh', ctx.guest)).name, 'Lalbagh Botanical Garden');
  assert.equal((await tools.findPark('jp', ctx.guest)).name, 'JP Park');
  assert.equal((await tools.findPark('my park', ctx.officer)).name, 'Lalbagh Botanical Garden');
  await assert.rejects(tools.findPark('Hyde Park', ctx.guest), /No park matches "Hyde Park"/);
  assert.equal(await tools.findPark(undefined, ctx.guest), null, 'no park means all parks');
});

test('a park is found inside a free-text question', async () => {
  assert.equal((await tools.findParkInText('what is the climate condition of Cubbon Park', ctx.guest)).name, 'Cubbon Park');
  assert.equal((await tools.findParkInText('weather at lalbag today?', ctx.guest)).name, 'Lalbagh Botanical Garden');
  assert.equal((await tools.findParkInText('how is my park doing', ctx.officer)).name, 'Lalbagh Botanical Garden');
  assert.equal(await tools.findParkInText('what is the weather like', ctx.guest), null);
});

// ---------------------------------------------------------------------------
// Role scoping in the tool layer
// ---------------------------------------------------------------------------

test('each role is offered only the tools it may use', () => {
  const names = (c) => tools.toolsFor(c).map((t) => t.name);
  assert.ok(!names(ctx.guest).includes('get_my_tasks'));
  assert.ok(!names(ctx.guest).includes('get_my_reports'));
  assert.ok(!names(ctx.citizen).includes('get_pending_reviews'));
  assert.ok(names(ctx.citizen).includes('get_my_reports'));
  assert.ok(names(ctx.officer).includes('get_my_tasks'));
  assert.ok(names(ctx.officer).includes('get_pending_reviews'));
  assert.ok(names(ctx.citizen).includes('get_park_conditions'));
});

test('a restricted tool called anyway is refused, not run', async () => {
  const asCitizen = await tools.runTool('get_pending_reviews', {}, ctx.citizen);
  assert.equal(asCitizen.ok, false);
  assert.match(asCitizen.error, /park staff/);

  const asGuest = await tools.runTool('get_my_tasks', {}, ctx.guest);
  assert.equal(asGuest.ok, false);
  assert.match(asGuest.error, /Sign in/);
});

test('my tasks are the work orders and incidents assigned to the asker', async () => {
  const r = await tools.runTool('get_my_tasks', {}, ctx.officer);
  assert.equal(r.ok, true, r.error);
  const titles = r.data.workOrders.items.map((o) => o.title);
  assert.deepEqual(titles, ['Fix the lake fence', 'Clear the drains', 'Sweep the bandstand'], 'highest priority first, open only, own only');
  assert.equal(r.data.workOrders.overdue, 1);
  assert.deepEqual(r.data.incidents.items.map((i) => i.reference), ['INC-T-1'], 'resolved incidents are not tasks');
  assert.equal(r.data.total, 4);
});

test('"high priority" means high and above', async () => {
  const r = await tools.runTool('get_my_tasks', { minPriority: 'high' }, ctx.officer);
  assert.deepEqual(r.data.workOrders.items.map((o) => o.priority), ['critical', 'high']);
  assert.equal(r.data.filter, 'high priority and above');
  assert.equal(r.data.incidents.count, 1);
});

test('only an administrator can see someone else\'s tasks', async () => {
  const officerTries = await tools.runTool('get_my_tasks', { assignee: 'Rahul Patil' }, ctx.officer);
  assert.equal(officerTries.ok, false);
  assert.match(officerTries.error, /only view their own/);

  const admin = await tools.runTool('get_my_tasks', { assignee: 'rahul' }, ctx.admin);
  assert.equal(admin.ok, true, admin.error);
  assert.equal(admin.data.assignee, 'Rahul Patil');
  assert.deepEqual(admin.data.workOrders.items.map((o) => o.title), ['Repaint benches']);

  const citizen = await tools.runTool('get_my_tasks', {}, ctx.citizen);
  assert.equal(citizen.ok, false);
});

test('pending reviews count reports, portal sightings and AI detections', async () => {
  const r = await tools.runTool('get_pending_reviews', {}, ctx.officer);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.data.citizenReports.awaitingReview, 2);
  assert.equal(r.data.citizenReports.submitted, 1);
  assert.equal(r.data.citizenReports.inReview, 1);
  assert.equal(r.data.wildlifeSightings.awaitingVerification, 1, 'GBIF records do not wait for review');
  assert.equal(r.data.aiDetections.awaitingReview, 1);
  assert.equal(r.data.total, 4);

  const cubbon = await tools.runTool('get_pending_reviews', { park: 'cubbon' }, ctx.admin);
  assert.equal(cubbon.data.total, 2);
});

test('the public sees incident counts but never the incidents', async () => {
  const pub = await tools.runTool('get_incidents', {}, ctx.citizen);
  assert.equal(pub.ok, true);
  assert.equal(pub.data.openIncidents, 2);
  assert.equal(pub.data.incidents, undefined);
  assert.equal(pub.citations.length, 0);

  const staff = await tools.runTool('get_incidents', { minPriority: 'critical' }, ctx.officer);
  assert.deepEqual(staff.data.incidents.map((i) => i.reference), ['INC-T-2']);
  assert.equal(staff.data.incidents[0].assignee, undefined, 'officers do not get staff names');

  const admin = await tools.runTool('get_incidents', {}, ctx.admin);
  assert.equal(admin.data.incidents.find((i) => i.reference === 'INC-T-1').assignee, 'Priya Nair');
});

test('an officer\'s work-order list is their own; an admin sees all', async () => {
  const officer = await tools.runTool('get_maintenance', {}, ctx.officer);
  assert.equal(officer.data.open, 4);
  assert.ok(officer.data.workOrders.every((o) => o.assignedToYou));
  const admin = await tools.runTool('get_maintenance', {}, ctx.admin);
  assert.equal(admin.data.workOrders.length, 4);
  const pub = await tools.runTool('get_maintenance', {}, ctx.guest);
  assert.equal(pub.data.workOrders, undefined);
});

test('a citizen sees the status of their own reports only', async () => {
  const r = await tools.runTool('get_my_reports', {}, ctx.citizen);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.data.total, 2);
  assert.deepEqual(r.data.byStatus, { submitted: 1, 'in-review': 1 });
});

test('park conditions combine live weather with the park\'s sensors', async () => {
  const r = await tools.runTool('get_park_conditions', { park: 'cubbon' }, ctx.guest);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.data.location, 'Cubbon Park');
  assert.equal(r.data.weather.temperatureC, 27.4);
  assert.equal(r.data.airQuality.aqi, 84);
  assert.deepEqual(r.data.parkSensors.map((s) => s.type).sort(), ['noise', 'soil', 'temperature']);
});

test('species search reports where a species was recorded', async () => {
  const r = await tools.runTool('search_species', { query: 'kingfisher' }, ctx.guest);
  assert.equal(r.data.matches[0].scientificName, 'Halcyon smyrnensis');
  assert.deepEqual(r.data.matches[0].recordedIn.map((x) => x.park), ['Lalbagh Botanical Garden'], 'only verified records count');
});

// ---------------------------------------------------------------------------
// Built-in engine
// ---------------------------------------------------------------------------

test('built-in: the climate of a named park', async () => {
  const r = await assistant.ask('What is the climate condition of Cubbon Park?', { context: ctx.guest });
  assert.equal(r.intent, 'climate');
  assert.match(r.answer, /Cubbon Park/);
  assert.match(r.answer, /27\.4 °C/);
  assert.match(r.answer, /AQI \*\*84\*\*/);
  assert.match(r.answer, /Noise 56\.2 dB/);
});

test('built-in: my high-priority tasks', async () => {
  const r = await assistant.ask('Tell me the high priority tasks assigned to me', { context: ctx.officer });
  assert.equal(r.intent, 'myTasks');
  assert.match(r.answer, /You have 3 open tasks of high priority and above/);
  assert.match(r.answer, /Fix the lake fence/);
  assert.match(r.answer, /Dumping near the lake/);
  assert.doesNotMatch(r.answer, /Sweep the bandstand/);
  assert.ok(r.citations.some((c) => c.entity === 'WorkOrder'));
  assert.deepEqual(r.toolsUsed, ['get_my_tasks']);
});

test('built-in: the count of pending reviews', async () => {
  const r = await assistant.ask('Tell me the count of pending reviews', { context: ctx.admin });
  assert.equal(r.intent, 'pendingReviews');
  assert.match(r.answer, /4 items are awaiting review/);
  assert.match(r.answer, /Citizen reports: \*\*2\*\*/);
});

test('built-in: a citizen asking for tasks or reviews is told why not', async () => {
  const tasks = await assistant.ask('What tasks are assigned to me?', { context: ctx.citizen });
  assert.match(tasks.answer, /park staff only/);
  const reviews = await assistant.ask('How many pending reviews are there?', { context: ctx.citizen });
  assert.match(reviews.answer, /only available to park staff/);
  const incidents = await assistant.ask('Show me the open incidents', { context: ctx.citizen });
  assert.doesNotMatch(incidents.answer, /Smouldering/);
  assert.ok(!incidents.citations.some((c) => c.entity === 'Incident' || c.entity === 'WorkOrder'));
});

test('suggestions follow the role', () => {
  assert.ok(assistant.suggestionsFor(ctx.officer).includes('Tell me the high priority tasks assigned to me'));
  assert.ok(assistant.suggestionsFor(ctx.citizen).includes('What is the status of my reports?'));
  assert.ok(!assistant.suggestionsFor(ctx.guest).some((s) => /assigned to me|pending reviews/.test(s)));
});

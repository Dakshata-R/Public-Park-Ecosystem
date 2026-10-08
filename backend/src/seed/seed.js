'use strict';

/**
 * Database seeder.
 *
 * ---------------------------------------------------------------------------
 * What is real, and what is demonstration data
 * ---------------------------------------------------------------------------
 * REAL — loaded from the committed open-data snapshot (scripts/fetch-open-data.js)
 *   • Parks: six Bengaluru parks with their OpenStreetMap boundaries, areas
 *     and mapped facilities.
 *   • Assets: the trees, benches, street lamps, paths, water bodies and
 *     structures mapped inside those boundaries in OpenStreetMap.
 *   • Species and observations: every species GBIF records inside each
 *     boundary since 2023, counted per month, with IUCN status, GRIIS
 *     invasive flags and CC-licensed photographs.
 *   • Sensor history for air quality, temperature and humidity: the past
 *     48 hours of Open-Meteo observations for each park (when online).
 *   • AI detections: real MobileNetV2 inference over openly licensed
 *     photographs (src/seed/data/sample-images).
 *   • Reports: generated from all of the above by report.service.
 *
 * DEMONSTRATION — generated, and flagged `demo: true` in the database
 *   • User accounts, citizen reports, incidents, work orders and the alerts
 *     derived from them — operational records only real use of the portal
 *     can produce.
 *   • Asset condition scores and maintenance histories.
 *   • Readings of the simulated noise, soil and water sensors (their source
 *     is recorded as `simulated`).
 *
 * The generator is seeded (see `random.js`), so the demonstration records
 * come back identically on every reseed.
 *
 * Usage:  npm run seed          (from backend/)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');

const {
  User, Park, Asset, Species, Observation, Sensor, SensorReading,
  CitizenReport, Incident, WorkOrder, AiDetection, AiImage, Alert, EcoReport,
  AuditLog, Setting, ChatMessage, Counter,
} = require('../models');

const { SENSOR_PROFILES } = require('../models/Sensor');
const CURATED_SPECIES = require('./data/species');
const { createRandom } = require('./random');
const { scoreIncident } = require('../services/priority.service');
const { backfillHistory } = require('../services/sensor.service');
const { refreshAllParkScores } = require('../services/ecosystem-score.service');
const { generateReport } = require('../services/report.service');
const { conditionToStatus } = require('../models/Asset');
const logger = require('../utils/logger');
const env = require('../config/env');

const OPEN_DATA = path.join(__dirname, 'data/open-data');
const SAMPLE_IMAGES = path.join(__dirname, 'data/sample-images');

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

/**
 * A park's id is derived from its slug, so reseeding gives every park the same
 * id as before. Links, bookmarks and open browser tabs that name a park keep
 * working across a reseed instead of silently matching nothing.
 */
const stableParkId = (slug) =>
  new mongoose.Types.ObjectId(crypto.createHash('sha1').update(`park:${slug}`).digest('hex').slice(0, 24));

const rng = createRandom(20260828);

/** Demonstration accounts. Passwords are printed by the script on completion. */
const DEMO_PASSWORD = 'greenpulse123';

const USER_SEEDS = [
  { name: 'Ananya Rao',        email: 'admin@greenpulse.gov',          role: 'admin',     parkSlug: 'cubbon-park' },
  { name: 'Karthik Gowda',     email: 'ecologist@greenpulse.gov',      role: 'ecologist', parkSlug: 'lalbagh-botanical-garden' },
  { name: 'Priya Nair',        email: 'officer@greenpulse.gov',        role: 'officer',   parkSlug: 'sankey-tank-park' },
  { name: 'Rohan Shetty',      email: 'citizen@greenpulse.gov',        role: 'citizen',   parkSlug: 'jp-park' },

  { name: 'Deepa Hegde',       email: 'deepa.hegde@greenpulse.gov',    role: 'ecologist', parkSlug: 'jp-park' },
  { name: 'Manjunath Swamy',   email: 'manjunath.swamy@greenpulse.gov', role: 'officer',  parkSlug: 'freedom-park' },
  { name: 'Rahul Patil',       email: 'rahul.patil@greenpulse.gov',    role: 'officer',   parkSlug: 'coles-park' },
  { name: 'Shruthi Kulkarni',  email: 'shruthi.kulkarni@greenpulse.gov', role: 'officer', parkSlug: 'cubbon-park' },
  { name: 'Ayesha Khan',       email: 'ayesha.khan@gmail.com',         role: 'citizen',   parkSlug: 'lalbagh-botanical-garden' },
  { name: 'Suresh Kumar',      email: 'suresh.kumar@gmail.com',        role: 'citizen',   parkSlug: 'cubbon-park' },
  { name: 'Meera Iyer',        email: 'meera.iyer@gmail.com',          role: 'citizen',   parkSlug: 'sankey-tank-park' },
  { name: 'Vikram Reddy',      email: 'vikram.reddy@gmail.com',        role: 'citizen',   parkSlug: 'coles-park' },
];

/** How many mapped features of each kind become assets, per park. */
const ASSET_CAPS = { tree: 60, bench: 25, light: 20, path: 12, lake: 10, structure: 12 };

// ---------------------------------------------------------------------------
// Text for demonstration records
// ---------------------------------------------------------------------------

const CITIZEN_ISSUES = [
  ['Broken bench near the play area', 'Two slats have snapped and there are exposed screws at child height.'],
  ['Overflowing bin at the east gate', 'The bin has not been emptied for several days and is attracting crows and stray dogs.'],
  ['Path lighting not working', 'Three lights along this stretch are dark, which makes the path unsafe after sunset.'],
  ['Water stagnating beside the walkway', 'A pool has formed after the rain and mosquitoes are breeding in it.'],
  ['Broken drinking water tap', 'The tap runs continuously and water is being wasted.'],
  ['Damaged fencing on the boundary', 'A section of fence is down and stray dogs are entering through the gap.'],
  ['Fallen branch blocking the walkway', 'A large branch came down in the wind and now blocks the route entirely.'],
  ['Plastic litter along the lake edge', 'Plastic bottles and wrappers have collected along the water edge.'],
  ['Play equipment is unsafe', 'The swing chain is worn almost through on one side.'],
  ['Information board defaced', 'The board has been sprayed over and the map is no longer readable.'],
];

const CITIZEN_FEEDBACK = [
  ['More native pollinator planting, please', 'Expanding native flowering beds would bring back more butterflies.'],
  ['Please add a shaded seating area', 'The stretch near the entrance has no shade at all in the afternoon.'],
  ['Signage for the walking paths would help', 'It is easy to lose the route where the path forks.'],
  ['Consider a composting point', 'Garden waste is being burned at the boundary, which is unnecessary and smoky.'],
];

const INCIDENT_TEMPLATES = [
  { type: 'tree-fall', title: 'Large branch down across the path', description: 'Wind damage has brought a limb across the path, blocking access.', severity: 4, affected: 120 },
  { type: 'tree-fall', title: 'Tree leaning over the walkway', description: 'A tree has developed a pronounced lean after heavy rain and root plate movement is visible.', severity: 4, affected: 200 },
  { type: 'illegal-dumping', title: 'Construction debris dumped at the boundary', description: 'Concrete rubble and rebar tipped overnight near the fence.', severity: 3, affected: 40 },
  { type: 'illegal-dumping', title: 'Household waste dumped near the service gate', description: 'Several sacks of mixed household waste left beside the service entrance.', severity: 2, affected: 25 },
  { type: 'fire', title: 'Dry grass burning near the boundary', description: 'Garden waste set alight spread into dry grass; smoke visible from the path.', severity: 5, affected: 300 },
  { type: 'water-pollution', title: 'Algal bloom on the lake surface', description: 'Dense green surface bloom consistent with nutrient runoff.', severity: 4, affected: 350 },
  { type: 'water-pollution', title: 'Oily sheen at the storm-water inlet', description: 'A rainbow sheen is entering the lake at the inflow.', severity: 4, affected: 300 },
  { type: 'dead-animal', title: 'Dead bird found beneath roost trees', description: 'Reported by morning walkers. Collected for disposal and noted for disease surveillance.', severity: 2, affected: 10 },
  { type: 'vandalism', title: 'Interpretation board damaged', description: 'The panel has been broken and the printed map torn away.', severity: 2, affected: 60 },
  { type: 'infrastructure-damage', title: 'Boundary wall section collapsed', description: 'A stretch of the compound wall has come down, leaving the site open.', severity: 3, affected: 150 },
];

const WORK_ORDER_TEMPLATES = [
  { type: 'tree-trimming', title: 'Crown reduction and deadwood removal', hours: 6, cost: 4800 },
  { type: 'tree-trimming', title: 'Remove hazardous limb over the path', hours: 4, cost: 3600 },
  { type: 'cleaning', title: 'Cleaning round — bins and toilets', hours: 5, cost: 2200 },
  { type: 'cleaning', title: 'Litter clearance along the lake margin', hours: 4, cost: 1800 },
  { type: 'repair', title: 'Replace damaged bench slats', hours: 2, cost: 1200 },
  { type: 'repair', title: 'Street lamp repair', hours: 2, cost: 2600 },
  { type: 'repair', title: 'Resurface the eroded path section', hours: 8, cost: 9400 },
  { type: 'lake-cleaning', title: 'Water hyacinth removal', hours: 12, cost: 16500 },
  { type: 'inspection', title: 'Quarterly asset safety inspection', hours: 4, cost: 1500 },
  { type: 'inspection', title: 'Tree stability survey after the storm', hours: 6, cost: 3200 },
  { type: 'planting', title: 'Native pollinator bed extension', hours: 8, cost: 5600 },
  { type: 'irrigation', title: 'Repair the drip line to the nursery beds', hours: 3, cost: 2100 },
];

const MAINTENANCE_TYPES = ['Inspection', 'Pruning', 'Cleaning', 'Repair', 'Repainting', 'Irrigation'];
const TEAMS = ['Grounds Crew A', 'Grounds Crew B', 'Arboriculture Team', 'Lake Team', 'Electrical Team', 'Sanitation Team'];

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Ray-casting point-in-polygon over a GeoJSON ring. */
function inRing(ring, [lng, lat]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** A uniformly random point inside a park's real boundary (rejection sampling). */
function pointInPark(park) {
  const ring = park.boundary.coordinates[0];
  const lngs = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const candidate = [rng.float(Math.min(...lngs), Math.max(...lngs)), rng.float(Math.min(...lats), Math.max(...lats))];
    if (inRing(ring, candidate)) return { type: 'Point', coordinates: candidate.map((v) => Math.round(v * 1e6) / 1e6) };
  }
  return park.location;
}

const point = ([lng, lat]) => ({ type: 'Point', coordinates: [lng, lat] });

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/** Demonstration condition and maintenance history for a real mapped asset. */
function demoCondition() {
  const condition = Math.max(12, Math.min(100, Math.round(rng.gaussian(76, 18))));
  const maintenance = [];
  for (let m = rng.int(0, 3); m > 0; m -= 1) {
    maintenance.push({
      date: rng.pastDate(720, 20),
      type: rng.pick(MAINTENANCE_TYPES),
      description: `Routine ${rng.pick(MAINTENANCE_TYPES).toLowerCase()} (demonstration record).`,
      cost: rng.int(200, 6000),
      technician: rng.pick(TEAMS),
    });
  }
  return { condition, status: conditionToStatus(condition), maintenance, demo: true };
}

function buildAssets(parks, openParks, speciesByName) {
  const docs = [];
  const counters = {};
  const PREFIX = { tree: 'TRE', bench: 'BNC', lake: 'LAK', path: 'PTH', light: 'LGT', structure: 'STR' };
  const code = (type) => {
    counters[type] = (counters[type] || 0) + 1;
    return `${PREFIX[type]}-${String(counters[type]).padStart(4, '0')}`;
  };

  for (const park of parks) {
    const f = openParks.get(park.slug).features;

    /** One asset at a mapped point. `describe(assetCode)` returns its name and attributes. */
    const add = (type, feature, osmType, describe) => {
      const assetCode = code(type);
      const base = {
        assetCode,
        type,
        park: park._id,
        location: point(feature.coordinates),
        source: { provider: 'OpenStreetMap', id: `${osmType}/${feature.osmId}` },
        ...demoCondition(),
        ...describe(assetCode),
      };
      base.attributes = { osmId: String(feature.osmId), ...(base.attributes || {}) };
      if (base.maintenance.length) base.lastMaintenanceAt = base.maintenance.map((m) => m.date).reduce((a, b) => (a > b ? a : b));
      docs.push(base);
    };

    for (const t of f.trees.slice(0, ASSET_CAPS.tree)) {
      const scientific = t.species || '';
      const known = scientific && speciesByName.get(scientific.toLowerCase());
      add('tree', t, 'node', (assetCode) => ({
        name: `${known?.commonName || scientific || t.genus || 'Tree'} ${assetCode.slice(-4)}`,
        attributes: { species: scientific, genus: t.genus, commonName: known?.commonName || '' },
      }));
    }
    for (const b of f.benches.slice(0, ASSET_CAPS.bench)) {
      add('bench', b, 'node', (assetCode) => ({ name: `Bench ${assetCode.slice(-4)}`, attributes: { material: b.material, backrest: b.backrest } }));
    }
    for (const l of f.lamps.slice(0, ASSET_CAPS.light)) {
      add('light', l, 'node', (assetCode) => ({ name: `Street lamp ${assetCode.slice(-4)}`, attributes: { lampType: l.lampType } }));
    }
    const paths = [...f.paths].sort((a, b) => b.lengthM - a.lengthM).slice(0, ASSET_CAPS.path);
    for (const p of paths) {
      docs.push({
        assetCode: code('path'),
        type: 'path',
        name: p.name || `Footpath (${p.lengthM} m)`,
        park: park._id,
        location: point(p.coordinates[Math.floor(p.coordinates.length / 2)]),
        path: { type: 'LineString', coordinates: p.coordinates },
        source: { provider: 'OpenStreetMap', id: `way/${p.osmId}` },
        attributes: { osmId: String(p.osmId), surface: p.surface, lengthM: String(p.lengthM) },
        ...demoCondition(),
      });
    }
    for (const w of f.water.slice(0, ASSET_CAPS.lake)) {
      add('lake', w, 'way', () => ({
        name: w.name || 'Water body',
        attributes: { waterType: w.waterType, areaM2: w.areaM2 ? String(w.areaM2) : '' },
      }));
    }
    for (const s of f.structures.slice(0, ASSET_CAPS.structure)) {
      add('structure', s, 'node', () => ({ name: s.name, attributes: { kind: s.kind } }));
    }
  }

  return docs;
}

function buildSensors(parks, openParks) {
  const docs = [];
  let counter = 0;

  for (const park of parks) {
    const short = park.slug.split('-')[0].toUpperCase().slice(0, 5);
    const water = openParks.get(park.slug).features.water;

    const plan = [
      { type: 'aqi', source: 'open-meteo', name: `Air quality · ${park.name}`, location: park.location },
      { type: 'temperature', source: 'open-meteo', name: `Temperature · ${park.name}`, location: park.location },
      { type: 'humidity', source: 'open-meteo', name: `Humidity · ${park.name}`, location: park.location },
      { type: 'noise', source: 'simulated', name: `Noise · ${park.name}`, location: pointInPark(park) },
      { type: 'soil', source: 'simulated', name: `Soil moisture · ${park.name}`, location: pointInPark(park) },
    ];
    // Only a park with a mapped water body gets a water-quality probe, sited on it.
    if (water.length) {
      plan.push({ type: 'water', source: 'simulated', name: `Water quality · ${water[0].name || park.name}`, location: point(water[0].coordinates) });
    }

    for (const s of plan) {
      counter += 1;
      const profile = SENSOR_PROFILES[s.type];
      docs.push({
        sensorCode: `${s.type.toUpperCase()}-${short}-${String(counter).padStart(2, '0')}`,
        name: s.name,
        type: s.type,
        source: s.source,
        park: park._id,
        location: s.location,
        unit: profile.unit,
        minValue: profile.min,
        maxValue: profile.max,
        warnAbove: profile.warnAbove ?? null,
        warnBelow: profile.warnBelow ?? null,
        installedAt: new Date(),
        batteryLevel: null,
        firmware: '',
        status: 'online',
        active: true,
      });
    }
  }

  return docs;
}

function buildObservations(parks, openObservations, speciesByKey) {
  const parkBySlug = new Map(parks.map((p) => [p.slug, p]));
  const now = Date.now();

  return openObservations
    .filter((o) => parkBySlug.has(o.park) && speciesByKey.has(o.gbifKey))
    .map((o) => {
      const park = parkBySlug.get(o.park);
      const [year, month] = o.month.split('-').map(Number);
      // Mid-month stands in for "some time that month"; never in the future.
      const observedAt = new Date(Math.min(Date.UTC(year, month - 1, 15, 6), now));
      return {
        species: speciesByKey.get(o.gbifKey)._id,
        park: park._id,
        observedAt,
        count: o.records,
        location: o.coordinates ? point(o.coordinates) : park.location,
        locationName: o.coordinates ? 'Location of a GBIF record' : 'Park centre (no georeferenced record sampled)',
        observerName: 'GBIF occurrence records',
        source: 'gbif',
        verified: true,
        notes: `${o.records} GBIF occurrence record${o.records === 1 ? '' : 's'} in ${o.month}.`,
      };
    });
}

function buildCitizenReports(parks, users, speciesDocs) {
  const docs = [];
  const citizens = users.filter((u) => u.role === 'citizen');
  const year = new Date().getFullYear();
  let counter = 0;
  const push = (doc) => {
    counter += 1;
    docs.push({ ...doc, referenceCode: `CR-${year}-${String(counter).padStart(4, '0')}`, demo: true });
  };

  for (let i = 0; i < 20; i += 1) {
    const [title, description] = rng.pick(CITIZEN_ISSUES);
    const park = rng.pick(parks);
    const citizen = rng.pick(citizens);
    push({
      category: 'issue', title, description, park: park._id, location: pointInPark(park),
      submittedBy: citizen._id, submittedByName: citizen.name,
      status: rng.pick(['submitted', 'submitted', 'in-review', 'accepted', 'resolved', 'rejected']),
      upvotes: 0, createdAt: rng.pastDate(180, 0),
    });
  }

  const sightable = speciesDocs.filter((s) => ['bird', 'butterfly', 'mammal', 'reptile'].includes(s.class) && s.commonName && s.parks.length);
  for (let i = 0; i < 12 && sightable.length; i += 1) {
    const species = rng.pick(sightable);
    const park = parks.find((p) => String(p._id) === String(rng.pick(species.parks))) || rng.pick(parks);
    const citizen = rng.pick(citizens);
    push({
      category: 'wildlife-sighting',
      title: `${species.commonName} sighted`,
      description: `Spotted a ${species.commonName} near the walking path. Watched from a distance without disturbing it.`,
      park: park._id, location: pointInPark(park),
      submittedBy: citizen._id, submittedByName: citizen.name, species: species._id,
      status: rng.pick(['submitted', 'in-review', 'accepted', 'resolved']),
      upvotes: 0, createdAt: rng.pastDate(180, 0),
    });
  }

  for (const [title, description] of CITIZEN_FEEDBACK) {
    const park = rng.pick(parks);
    const citizen = rng.pick(citizens);
    push({
      category: rng.chance(0.5) ? 'feedback' : 'suggestion', title, description,
      park: park._id, location: pointInPark(park),
      submittedBy: citizen._id, submittedByName: citizen.name,
      status: rng.pick(['submitted', 'in-review', 'accepted']), upvotes: 0, createdAt: rng.pastDate(200, 0),
    });
  }

  // Upvotes are real per-account signals, so demonstration upvotes come from
  // the demonstration citizens themselves — at most one each.
  for (const doc of docs) {
    const voters = rng.sample(citizens.filter((c) => String(c._id) !== String(doc.submittedBy)), rng.int(0, citizens.length - 1));
    doc.upvotedBy = voters.map((v) => v._id);
    doc.upvotes = voters.length;
  }

  return docs;
}

function buildIncidents(parks, users, parksWithWater) {
  const docs = [];
  const officers = users.filter((u) => ['officer', 'ecologist'].includes(u.role));
  const year = new Date().getFullYear();

  for (let i = 0; i < 30; i += 1) {
    const template = rng.pick(INCIDENT_TEMPLATES);
    // Water pollution only happens where there is water.
    const candidates = template.type === 'water-pollution' ? parks.filter((p) => parksWithWater.has(p.slug)) : parks;
    const park = rng.pick(candidates.length ? candidates : parks);
    const reportedAt = rng.pastDate(200, 0);

    const ageDays = (Date.now() - reportedAt) / 86_400_000;
    let status =
      ageDays > 60 ? rng.pick(['resolved', 'resolved', 'closed'])
      : ageDays > 20 ? rng.pick(['resolved', 'in-progress', 'assigned'])
      : rng.pick(['reported', 'assigned', 'in-progress']);
    if (template.type === 'fire' && ageDays > 0.5) status = rng.pick(['resolved', 'closed']);

    const isClosed = ['resolved', 'closed'].includes(status);
    const officer = status === 'reported' ? null : rng.pick(officers);
    const severity = Math.max(1, Math.min(5, template.severity + rng.int(-1, 1)));
    const affectedPeople = Math.round(template.affected * rng.float(0.5, 1.6));
    const triage = scoreIncident({ type: template.type, severity, affectedPeople, upvotes: 0, reportedAt, status }, new Date());

    const timeline = [{ status: 'reported', note: 'Incident opened', byName: 'System', at: reportedAt }];
    if (officer) {
      timeline.push({ status: 'assigned', note: `Assigned to ${officer.name}`, by: officer._id, byName: officer.name, at: new Date(reportedAt.getTime() + rng.float(0.2, 8) * 3_600_000) });
    }

    let resolvedAt = null;
    let resolutionMinutes = null;
    if (isClosed) {
      const hours = rng.float(1, 96);
      resolvedAt = new Date(reportedAt.getTime() + hours * 3_600_000);
      resolutionMinutes = Math.round(hours * 60);
      timeline.push({ status, note: 'Work completed and site cleared.', by: officer?._id || null, byName: officer?.name || 'System', at: resolvedAt });
    }

    docs.push({
      referenceCode: `INC-${year}-${String(i + 1).padStart(4, '0')}`,
      type: template.type,
      title: template.title,
      description: template.description,
      park: park._id,
      location: pointInPark(park),
      priorityScore: triage.score,
      priority: triage.priority,
      status,
      source: rng.pick(['citizen-report', 'officer-patrol', 'officer-patrol', 'sensor-alert']),
      affectedPeople,
      severity,
      upvotes: 0,
      assignedTo: officer?._id || null,
      assignedAt: officer ? new Date(reportedAt.getTime() + 3_600_000) : null,
      reportedAt,
      resolvedAt,
      resolutionMinutes,
      resolutionNotes: isClosed ? 'Site inspected, hazard removed and area returned to normal use.' : '',
      timeline,
      demo: true,
    });
  }

  return docs;
}

function buildWorkOrders(parks, users, assets, incidents) {
  const docs = [];
  const staff = users.filter((u) => ['officer', 'ecologist'].includes(u.role));
  const year = new Date().getFullYear();
  const needsWork = assets.filter((a) => a.condition < 60);

  for (let i = 0; i < 36; i += 1) {
    const template = rng.pick(WORK_ORDER_TEMPLATES);
    const targetAsset = rng.chance(0.6) && needsWork.length ? rng.pick(needsWork) : null;
    const park = targetAsset ? parks.find((p) => String(p._id) === String(targetAsset.park)) : rng.pick(parks);

    const scheduledDate = rng.chance(0.35) ? rng.pastDate(120, 1) : rng.futureDate(45);
    const isPast = scheduledDate < new Date();
    const status = isPast ? rng.pick(['completed', 'completed', 'completed', 'overdue']) : rng.pick(['scheduled', 'scheduled', 'in-progress']);
    const progress = status === 'completed' ? 100 : status === 'in-progress' ? rng.int(15, 85) : 0;
    const assignee = rng.chance(0.7) ? rng.pick(staff) : null;
    const sourceIncident = rng.chance(0.2) ? rng.pick(incidents) : null;

    docs.push({
      orderCode: `WO-${year}-${String(i + 1).padStart(4, '0')}`,
      type: template.type,
      title: template.title,
      description: `${template.title} at ${park.name}. Estimated ${template.hours} hours of crew time.`,
      park: park._id,
      asset: targetAsset?._id || null,
      assetName: targetAsset?.name || '',
      assignedTo: assignee?._id || null,
      assignedTeam: rng.pick(TEAMS),
      scheduledDate,
      startedAt: progress > 0 ? new Date(scheduledDate.getTime() - 3_600_000) : null,
      completedAt: status === 'completed' ? scheduledDate : null,
      priority: rng.pick(['low', 'medium', 'medium', 'high', 'critical']),
      status,
      progress,
      estimatedCost: template.cost,
      actualCost: status === 'completed' ? Math.round(template.cost * rng.float(0.85, 1.25)) : 0,
      estimatedHours: template.hours,
      sourceIncident: sourceIncident?._id || null,
      recurrence: ['cleaning', 'inspection'].includes(template.type) ? rng.pick(['weekly', 'monthly', 'quarterly']) : 'none',
      completionNotes: status === 'completed' ? 'Completed and signed off by the supervising officer.' : '',
      demo: true,
    });
  }

  return docs;
}

/**
 * Real inference over the committed sample photographs.
 *
 * Each sample analysis is filed against a park in rotation, so every park's
 * AI view has records. The park is attached after the detection is recorded,
 * so seeding does not also open incidents from the sample photographs.
 * They arrive unreviewed: a precision figure appears only once a person
 * reviews them.
 */
async function seedAiDetections(say, parks) {
  const { runInference } = require('../services/ai-inference.service');
  const { storeImage, recordDetection } = require('../controllers/ai.controller');

  const samples = readJson(path.join(SAMPLE_IMAGES, 'attribution.json')).filter((s) => s.use === 'seed');
  let created = 0;

  for (const sample of samples) {
    try {
      const result = await runInference(sample.task, fs.readFileSync(path.join(SAMPLE_IMAGES, sample.file)));
      const credit = `“${sample.title}” by ${sample.author}, ${sample.license} (Wikimedia Commons)`;
      const image = await storeImage(result.stored, { source: 'sample', originalUrl: sample.source, credit });
      const { detection } = await recordDetection({ task: sample.task, result, image, imageName: sample.file, imageCredit: credit, park: null });
      const park = parks[created % parks.length];
      await AiDetection.updateOne({ _id: detection._id }, { $set: { park: park._id, location: park.location } });
      created += 1;
    } catch (err) {
      say(`AI detections skipped — the vision model is unavailable (${err.message}). They will work once it downloads.`);
      break;
    }
  }

  return created;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Build the database from the open-data snapshot plus demonstration records.
 *
 * @param {object} [options]
 * @param {boolean} [options.force=false]     Drop existing data first
 * @param {boolean} [options.quiet=false]     Suppress progress logging
 * @param {boolean} [options.fetchLive]       Pull 48 h of Open-Meteo history (default: not under test)
 * @param {boolean} [options.aiDetections=true] Run the vision model over the sample photographs
 * @returns {Promise<object>} Row counts per collection
 */
async function seedDatabase({ force = false, quiet = false, fetchLive = !env.isTest, aiDetections = true } = {}) {
  const say = quiet ? () => {} : (msg) => logger.info(`  ${msg}`);

  const COLLECTIONS = [
    User, Park, Asset, Species, Observation, Sensor, SensorReading,
    CitizenReport, Incident, WorkOrder, AiDetection, AiImage, Alert, EcoReport,
    AuditLog, ChatMessage, Counter,
  ];

  if (force) {
    say('Clearing existing collections…');
    await Promise.all(COLLECTIONS.map((model) => model.deleteMany({})));
    await Setting.deleteMany({});
  }

  const openParks = readJson(path.join(OPEN_DATA, 'parks.json'));
  const openSpecies = readJson(path.join(OPEN_DATA, 'species.json'));
  const openObservations = readJson(path.join(OPEN_DATA, 'observations.json'));
  const openParkBySlug = new Map(openParks.map((p) => [p.slug, p]));

  await Setting.current();

  // --- Parks (OpenStreetMap) ------------------------------------------------
  say('Loading parks from the OpenStreetMap snapshot…');
  const parkDocs = await Park.insertMany(
    openParks.map((p) => ({
      _id: stableParkId(p.slug),
      name: p.name,
      slug: p.slug,
      description: p.description,
      location: point(p.location),
      boundary: { type: 'Polygon', coordinates: [p.boundary] },
      areaAcres: p.areaAcres,
      weeklyVisitors: null,
      establishedYear: p.establishedYear,
      address: '',
      city: 'Bengaluru',
      manager: p.manager,
      openingHours: p.openingHours,
      facilities: p.facilities,
      source: { provider: 'OpenStreetMap', id: p.osm },
      active: true,
    }))
  );
  const parks = parkDocs.map((doc) => ({ ...doc.toObject(), _id: doc._id }));
  const parksWithWater = new Set(openParks.filter((p) => p.features.water.length).map((p) => p.slug));

  // --- Users (demonstration) ----------------------------------------------
  say('Creating demonstration accounts…');
  const parkBySlug = new Map(parks.map((p) => [p.slug, p]));
  const users = [];
  for (const seed of USER_SEEDS) {
    // `create`, not `insertMany`, so the password-hashing pre-save hook runs.
    users.push(await User.create({
      name: seed.name,
      email: seed.email,
      password: DEMO_PASSWORD,
      role: seed.role,
      park: parkBySlug.get(seed.parkSlug)?._id || null,
      active: true,
      contributions: 0,
      demo: true,
    }));
  }

  // --- Species (GBIF + curated descriptions) -------------------------------
  say('Loading the species catalogue from the GBIF snapshot…');
  const curated = new Map(CURATED_SPECIES.map((s) => [s.scientificName.toLowerCase(), s]));
  const seen = new Set();
  const speciesRows = [];

  for (const s of openSpecies) {
    const key = s.scientificName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const c = curated.get(key);
    speciesRows.push({
      commonName: s.commonName || c?.commonName || s.scientificName,
      scientificName: s.scientificName,
      class: c?.class === 'tree' ? 'tree' : s.class,
      family: s.family,
      order: s.order,
      conservationStatus: s.conservationStatus,
      habitat: c?.habitat || '',
      description: c?.description || '',
      isInvasive: s.isInvasive,
      isIntroduced: s.isIntroduced,
      isIndicator: Boolean(c?.isIndicator),
      seasonality: s.seasonality,
      gbifKey: s.gbifKey,
      images: s.image ? [s.image.url] : [],
      imageCredit: s.image ? `${s.image.credit}${s.image.license ? `, ${s.image.license}` : ''}` : '',
      parks: [],
    });
  }
  // Curated regional species GBIF did not record inside the boundaries stay in
  // the catalogue — with no observations, so they do not affect any index.
  for (const c of CURATED_SPECIES) {
    if (seen.has(c.scientificName.toLowerCase())) continue;
    speciesRows.push({
      commonName: c.commonName, scientificName: c.scientificName, class: c.class, family: c.family,
      conservationStatus: c.conservationStatus, habitat: c.habitat, description: c.description,
      isInvasive: Boolean(c.isInvasive), isIndicator: Boolean(c.isIndicator), seasonality: [], images: [], parks: [],
    });
  }
  const speciesDocs = await Species.insertMany(speciesRows);
  const speciesByKey = new Map(speciesDocs.filter((s) => s.gbifKey).map((s) => [s.gbifKey, s]));
  const speciesByName = new Map(speciesDocs.map((s) => [s.scientificName.toLowerCase(), s]));

  // --- Observations (GBIF) ------------------------------------------------
  say('Loading GBIF observation records…');
  const observationDocs = await Observation.insertMany(buildObservations(parks, openObservations, speciesByKey), { ordered: false });

  const parksBySpecies = new Map();
  for (const obs of observationDocs) {
    const key = String(obs.species);
    if (!parksBySpecies.has(key)) parksBySpecies.set(key, new Set());
    parksBySpecies.get(key).add(String(obs.park));
  }
  await Species.bulkWrite(
    [...parksBySpecies.entries()].map(([id, parkIds]) => ({ updateOne: { filter: { _id: id }, update: { $set: { parks: [...parkIds] } } } }))
  );
  const speciesWithParks = speciesDocs.map((s) => ({ ...s.toObject(), parks: [...(parksBySpecies.get(String(s._id)) || [])] }));

  // --- Assets (OpenStreetMap positions, demonstration condition) ----------
  say('Registering assets mapped in OpenStreetMap…');
  const assetDocs = await Asset.insertMany(buildAssets(parks, openParkBySlug, speciesByName));

  // --- Sensors ------------------------------------------------------------
  say('Deploying sensors (live: Open-Meteo · simulated: noise, soil, water)…');
  const sensorDocs = await Sensor.insertMany(buildSensors(parks, openParkBySlug));

  say(fetchLive ? 'Loading 48 h of Open-Meteo history and simulated readings…' : 'Generating simulated sensor history (live history skipped)…');
  const history = await backfillHistory(sensorDocs, parks, { hours: 48, stepMinutes: 60, fetchLive });
  if (history.liveUnavailable.length) {
    logger.warn(`  Open-Meteo history unavailable for ${history.liveUnavailable.length} parks — live sensors will fill in once reachable.`);
  }

  // --- Demonstration operational records ----------------------------------
  say('Adding demonstration citizen reports, incidents and work orders…');
  const reportDocs = await CitizenReport.insertMany(buildCitizenReports(parks, users, speciesWithParks));
  const incidentDocs = await Incident.insertMany(buildIncidents(parks, users, parksWithWater));

  const acceptedIssues = reportDocs.filter((r) => r.category === 'issue' && ['accepted', 'resolved'].includes(r.status));
  for (let i = 0; i < Math.min(acceptedIssues.length, 6); i += 1) {
    const report = acceptedIssues[i];
    const incident = incidentDocs[i];
    await CitizenReport.updateOne({ _id: report._id }, { $set: { linkedIncident: incident._id } });
    const triage = scoreIncident({ ...incident.toObject(), upvotes: report.upvotes });
    await Incident.updateOne(
      { _id: incident._id },
      { $set: { sourceReport: report._id, source: 'citizen-report', upvotes: report.upvotes, priorityScore: triage.score, priority: triage.priority } }
    );
  }

  const workOrderDocs = await WorkOrder.insertMany(buildWorkOrders(parks, users, assetDocs, incidentDocs));

  // Contributions are counted from the seeded reports, not invented.
  await User.bulkWrite(users.map((u) => ({
    updateOne: { filter: { _id: u._id }, update: { $set: { contributions: reportDocs.filter((r) => String(r.submittedBy) === String(u._id)).length } } },
  })));

  // --- AI detections (real inference) --------------------------------------
  let detectionCount = 0;
  if (aiDetections) {
    say('Running the vision model over the sample photographs…');
    detectionCount = await seedAiDetections(say, parks);
  }

  // --- Alerts --------------------------------------------------------------
  say('Raising alerts from the current state…');
  const alertDocs = [];
  const freshIncidents = await Incident.find({ _id: { $in: incidentDocs.map((i) => i._id) } }).lean();
  for (const incident of freshIncidents) {
    if (['resolved', 'closed'].includes(incident.status) || !['high', 'critical'].includes(incident.priority)) continue;
    alertDocs.push({
      title: `${incident.priority === 'critical' ? 'CRITICAL' : 'High priority'}: ${incident.title}`,
      message: `Reference ${incident.referenceCode}. Triage score ${incident.priorityScore}/100.`,
      module: 'Incident Management',
      source: 'incident',
      severity: incident.priority,
      status: 'active',
      park: incident.park,
      relatedModel: 'Incident',
      relatedId: incident._id,
      dedupeKey: `incident:${incident._id}`,
      createdAt: incident.reportedAt,
      demo: true,
    });
  }

  for (const sensor of await Sensor.find({ active: true, lastReadingAt: { $ne: null } })) {
    const overHigh = sensor.warnAbove != null && sensor.currentValue > sensor.warnAbove;
    const underLow = sensor.warnBelow != null && sensor.currentValue < sensor.warnBelow;
    if (!overHigh && !underLow) continue;
    const bound = overHigh ? sensor.warnAbove : sensor.warnBelow;
    const direction = overHigh ? 'above' : 'below';
    alertDocs.push({
      title: `${sensor.name}: ${sensor.type.toUpperCase()} ${direction} threshold`,
      message: `Reading ${sensor.currentValue} ${sensor.unit} is ${direction} the ${bound} ${sensor.unit} threshold.`,
      module: 'Environmental Sensors',
      source: 'sensor',
      severity: 'high',
      status: 'active',
      park: sensor.park,
      relatedModel: 'Sensor',
      relatedId: sensor._id,
      dedupeKey: `sensor:${sensor._id}:threshold`,
      demo: sensor.source === 'simulated',
    });
  }
  if (alertDocs.length) await Alert.insertMany(alertDocs);

  // --- Derived scores and generated reports --------------------------------
  say('Computing ecosystem health indices…');
  const scores = await refreshAllParkScores();

  say('Generating reports from the data…');
  const reportPlan = [
    { type: 'ecosystem', parkId: null, days: 90 },
    { type: 'biodiversity', parkId: parkBySlug.get('lalbagh-botanical-garden')?._id, days: 365 },
    { type: 'biodiversity', parkId: parkBySlug.get('cubbon-park')?._id, days: 365 },
    { type: 'air', parkId: null, days: 30 },
    { type: 'maintenance', parkId: null, days: 120 },
    { type: 'engagement', parkId: null, days: 180 },
  ];
  const ecologist = users.find((u) => u.role === 'ecologist');
  let ecoReportCount = 0;
  for (const plan of reportPlan) {
    const report = await generateReport({ ...plan, user: ecologist });
    report.status = 'published';
    await report.save();
    ecoReportCount += 1;
  }

  const meta = readJson(path.join(OPEN_DATA, 'meta.json'));
  await AuditLog.create({
    action: 'seed',
    entity: 'Database',
    entityLabel: `reference data (snapshot ${meta.fetchedAt.slice(0, 10)}) + demonstration records`,
    actorName: 'Seed script',
    actorRole: 'system',
  });

  return {
    parks: parks.length,
    users: users.length,
    species: speciesDocs.length,
    observations: observationDocs.length,
    gbifRecords: observationDocs.reduce((sum, o) => sum + o.count, 0),
    assets: assetDocs.length,
    sensors: sensorDocs.length,
    readings: history.live + history.simulated,
    liveReadings: history.live,
    simulatedReadings: history.simulated,
    citizenReports: reportDocs.length,
    incidents: incidentDocs.length,
    workOrders: workOrderDocs.length,
    aiDetections: detectionCount,
    ecoReports: ecoReportCount,
    alerts: alertDocs.length,
    snapshot: meta,
    scores,
    credentials: USER_SEEDS.slice(0, 4).map((u) => ({ role: u.role, email: u.email, password: DEMO_PASSWORD })),
  };
}

/** CLI entry point: `npm run seed`. */
async function main() {
  const { connectDatabase, disconnectDatabase } = require('../config/db');

  logger.info('Connecting to MongoDB…');
  const { inMemory } = await connectDatabase();

  if (inMemory) {
    logger.warn('Seeding an IN-MEMORY database — the data will vanish when this process exits.');
    logger.warn('Set MONGODB_URI in backend/.env to seed a persistent database.');
  }

  logger.info('Seeding…');
  const summary = await seedDatabase({ force: true });

  logger.success('Seed complete.');
  console.table({
    Parks: summary.parks,
    Species: summary.species,
    'Observation rows (GBIF records)': `${summary.observations} (${summary.gbifRecords})`,
    Assets: summary.assets,
    Sensors: summary.sensors,
    'Sensor readings (live / simulated)': `${summary.liveReadings} / ${summary.simulatedReadings}`,
    'AI detections': summary.aiDetections,
    Reports: summary.ecoReports,
    'Demo accounts': summary.users,
    'Demo citizen reports': summary.citizenReports,
    'Demo incidents': summary.incidents,
    'Demo work orders': summary.workOrders,
    Alerts: summary.alerts,
  });

  logger.info('Ecosystem health scores:');
  console.table(summary.scores);

  logger.info(`Demonstration accounts (password: ${DEMO_PASSWORD}):`);
  console.table(summary.credentials);

  await disconnectDatabase();
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    logger.error('Seeding failed:', err.message);
    logger.error(err.stack);
    process.exit(1);
  });
}

module.exports = { seedDatabase, DEMO_PASSWORD, USER_SEEDS };

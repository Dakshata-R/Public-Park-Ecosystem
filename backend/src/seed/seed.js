'use strict';

/**
 * Demonstration data generator.
 *
 * Everything except the parks and the species catalogue is generated rather
 * than hand-written, for two reasons:
 *
 *   1. Volume. The anomaly detector needs a real history per sensor (~100
 *      readings each) and the biodiversity indices need hundreds of
 *      observations before Shannon and evenness mean anything. Typing that
 *      out is not feasible and would not look like real data anyway.
 *
 *   2. Structure. Generated data can respect the relationships that make the
 *      dashboard coherent — species only appear in parks they plausibly
 *      inhabit, incidents cluster where sensors are breaching thresholds,
 *      work orders point at assets that are genuinely in poor condition. A
 *      hand-written fixture drifts out of agreement with itself immediately.
 *
 * The generator is seeded (see `random.js`), so the same dataset comes back
 * every time.
 *
 * Usage:  npm run seed          (from server/)
 */

const {
  User, Park, Asset, Species, Observation, Sensor, SensorReading,
  CitizenReport, Incident, WorkOrder, AiDetection, Alert, EcoReport,
  AuditLog, Setting, ChatMessage,
} = require('../models');

const { SENSOR_PROFILES } = require('../models/Sensor');
const PARK_SEEDS = require('./data/parks');
const SPECIES_SEEDS = require('./data/species');
const { createRandom } = require('./random');
const { runInference, TASK_CLASSES } = require('../services/ai-inference.service');
const { scoreIncident } = require('../services/priority.service');
const { backfillHistory } = require('../services/sensor.service');
const { refreshAllParkScores } = require('../services/ecosystem-score.service');
const { conditionToStatus } = require('../models/Asset');
const logger = require('../utils/logger');

const rng = createRandom(20260828);

/** Demonstration accounts. Passwords are printed by the script on completion. */
const DEMO_PASSWORD = 'greenpulse123';

const USER_SEEDS = [
  { name: 'Dr. Elena Varma',  email: 'admin@greenpulse.gov',     role: 'admin',     parkSlug: 'central-green-park' },
  { name: 'Marcus Reddy',     email: 'ecologist@greenpulse.gov', role: 'ecologist', parkSlug: 'riverside-nature-reserve' },
  { name: 'Priya Nair',       email: 'officer@greenpulse.gov',   role: 'officer',   parkSlug: 'lakeview-botanical-garden' },
  { name: 'Jamie Rivera',     email: 'citizen@greenpulse.gov',   role: 'citizen',   parkSlug: 'neem-grove-park' },

  { name: 'Sofia Lingam',     email: 'sofia.lingam@greenpulse.gov',  role: 'ecologist', parkSlug: 'neem-grove-park' },
  { name: 'Tom Bekele',       email: 'tom.bekele@greenpulse.gov',    role: 'officer',   parkSlug: 'sunset-hills-park' },
  { name: 'Rahul Patel',      email: 'rahul.patel@greenpulse.gov',   role: 'officer',   parkSlug: 'banyan-forest-park' },
  { name: 'Leila Greene',     email: 'leila.greene@greenpulse.gov',  role: 'officer',   parkSlug: 'central-green-park' },
  { name: 'Aisha Khan',       email: 'aisha.khan@citizen.gov',       role: 'citizen',   parkSlug: 'riverside-nature-reserve' },
  { name: 'Daniel Osei',      email: 'daniel.osei@citizen.gov',      role: 'citizen',   parkSlug: 'central-green-park' },
  { name: 'Meera Iyer',       email: 'meera.iyer@citizen.gov',       role: 'citizen',   parkSlug: 'lakeview-botanical-garden' },
  { name: 'Chen Wei',         email: 'chen.wei@citizen.gov',         role: 'citizen',   parkSlug: 'banyan-forest-park' },
];

// ---------------------------------------------------------------------------
// Asset templates
// ---------------------------------------------------------------------------

/** How many of each asset type to place, per park. */
const ASSET_PLAN = {
  tree: 14, plant: 5, bench: 8, light: 7, path: 2, lake: 0, structure: 2,
};

/** Lakes only exist where the park description says they do. */
const LAKE_PARKS = {
  'lakeview-botanical-garden': ['Mirror Lake', 'Lake Three'],
  'riverside-nature-reserve': ['Riverside Pond'],
};

const BENCH_MATERIALS = ['Reclaimed teak', 'Cast iron & wood', 'Precast concrete', 'Recycled plastic composite'];
const PATH_SURFACES = ['Compacted gravel', 'Paver blocks', 'Stabilised earth', 'Asphalt'];
const STRUCTURES = ['Restroom Block', 'Ranger Post', 'Seating Pavilion', 'Information Kiosk', 'Tool Shed'];

// ---------------------------------------------------------------------------
// Text fragments for generated records
// ---------------------------------------------------------------------------

const CITIZEN_ISSUES = [
  ['Broken bench near the play area', 'Two slats have snapped and there are exposed screws at child height.'],
  ['Overflowing bin at the east gate', 'The bin has not been emptied for several days and is attracting wasps.'],
  ['Path lighting not working', 'Three lights along this stretch are dark, which makes the path unsafe after sunset.'],
  ['Water stagnating beside the trail', 'A pool has formed after the rain and mosquitoes are breeding in it.'],
  ['Broken drinking water tap', 'The tap runs continuously and water is being wasted.'],
  ['Damaged fencing on the boundary', 'A section of fence is down and stray dogs are entering through the gap.'],
  ['Fallen branch blocking the walkway', 'A large branch came down in the wind and now blocks the route entirely.'],
  ['Litter accumulating near the lake', 'Plastic bottles and wrappers have collected along the water edge.'],
  ['Play equipment is unsafe', 'The swing chain is worn almost through on one side.'],
  ['Graffiti on the information board', 'The board has been sprayed over and the map is no longer readable.'],
];

const CITIZEN_FEEDBACK = [
  ['More native pollinator planting, please', 'Expanding the milkweed and basil beds would bring back the butterflies we used to see here.'],
  ['Thank you for the new bird hide', 'The hide at the reserve is excellent — we counted eleven species in an hour on Sunday.'],
  ['Please add a shaded seating area', 'The stretch between the gate and the lake has no shade at all in the afternoon.'],
  ['Signage for the trail would help', 'It is easy to lose the route where the path forks near the ridge.'],
  ['Consider a composting point', 'Garden waste is being burned at the boundary, which is unnecessary and smoky.'],
];

const INCIDENT_TEMPLATES = [
  { type: 'tree-fall', title: 'Large branch down across the trail', description: 'Storm damage has brought a limb across the path, blocking access entirely.', severity: 4, affected: 120 },
  { type: 'tree-fall', title: 'Tree leaning dangerously over the walkway', description: 'A gulmohar has developed a pronounced lean after heavy rain and root plate movement is visible.', severity: 4, affected: 200 },
  { type: 'illegal-dumping', title: 'Construction debris dumped at the boundary', description: 'Roughly three cubic metres of concrete rubble and rebar tipped overnight near the north fence.', severity: 3, affected: 40 },
  { type: 'illegal-dumping', title: 'Household waste dumped near the service gate', description: 'Several sacks of mixed household waste left beside the service entrance.', severity: 2, affected: 25 },
  { type: 'fire', title: 'Grass fire detected on the open ground', description: 'Early-stage grass fire spreading in dry conditions; smoke visible from the main gate.', severity: 5, affected: 800 },
  { type: 'water-pollution', title: 'Algal bloom across the lake surface', description: 'Dense green surface bloom consistent with nutrient runoff from the adjacent residential block.', severity: 4, affected: 350 },
  { type: 'water-pollution', title: 'Oil sheen at the storm drain outfall', description: 'A rainbow sheen is entering the lake at the inflow; source appears to be the road drain.', severity: 4, affected: 300 },
  { type: 'dead-animal', title: 'Dead bird found beneath the roost trees', description: 'Reported by morning walkers. Collected for disposal and noted for disease surveillance.', severity: 2, affected: 10 },
  { type: 'vandalism', title: 'Interpretation board damaged', description: 'The panel has been broken and the printed map torn away.', severity: 2, affected: 60 },
  { type: 'infrastructure-damage', title: 'Boundary wall section collapsed', description: 'A four-metre stretch of the compound wall has come down, leaving the site open.', severity: 3, affected: 150 },
  { type: 'air-pollution', title: 'Sustained particulate exceedance at the gate', description: 'The AQI sensor has been above the threshold continuously through the morning peak.', severity: 3, affected: 900 },
];

const WORK_ORDER_TEMPLATES = [
  { type: 'tree-trimming', title: 'Crown reduction and deadwood removal', hours: 6, cost: 4800 },
  { type: 'tree-trimming', title: 'Remove hazardous limb over the path', hours: 4, cost: 3600 },
  { type: 'cleaning', title: 'Weekly cleaning round — bins and restrooms', hours: 5, cost: 2200 },
  { type: 'cleaning', title: 'Litter clearance along the lake margin', hours: 4, cost: 1800 },
  { type: 'repair', title: 'Replace damaged bench slats', hours: 2, cost: 1200 },
  { type: 'repair', title: 'Solar light battery replacement', hours: 2, cost: 2600 },
  { type: 'repair', title: 'Re-gravel the eroded path section', hours: 8, cost: 9400 },
  { type: 'lake-cleaning', title: 'Water hyacinth removal', hours: 12, cost: 16500 },
  { type: 'lake-cleaning', title: 'Debris skim and water sampling', hours: 6, cost: 7200 },
  { type: 'inspection', title: 'Quarterly asset safety inspection', hours: 4, cost: 1500 },
  { type: 'inspection', title: 'Tree stability survey after the storm', hours: 6, cost: 3200 },
  { type: 'planting', title: 'Native pollinator bed extension', hours: 8, cost: 5600 },
  { type: 'irrigation', title: 'Repair the drip line to the nursery beds', hours: 3, cost: 2100 },
];

const MAINTENANCE_TYPES = ['Inspection', 'Pruning', 'Cleaning', 'Repair', 'Repainting', 'Irrigation'];
const TEAMS = ['Grounds Crew A', 'Grounds Crew B', 'Arboriculture Team', 'Aquatics Team', 'Electrical Team', 'Sanitation Team'];

/** Placeholder imagery, so the gallery views are not empty. */
const IMAGES = {
  tree: 'https://images.pexels.com/photos/1671325/pexels-photo-1671325.jpeg',
  bird: 'https://images.pexels.com/photos/326900/pexels-photo-326900.jpeg',
  butterfly: 'https://images.pexels.com/photos/4622246/pexels-photo-4622246.jpeg',
  mammal: 'https://images.pexels.com/photos/33196/shadow-dog-sharf-schnauzer-dog.jpg',
  plant: 'https://images.pexels.com/photos/4653778/pexels-photo-4653778.jpeg',
  reptile: 'https://images.pexels.com/photos/1170140/pexels-photo-1170140.jpeg',
  amphibian: 'https://images.pexels.com/photos/1170140/pexels-photo-1170140.jpeg',
  insect: 'https://images.pexels.com/photos/4622246/pexels-photo-4622246.jpeg',
  waste: 'https://images.pexels.com/photos/2662774/pexels-photo-2662774.jpeg',
  fire: 'https://images.pexels.com/photos/2699483/pexels-photo-2699483.jpeg',
  water: 'https://images.pexels.com/photos/1666435/pexels-photo-1666435.jpeg',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A GeoJSON Point scattered inside a park's boundary box. */
function pointInPark(park) {
  const [lng, lat] = park.location.coordinates;
  const half = park._halfWidth ?? 0.005;
  // 0.8 keeps the point comfortably inside the drawn boundary.
  return {
    type: 'Point',
    coordinates: [lng + rng.float(-half, half) * 0.8, lat + rng.float(-half, half) * 0.8],
  };
}

/** A LineString wandering across a park, used for trail geometry. */
function pathInPark(park, points = 6) {
  const [lng, lat] = park.location.coordinates;
  const half = park._halfWidth ?? 0.005;
  const coords = [];
  let x = lng - half * 0.7;
  let y = lat - half * 0.5;
  for (let i = 0; i < points; i += 1) {
    x += (half * 1.4) / points;
    y += rng.float(-half * 0.25, half * 0.3);
    coords.push([x, y]);
  }
  return { type: 'LineString', coordinates: coords };
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

function buildAssets(parks) {
  const docs = [];
  const counters = {};

  const PREFIX = { tree: 'TRE', plant: 'PLT', bench: 'BNC', lake: 'LAK', path: 'PTH', light: 'LGT', structure: 'STR' };
  const nextCode = (type) => {
    counters[type] = (counters[type] || 0) + 1;
    return `${PREFIX[type]}-${String(counters[type]).padStart(4, '0')}`;
  };

  const treeSpecies = SPECIES_SEEDS.filter((s) => s.class === 'tree');
  const plantSpecies = SPECIES_SEEDS.filter((s) => s.class === 'plant' && !s.isInvasive);

  for (const park of parks) {
    const plan = { ...ASSET_PLAN };
    const lakes = LAKE_PARKS[park.slug] || [];
    plan.lake = lakes.length;

    for (const [type, count] of Object.entries(plan)) {
      for (let i = 0; i < count; i += 1) {
        // Condition is drawn from a normal centred well but with a real left
        // tail, so "needs attention" filters return something.
        const condition = Math.max(12, Math.min(100, Math.round(rng.gaussian(76, 18))));

        const base = {
          assetCode: nextCode(type),
          type,
          park: park._id,
          location: pointInPark(park),
          condition,
          status: conditionToStatus(condition),
          installedAt: rng.pastDate(365 * 18, 60),
          attributes: {},
          maintenance: [],
          active: true,
        };

        if (type === 'tree') {
          const sp = rng.weighted(treeSpecies);
          const heightM = rng.float(4, 22);
          base.name = `${sp.commonName} #${counters[type]}`;
          base.attributes = {
            species: sp.scientificName,
            commonName: sp.commonName,
            heightM: heightM.toFixed(1),
            // Trunk diameter scaled off height — a crude allometry, but it
            // keeps the two numbers from contradicting each other.
            dbhCm: (heightM * rng.float(2.4, 3.6)).toFixed(0),
            canopySpreadM: (heightM * rng.float(0.5, 0.9)).toFixed(1),
          };
          base.images = [IMAGES.tree];
        } else if (type === 'plant') {
          const sp = rng.pick(plantSpecies);
          base.name = `${sp.commonName} Bed ${counters[type]}`;
          base.attributes = { species: sp.scientificName, areaSqM: String(rng.int(20, 240)) };
          base.images = [IMAGES.plant];
        } else if (type === 'bench') {
          base.name = `Bench ${base.assetCode.slice(-4)}`;
          base.attributes = { material: rng.pick(BENCH_MATERIALS), seats: String(rng.int(2, 4)) };
        } else if (type === 'light') {
          base.name = `Solar Light ${base.assetCode.slice(-4)}`;
          base.attributes = { fixture: 'Solar LED', watts: `${rng.pick([20, 30, 45])}W`, poleHeightM: '4.5' };
        } else if (type === 'path') {
          base.name = `${rng.pick(['Loop', 'Ridge', 'Lakeside', 'Grove', 'Summit'])} Trail`;
          base.path = pathInPark(park);
          base.attributes = {
            lengthKm: rng.float(0.8, 5.2).toFixed(1),
            surface: rng.pick(PATH_SURFACES),
            difficulty: rng.pick(['easy', 'easy', 'moderate']),
          };
        } else if (type === 'lake') {
          base.name = lakes[i];
          base.attributes = {
            depthM: rng.float(1.5, 5).toFixed(1),
            areaHa: rng.float(0.8, 4.2).toFixed(1),
            inflow: rng.pick(['Storm drain', 'Natural spring', 'Canal feed']),
          };
          base.images = [IMAGES.water];
        } else {
          base.name = `${rng.pick(STRUCTURES)} ${counters[type]}`;
          base.attributes = { areaSqM: String(rng.int(12, 90)) };
        }

        // Maintenance history — more entries for older assets.
        const historyCount = rng.int(0, 4);
        for (let m = 0; m < historyCount; m += 1) {
          base.maintenance.push({
            date: rng.pastDate(720, 20),
            type: rng.pick(MAINTENANCE_TYPES),
            description: `Routine ${rng.pick(MAINTENANCE_TYPES).toLowerCase()} carried out on schedule.`,
            cost: rng.int(200, 6000),
            technician: rng.pick(TEAMS),
          });
        }
        if (base.maintenance.length) {
          base.lastMaintenanceAt = base.maintenance
            .map((m) => m.date)
            .reduce((a, b) => (a > b ? a : b));
        }

        docs.push(base);
      }
    }
  }

  return docs;
}

function buildSensors(parks) {
  const docs = [];
  let counter = 0;

  /** Sensor mix per park: every park gets these types. */
  const TYPES = ['aqi', 'temperature', 'humidity', 'noise', 'soil'];

  for (const park of parks) {
    const types = [...TYPES];
    // Only parks with water bodies get a water-quality probe.
    if (LAKE_PARKS[park.slug]) types.push('water');

    for (const type of types) {
      counter += 1;
      const profile = SENSOR_PROFILES[type];
      const shortName = park.slug.split('-')[0].toUpperCase().slice(0, 5);

      docs.push({
        sensorCode: `${type.toUpperCase()}-${shortName}-${String(counter).padStart(2, '0')}`,
        name: `${type.toUpperCase()} · ${park.name}`,
        type,
        park: park._id,
        location: pointInPark(park),
        unit: profile.unit,
        minValue: profile.min,
        maxValue: profile.max,
        warnAbove: profile.warnAbove ?? null,
        warnBelow: profile.warnBelow ?? null,
        installedAt: rng.pastDate(900, 120),
        batteryLevel: rng.int(45, 100),
        firmware: `v${rng.int(1, 2)}.${rng.int(0, 9)}.${rng.int(0, 9)}`,
        // One sensor in the network is deliberately offline, so the "sensor
        // health" panel and the missing-data handling in the scoring service
        // both have something real to show.
        status: counter === 7 ? 'offline' : 'online',
        active: true,
      });
    }
  }

  return docs;
}

function buildObservations(parks, speciesDocs, users) {
  const docs = [];
  const parkBySlug = new Map(parks.map((p) => [p.slug, p]));
  const observers = users.filter((u) => u.role !== 'admin');

  const speciesBySlugAffinity = speciesDocs.map((doc) => {
    const seed = SPECIES_SEEDS.find((s) => s.scientificName === doc.scientificName);
    return { doc, weight: seed.weight, affinity: seed.parkAffinity, seasonality: seed.seasonality, class: doc.class };
  });

  // 420 observations spread over the last 14 months, so the seasonality and
  // biodiversity-trend charts both have a full annual cycle to plot.
  for (let i = 0; i < 420; i += 1) {
    const observedAt = rng.pastDate(425, 0);
    const month = observedAt.getMonth() + 1;

    // Only species that are actually present in that month, so the
    // seasonality chart shows genuine migration and flowering patterns.
    const inSeason = speciesBySlugAffinity.filter((s) => s.seasonality.includes(month));
    if (!inSeason.length) continue;

    const chosen = rng.weighted(inSeason);

    const candidateParks = chosen.affinity.length
      ? chosen.affinity.map((slug) => parkBySlug.get(slug)).filter(Boolean)
      : parks;
    const park = rng.pick(candidateParks);

    // Abundance depends on the taxon: you count one heron, but dozens of
    // milkweed stems. The ranges are kept within roughly one order of
    // magnitude of each other so a single cross-taxon Shannon index stays
    // interpretable — see the taxocene note in `biodiversity.service.js`.
    const countRanges = {
      bird: [1, 14], mammal: [1, 8], butterfly: [1, 35], reptile: [1, 5],
      amphibian: [1, 15], tree: [1, 40], plant: [3, 60], insect: [1, 30],
    };
    const [lo, hi] = countRanges[chosen.class] || [1, 10];
    const count = rng.int(lo, hi);

    const source = rng.chance(0.35) ? 'citizen-report' : rng.chance(0.15) ? 'camera-trap' : 'officer-survey';
    const observer = rng.pick(observers);

    docs.push({
      species: chosen.doc._id,
      park: park._id,
      observedAt,
      count,
      location: pointInPark(park),
      locationName: rng.pick(['Near the main gate', 'Lakeside path', 'Central lawn', 'Boundary hedge', 'Canopy walk', 'Pollinator beds']),
      observer: observer._id,
      observerName: observer.name,
      source,
      // Citizen submissions are only ~70 % verified, which is what makes the
      // "verified only" rule in the indices visible in the data.
      verified: source === 'citizen-report' ? rng.chance(0.7) : true,
      notes: '',
      images: rng.chance(0.3) ? [IMAGES[chosen.class] || IMAGES.tree] : [],
    });
  }

  return docs;
}

function buildCitizenReports(parks, users, speciesDocs) {
  const docs = [];
  const citizens = users.filter((u) => u.role === 'citizen');
  const year = new Date().getFullYear();
  let counter = 0;

  const push = (doc) => {
    counter += 1;
    docs.push({ ...doc, referenceCode: `CR-${year}-${String(counter).padStart(4, '0')}` });
  };

  // Issues
  for (let i = 0; i < 22; i += 1) {
    const [title, description] = rng.pick(CITIZEN_ISSUES);
    const park = rng.pick(parks);
    const citizen = rng.pick(citizens);
    const status = rng.pick(['submitted', 'submitted', 'in-review', 'accepted', 'resolved', 'resolved', 'rejected']);

    push({
      category: 'issue',
      title,
      description,
      park: park._id,
      location: pointInPark(park),
      submittedBy: citizen._id,
      submittedByName: citizen.name,
      status,
      upvotes: rng.int(0, 90),
      images: rng.chance(0.5) ? [IMAGES.waste] : [],
      createdAt: rng.pastDate(180, 0),
    });
  }

  // Wildlife sightings
  for (let i = 0; i < 14; i += 1) {
    const species = rng.pick(speciesDocs.filter((s) => ['bird', 'mammal', 'butterfly', 'reptile'].includes(s.class)));
    const park = rng.pick(parks);
    const citizen = rng.pick(citizens);

    push({
      category: 'wildlife-sighting',
      title: `${species.commonName} sighted`,
      description: `Spotted a ${species.commonName} while walking the trail. Photographed from a distance without disturbing it.`,
      park: park._id,
      location: pointInPark(park),
      submittedBy: citizen._id,
      submittedByName: citizen.name,
      species: species._id,
      status: rng.pick(['submitted', 'in-review', 'accepted', 'accepted', 'resolved']),
      upvotes: rng.int(2, 120),
      images: [IMAGES[species.class] || IMAGES.bird],
      createdAt: rng.pastDate(180, 0),
    });
  }

  // Feedback and suggestions
  for (const [title, description] of CITIZEN_FEEDBACK) {
    const park = rng.pick(parks);
    const citizen = rng.pick(citizens);
    push({
      category: rng.chance(0.5) ? 'feedback' : 'suggestion',
      title,
      description,
      park: park._id,
      location: pointInPark(park),
      submittedBy: citizen._id,
      submittedByName: citizen.name,
      status: rng.pick(['submitted', 'in-review', 'accepted']),
      upvotes: rng.int(5, 140),
      images: [],
      createdAt: rng.pastDate(200, 0),
    });
  }

  return docs;
}

function buildIncidents(parks, users) {
  const docs = [];
  const officers = users.filter((u) => ['officer', 'ecologist'].includes(u.role));
  const year = new Date().getFullYear();

  for (let i = 0; i < 34; i += 1) {
    const template = rng.pick(INCIDENT_TEMPLATES);
    const park = rng.pick(parks);
    const reportedAt = rng.pastDate(200, 0);

    // Older incidents are far more likely to be closed out; recent ones are
    // still moving. This is what gives the resolution-time analytics a
    // realistic distribution instead of a uniform one.
    const ageDays = (Date.now() - reportedAt) / 86_400_000;
    let status =
      ageDays > 60 ? rng.pick(['resolved', 'resolved', 'closed'])
      : ageDays > 20 ? rng.pick(['resolved', 'in-progress', 'assigned'])
      : rng.pick(['reported', 'assigned', 'in-progress']);

    // A fire has a 30-minute response target. Leaving one open for days would
    // put an implausible record at the top of the triage queue and undermine
    // the very ordering the queue exists to demonstrate.
    if (template.type === 'fire' && ageDays > 0.5) status = rng.pick(['resolved', 'closed']);

    const isClosed = ['resolved', 'closed'].includes(status);
    const officer = ['reported'].includes(status) ? null : rng.pick(officers);

    const severity = Math.max(1, Math.min(5, template.severity + rng.int(-1, 1)));
    const affectedPeople = Math.round(template.affected * rng.float(0.5, 1.6));

    // Upvotes are a property of the linked citizen report, not of the incident
    // itself. Scoring with a value that is never stored would make the cached
    // `priorityScore` irreproducible — the triage endpoint recomputes from the
    // incident's own fields and the two must agree.
    const triage = scoreIncident(
      { type: template.type, severity, affectedPeople, upvotes: 0, reportedAt, status },
      new Date()
    );

    const timeline = [
      { status: 'reported', note: 'Incident opened', byName: 'System', at: reportedAt },
    ];
    if (officer) {
      timeline.push({
        status: 'assigned',
        note: `Assigned to ${officer.name}`,
        by: officer._id,
        byName: officer.name,
        at: new Date(reportedAt.getTime() + rng.float(0.2, 8) * 3_600_000),
      });
    }

    let resolvedAt = null;
    let resolutionMinutes = null;
    if (isClosed) {
      const hours = rng.float(1, 96);
      resolvedAt = new Date(reportedAt.getTime() + hours * 3_600_000);
      resolutionMinutes = Math.round(hours * 60);
      timeline.push({
        status,
        note: 'Work completed and site cleared.',
        by: officer?._id || null,
        byName: officer?.name || 'System',
        at: resolvedAt,
      });
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
      source: rng.pick(['citizen-report', 'officer-patrol', 'officer-patrol', 'sensor-alert', 'ai-detection']),
      affectedPeople,
      severity,
      assignedTo: officer?._id || null,
      assignedAt: officer ? new Date(reportedAt.getTime() + 3_600_000) : null,
      reportedAt,
      resolvedAt,
      resolutionMinutes,
      resolutionNotes: isClosed ? 'Site inspected, hazard removed and area returned to normal use.' : '',
      images: rng.chance(0.45) ? [template.type === 'fire' ? IMAGES.fire : IMAGES.waste] : [],
      timeline,
    });
  }

  return docs;
}

function buildWorkOrders(parks, users, assets, incidents) {
  const docs = [];
  const staff = users.filter((u) => ['officer', 'ecologist'].includes(u.role));
  const year = new Date().getFullYear();

  // Assets in poor condition are the ones that generate work, so the
  // maintenance queue and the asset register tell the same story.
  const needsWork = assets.filter((a) => a.condition < 60);

  for (let i = 0; i < 38; i += 1) {
    const template = rng.pick(WORK_ORDER_TEMPLATES);
    const targetAsset = rng.chance(0.6) && needsWork.length ? rng.pick(needsWork) : null;
    const park = targetAsset
      ? parks.find((p) => String(p._id) === String(targetAsset.park))
      : rng.pick(parks);

    // A third of orders are historical, the rest upcoming.
    const scheduledDate = rng.chance(0.35) ? rng.pastDate(120, 1) : rng.futureDate(45);
    const isPast = scheduledDate < new Date();

    const status = isPast
      ? rng.pick(['completed', 'completed', 'completed', 'overdue'])
      : rng.pick(['scheduled', 'scheduled', 'in-progress']);

    const progress = status === 'completed' ? 100 : status === 'in-progress' ? rng.int(15, 85) : 0;
    const assignee = rng.chance(0.7) ? rng.pick(staff) : null;

    // A small number of orders trace back to a resolved incident.
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
      recurrence: template.type === 'cleaning' || template.type === 'inspection' ? rng.pick(['weekly', 'monthly', 'quarterly']) : 'none',
      completionNotes: status === 'completed' ? 'Completed and signed off by the supervising officer.' : '',
    });
  }

  return docs;
}

async function buildAiDetections(parks, users) {
  const docs = [];
  const staff = users.filter((u) => u.role !== 'citizen');
  const tasks = Object.keys(TASK_CLASSES);

  for (let i = 0; i < 30; i += 1) {
    const task = rng.pick(tasks);
    const park = rng.pick(parks);

    // Distinct image identifiers so the deterministic surrogate produces a
    // spread of predictions rather than the same class thirty times.
    const imageName = `field-capture-${task}-${i + 1}.jpg`;
    const imageUrl =
      task === 'fire' ? IMAGES.fire
      : task === 'waste' ? IMAGES.waste
      : task === 'wildlife' ? IMAGES.bird
      : task === 'plant-id' ? IMAGES.plant
      : IMAGES.tree;

    // The surrogate keys on the identifier, so vary it per record.
    const result = await runInference(task, `${imageUrl}#${imageName}`);

    const reviewStatus = rng.chance(0.5)
      ? rng.chance(0.82) ? 'confirmed' : 'rejected'
      : 'pending';

    docs.push({
      task,
      imageUrl,
      imageName,
      park: park._id,
      location: pointInPark(park),
      prediction: result.prediction,
      confidence: result.confidence,
      probabilities: result.probabilities,
      severity: result.severity,
      recommendedAction: result.recommendedAction,
      modelName: result.model.name,
      modelVersion: result.model.version,
      inferenceMs: Math.round(rng.float(38, 180)),
      submittedBy: rng.pick(staff)._id,
      reviewStatus,
      correctedLabel: reviewStatus === 'rejected' ? rng.pick(TASK_CLASSES[task]).label : '',
      createdAt: rng.pastDate(120, 0),
    });
  }

  return docs;
}

function buildEcoReports(parks, users) {
  const authors = users.filter((u) => ['ecologist', 'admin'].includes(u.role));

  const TEMPLATES = [
    { type: 'ecosystem', title: 'Quarterly Ecosystem Assessment', findings: ['Composite health index improved by 3.4 points over the quarter.', 'Air quality remains the weakest sub-index at every site adjacent to an arterial road.'], recommendations: ['Extend the roadside buffer planting along the eastern boundary.', 'Add a second AQI sensor at the main gate to separate gate-line and interior readings.'] },
    { type: 'biodiversity', title: 'Annual Biodiversity Census', findings: ['Species richness rose from 21 to 26 across the network.', 'Pielou evenness fell slightly, driven by an increase in Common Myna abundance.'], recommendations: ['Prioritise native understorey planting over further canopy additions.', 'Continue the milkweed programme; Plain Tiger counts track it closely.'] },
    { type: 'water', title: 'Lake Water Quality Review', findings: ['Two algal bloom events were recorded, both following heavy rainfall.', 'Water hyacinth cover reached 18 % of the surface at its peak.'], recommendations: ['Install a vegetated buffer strip at the storm drain inflow.', 'Schedule hyacinth removal before, not after, the monsoon.'] },
    { type: 'air', title: 'Particulate Exposure Study', findings: ['Peak AQI consistently coincides with the 08:00–10:00 traffic window.', 'Interior readings run 22 % lower than gate-line readings.'], recommendations: ['Relocate the children\'s play area away from the gate-line.', 'Publish a daily air quality advisory at the entrance.'] },
    { type: 'maintenance', title: 'Asset Condition and Maintenance Audit', findings: ['Mean asset condition is 74/100; solar lighting is the weakest class.', 'Overdue work orders concentrate in a single park.'], recommendations: ['Move lighting maintenance from reactive to a scheduled six-month cycle.', 'Rebalance crew allocation towards the park carrying the overdue backlog.'] },
    { type: 'engagement', title: 'Citizen Participation Report', findings: ['Citizen submissions rose 41 % year on year.', 'Wildlife sightings now account for a third of all submissions.'], recommendations: ['Reduce the review turnaround, which currently averages six days.', 'Publish accepted sightings on the public map to close the feedback loop.'] },
    { type: 'soil', title: 'Soil Moisture and Compaction Survey', findings: ['Moisture on desire lines is 38 % below adjacent planted areas.', 'Compaction is measurably worse at all three main entrances.'], recommendations: ['Mulch and rope off the worst desire lines through one growing season.', 'Introduce permeable surfacing at the entrances.'] },
  ];

  return TEMPLATES.map((template, index) => {
    const author = rng.pick(authors);
    const park = rng.chance(0.7) ? rng.pick(parks) : null;
    const periodEnd = rng.pastDate(120, 5);
    const periodStart = new Date(periodEnd.getTime() - 90 * 86_400_000);

    return {
      title: `${template.title} — ${park ? park.name : 'Network-wide'}`,
      type: template.type,
      summary: `${template.title} covering the period ${periodStart.toDateString()} to ${periodEnd.toDateString()}.`,
      park: park?._id || null,
      author: author._id,
      authorName: author.name,
      periodStart,
      periodEnd,
      metrics: {
        ecosystemHealth: Math.round(rng.float(58, 88) * 10) / 10,
        biodiversityScore: Math.round(rng.float(45, 80) * 10) / 10,
        incidentsResolved: rng.int(4, 22),
        citizenReports: rng.int(6, 40),
      },
      findings: template.findings,
      recommendations: template.recommendations,
      status: index < 5 ? 'published' : rng.pick(['draft', 'archived']),
      publishedAt: index < 5 ? periodEnd : null,
      createdAt: periodEnd,
    };
  });
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Wipe and regenerate the demonstration dataset.
 *
 * @param {object} [options]
 * @param {boolean} [options.force=false] Drop existing data first
 * @param {boolean} [options.quiet=false] Suppress progress logging
 * @returns {Promise<object>} Row counts per collection
 */
async function seedDatabase({ force = false, quiet = false } = {}) {
  const say = quiet ? () => {} : (msg) => logger.info(`  ${msg}`);

  const COLLECTIONS = [
    User, Park, Asset, Species, Observation, Sensor, SensorReading,
    CitizenReport, Incident, WorkOrder, AiDetection, Alert, EcoReport,
    AuditLog, ChatMessage,
  ];

  if (force) {
    say('Clearing existing collections…');
    await Promise.all(COLLECTIONS.map((model) => model.deleteMany({})));
    await Setting.deleteMany({});
  }

  // --- Settings ------------------------------------------------------------
  await Setting.current();

  // --- Parks ---------------------------------------------------------------
  say('Creating parks…');
  const parkDocs = await Park.insertMany(
    PARK_SEEDS.map(({ _centre, _halfWidth, ...park }) => park)
  );
  // Re-attach the generator metadata that is not part of the schema.
  const parks = parkDocs.map((doc, i) => {
    const plain = doc.toObject();
    plain._id = doc._id;
    plain._halfWidth = PARK_SEEDS[i]._halfWidth;
    return plain;
  });

  // --- Users ---------------------------------------------------------------
  say('Creating users…');
  const parkBySlug = new Map(parks.map((p) => [p.slug, p]));
  const users = [];
  for (const seed of USER_SEEDS) {
    // `create`, not `insertMany`, so the password-hashing pre-save hook runs.
    const user = await User.create({
      name: seed.name,
      email: seed.email,
      password: DEMO_PASSWORD,
      role: seed.role,
      park: parkBySlug.get(seed.parkSlug)?._id || null,
      active: true,
      contributions: seed.role === 'citizen' ? rng.int(4, 60) : rng.int(20, 300),
      lastLoginAt: rng.pastDate(14, 0),
    });
    users.push(user);
  }

  // --- Species -------------------------------------------------------------
  say('Creating species catalogue…');
  const speciesDocs = await Species.insertMany(
    SPECIES_SEEDS.map((s) => ({
      commonName: s.commonName,
      scientificName: s.scientificName,
      class: s.class,
      family: s.family,
      conservationStatus: s.conservationStatus,
      habitat: s.habitat,
      description: s.description,
      isInvasive: Boolean(s.isInvasive),
      isIndicator: Boolean(s.isIndicator),
      seasonality: s.seasonality,
      parks: [],
      images: [IMAGES[s.class] || IMAGES.tree],
    }))
  );

  // --- Assets --------------------------------------------------------------
  say('Placing park assets…');
  const assetDocs = await Asset.insertMany(buildAssets(parks));

  // --- Sensors and their history ------------------------------------------
  say('Deploying sensors…');
  const sensorDocs = await Sensor.insertMany(buildSensors(parks));

  say('Backfilling 48 hours of sensor readings…');
  let readingCount = 0;
  for (const sensor of sensorDocs) {
    if (sensor.status === 'offline') continue;
    readingCount += await backfillHistory(sensor, 48, 30);
  }

  // --- Observations --------------------------------------------------------
  say('Recording species observations…');
  const observationDocs = await Observation.insertMany(buildObservations(parks, speciesDocs, users));

  // Populate each species' park list from where it was actually observed.
  const parksBySpecies = new Map();
  for (const obs of observationDocs) {
    const key = String(obs.species);
    if (!parksBySpecies.has(key)) parksBySpecies.set(key, new Set());
    parksBySpecies.get(key).add(String(obs.park));
  }
  await Promise.all(
    [...parksBySpecies.entries()].map(([speciesId, parkIds]) =>
      Species.updateOne({ _id: speciesId }, { $set: { parks: [...parkIds] } })
    )
  );

  // --- Citizen reports -----------------------------------------------------
  say('Adding citizen reports…');
  const reportDocs = await CitizenReport.insertMany(buildCitizenReports(parks, users, speciesDocs));

  // --- Incidents -----------------------------------------------------------
  say('Generating incidents…');
  const incidentDocs = await Incident.insertMany(buildIncidents(parks, users));

  // Link a few accepted issue reports to incidents, so the citizen → incident
  // trail is visible in the demonstration data.
  const acceptedIssues = reportDocs.filter((r) => r.category === 'issue' && ['accepted', 'resolved'].includes(r.status));
  for (let i = 0; i < Math.min(acceptedIssues.length, 6); i += 1) {
    const incident = incidentDocs[i];
    await CitizenReport.updateOne({ _id: acceptedIssues[i]._id }, { $set: { linkedIncident: incident._id } });
    await Incident.updateOne(
      { _id: incident._id },
      { $set: { sourceReport: acceptedIssues[i]._id, source: 'citizen-report' } }
    );
  }

  // --- Work orders ---------------------------------------------------------
  say('Scheduling maintenance work orders…');
  const workOrderDocs = await WorkOrder.insertMany(buildWorkOrders(parks, users, assetDocs, incidentDocs));

  // --- AI detections -------------------------------------------------------
  say('Running the AI detection backlog…');
  const detectionDocs = await AiDetection.insertMany(await buildAiDetections(parks, users));

  // --- Reports -------------------------------------------------------------
  say('Publishing ecological reports…');
  const ecoReportDocs = await EcoReport.insertMany(buildEcoReports(parks, users));

  // --- Alerts --------------------------------------------------------------
  // Alerts are derived, not authored: raise one per unresolved high-priority
  // incident and per sensor currently outside its thresholds.
  say('Raising alerts from the current state…');
  const alertDocs = [];

  for (const incident of incidentDocs) {
    if (['resolved', 'closed'].includes(incident.status)) continue;
    if (!['high', 'critical'].includes(incident.priority)) continue;
    alertDocs.push({
      title: `${incident.priority === 'critical' ? 'CRITICAL' : 'High priority'}: ${incident.title}`,
      message: `Reference ${incident.referenceCode}. Triage score ${incident.priorityScore}/100.`,
      module: 'Incident Management',
      source: 'incident',
      severity: incident.priority,
      status: rng.chance(0.6) ? 'active' : 'acknowledged',
      park: incident.park,
      relatedModel: 'Incident',
      relatedId: incident._id,
      dedupeKey: `incident:${incident._id}`,
      createdAt: incident.reportedAt,
    });
  }

  const refreshedSensors = await Sensor.find({ active: true });
  for (const sensor of refreshedSensors) {
    // An offline sensor has no reading to evaluate. Testing its cached zero
    // against the thresholds would flip it to 'warning' and erase the one
    // deliberately offline device the sensor-health panel exists to show.
    if (sensor.status === 'offline') continue;

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
    });
    await Sensor.updateOne({ _id: sensor._id }, { $set: { status: 'warning' } });
  }

  if (alertDocs.length) await Alert.insertMany(alertDocs);

  // --- Derived scores ------------------------------------------------------
  say('Computing ecosystem health indices…');
  const scores = await refreshAllParkScores();

  await AuditLog.create({
    action: 'seed',
    entity: 'Database',
    entityLabel: 'demonstration dataset generated',
    actorName: 'Seed script',
    actorRole: 'system',
  });

  return {
    parks: parks.length,
    users: users.length,
    species: speciesDocs.length,
    assets: assetDocs.length,
    sensors: sensorDocs.length,
    readings: readingCount,
    observations: observationDocs.length,
    citizenReports: reportDocs.length,
    incidents: incidentDocs.length,
    workOrders: workOrderDocs.length,
    aiDetections: detectionDocs.length,
    ecoReports: ecoReportDocs.length,
    alerts: alertDocs.length,
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
    logger.warn('Set MONGODB_URI in server/.env to seed a persistent database.');
  }

  logger.info('Seeding the demonstration dataset…');
  const summary = await seedDatabase({ force: true });

  logger.success('Seed complete.');
  console.table({
    Parks: summary.parks,
    Users: summary.users,
    Species: summary.species,
    Assets: summary.assets,
    Sensors: summary.sensors,
    'Sensor readings': summary.readings,
    Observations: summary.observations,
    'Citizen reports': summary.citizenReports,
    Incidents: summary.incidents,
    'Work orders': summary.workOrders,
    'AI detections': summary.aiDetections,
    Reports: summary.ecoReports,
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

'use strict';

/**
 * Module 11 — AI Environmental Assistant: the data tools.
 *
 * Every fact the Eco Assistant states comes from one of these read-only
 * lookups, whichever engine is answering: the language model calls them as
 * tools (Gemini, Groq, a local model or Claude — see llm-provider), and the
 * built-in engine calls them directly. Keeping one implementation means both
 * engines see the same figures and, more importantly, obey the same access
 * rules.
 *
 * ---------------------------------------------------------------------------
 * Access
 * ---------------------------------------------------------------------------
 * The rules are enforced here, from the signed-in user, never left to the
 * language model's judgement:
 *
 *   guest    public data — parks, conditions, sensors, biodiversity, alerts,
 *            aggregate counts
 *   citizen  the same, plus the status of their own reports
 *   officer  operational records (incidents, work orders), their own tasks and
 *            the review queues
 *   admin    everything, including staff names and anyone's tasks
 *
 * A tool a role may not use is not offered to the model at all, and a call that
 * reaches one anyway is refused with a plain-language explanation.
 */

const mongoose = require('mongoose');
const {
  Park, Incident, WorkOrder, Alert, Sensor, CitizenReport, Observation, AiDetection, Species, User,
} = require('../models');
const { computeEcosystemHealth } = require('./ecosystem-score.service');
const { analyseBiodiversity } = require('./biodiversity.service');
const { describeAqi } = require('./aqi.service');
const external = require('./external.service');
const logger = require('../utils/logger');

// ---------------------------------------------------------------------------
// Context and access levels
// ---------------------------------------------------------------------------

const LEVELS = { guest: 0, citizen: 1, officer: 2, admin: 3 };

/** The access level of a user document (or none). Unknown roles get citizen access. */
function accessOf(user) {
  if (!user) return 'guest';
  if (user.role === 'admin') return 'admin';
  if (user.role === 'officer') return 'officer';
  return 'citizen';
}

const can = (ctx, level) => LEVELS[ctx?.access || 'guest'] >= LEVELS[level];
const isStaff = (ctx) => can(ctx, 'officer');

/**
 * Who is asking, as the tools need it: id, name, access level and home park.
 *
 * @param {object|null} user a User document or lean object, or null for a guest
 * @returns {Promise<{access:string, user:null|{id:string,name:string,role:string}, homePark:null|{_id:any,name:string,slug:string}}>}
 */
async function buildContext(user) {
  const access = accessOf(user);
  if (!user) return { access, user: null, homePark: null };

  let homePark = null;
  const parkRef = user.park && typeof user.park === 'object' && user.park.name ? user.park : null;
  if (parkRef) homePark = { _id: parkRef._id, name: parkRef.name, slug: parkRef.slug };
  else if (user.park) homePark = await Park.findById(user.park).select('name slug location').lean();

  return {
    access,
    user: { id: String(user._id), name: user.name || 'you', role: access },
    homePark,
  };
}

/** A failure the user should be told about verbatim (not a crash). */
function toolError(message) {
  const err = new Error(message);
  err.toolError = true;
  return err;
}

const STAFF_ONLY = 'That information is only available to park staff (officers and administrators).';

// ---------------------------------------------------------------------------
// Park name matching
// ---------------------------------------------------------------------------

/** Words that appear in many park names and so identify none of them. */
const GENERIC_WORDS = new Set([
  'park', 'parks', 'garden', 'gardens', 'botanical', 'the', 'of', 'lake', 'tank', 'reserve', 'grounds', 'at', 'in',
]);

const words = (text) =>
  String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter(Boolean);

function levenshtein(a, b) {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const temp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = temp;
    }
  }
  return prev[b.length];
}

/** How well one query word matches one park-name word, 0–1. */
function wordMatch(q, w) {
  if (q === w) return 1;
  if (q.length >= 3 && w.startsWith(q)) return 0.85;
  const distance = levenshtein(q, w);
  if (q.length >= 4 && distance <= 1) return 0.75;
  if (q.length >= 7 && distance <= 2) return 0.6;
  return 0;
}

const distinctiveWords = (park) => {
  const all = words(park.name);
  const distinct = all.filter((w) => !GENERIC_WORDS.has(w));
  return distinct.length ? distinct : all;
};

/**
 * Score how well a free-text reference ("cubbon", "lal bagh", "Sankey tank")
 * names a park, 0–1.
 */
function scorePark(reference, park) {
  const ref = String(reference || '').trim().toLowerCase();
  if (!ref) return 0;
  if (ref === park.slug || ref === park.name.toLowerCase() || ref.replace(/\s+/g, '-') === park.slug) return 1;

  const query = words(ref).filter((w) => !GENERIC_WORDS.has(w));
  if (!query.length) return 0;
  const target = distinctiveWords(park);

  const perWord = query.reduce((sum, q) => sum + Math.max(...target.map((w) => wordMatch(q, w))), 0) / query.length;
  // "lal bagh" → "lalbagh": compare the words run together as well.
  const joined = Math.max(...target.map((w) => wordMatch(query.join(''), w)));
  return Math.max(perWord, joined);
}

const MATCH_THRESHOLD = 0.5;

let parkCache = { at: 0, parks: [] };
async function activeParks() {
  if (Date.now() - parkCache.at > 30_000 || !parkCache.parks.length) {
    parkCache = { at: Date.now(), parks: await Park.find({ active: true }).select('name slug location areaAcres manager').lean() };
  }
  return parkCache.parks;
}

/** Test seam: forget the cached park list. */
const clearParkCache = () => {
  parkCache = { at: 0, parks: [] };
};

const MY_PARK = /^(my|our|home|my home|my own)( park)?$/i;

/**
 * Resolve a park reference to a park. Empty input means "all parks" (null);
 * "my park" means the user's home park. Throws a tool error naming the
 * monitored parks when nothing matches.
 */
async function findPark(reference, ctx) {
  if (reference === undefined || reference === null || !String(reference).trim()) return null;
  const text = String(reference).trim();

  if (MY_PARK.test(text)) {
    if (ctx?.homePark) return ctx.homePark;
    throw toolError('No home park is set on this account, so "my park" cannot be resolved. Name the park instead.');
  }

  const parks = await activeParks();
  const ranked = parks
    .map((park) => ({ park, score: scorePark(text, park) }))
    .filter((r) => r.score >= MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score);

  if (!ranked.length) {
    throw toolError(`No park matches "${text}". Monitored parks: ${parks.map((p) => p.name).join(', ')}.`);
  }
  return ranked[0].park;
}

/**
 * Find the park a question mentions, if any: "…at Cubbon Park", "cubon",
 * "my park". Used by the built-in engine, which has no model to extract it.
 */
async function findParkInText(text, ctx) {
  const lower = String(text || '').toLowerCase();
  if (/\b(my|our) (home )?park\b/.test(lower) && ctx?.homePark) return ctx.homePark;

  const tokens = words(lower).filter((w) => !GENERIC_WORDS.has(w));
  // Adjacent pairs catch a name typed as two words ("lal bagh").
  const candidates = [...tokens, ...tokens.slice(1).map((t, i) => tokens[i] + t)];
  const parks = await activeParks();

  let best = null;
  for (const park of parks) {
    if (lower.includes(park.name.toLowerCase())) return park;
    const target = distinctiveWords(park);
    let score = 0;
    for (const candidate of candidates) {
      // Short words only match exactly ("jp"), or every "is" would match something.
      const s = Math.max(...target.map((w) => (candidate.length < 4 ? (candidate === w ? 1 : 0) : wordMatch(candidate, w))));
      // A prefix match on a short fragment is too loose for free text.
      if (s >= 0.75) score = Math.max(score, s);
    }
    if (score && (!best || score > best.score)) best = { park, score };
  }
  return best ? best.park : null;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const round1 = (v) => (v === null || v === undefined || Number.isNaN(v) ? null : Math.round(v * 10) / 10);
const parkName = (p) => (p && typeof p === 'object' && p.name ? p.name : undefined);
const scopeOf = (park) => (park ? park.name : 'All parks');
const cite = (label, entity, id, score = 1) => ({ label: String(label || entity), entity, entityId: String(id), score });

const PRIORITY_ORDER = ['low', 'medium', 'high', 'critical'];
const priorityRank = (p) => PRIORITY_ORDER.indexOf(p);

/**
 * A priority filter from tool input: `priority` picks one level exactly,
 * `minPriority` that level and above ("high" → high and critical).
 */
function priorityFilter({ priority, minPriority } = {}) {
  const exact = PRIORITY_ORDER.includes(String(priority || '').toLowerCase()) ? String(priority).toLowerCase() : null;
  const min = PRIORITY_ORDER.includes(String(minPriority || '').toLowerCase()) ? String(minPriority).toLowerCase() : null;
  if (exact) return { $in: [exact] };
  if (min) return { $in: PRIORITY_ORDER.slice(priorityRank(min)) };
  return null;
}

const describeFilter = ({ priority, minPriority } = {}) => {
  if (PRIORITY_ORDER.includes(String(priority || '').toLowerCase())) return `${String(priority).toLowerCase()} priority`;
  if (String(minPriority || '').toLowerCase() === 'critical') return 'critical priority';
  if (PRIORITY_ORDER.includes(String(minPriority || '').toLowerCase())) return `${String(minPriority).toLowerCase()} priority and above`;
  return null;
};

const OPEN_WORK_STATUSES = ['scheduled', 'in-progress', 'overdue'];
const CLOSED_INCIDENT_STATUSES = ['resolved', 'closed'];

/** Aggregation pipelines skip Mongoose casting, so ids must be real ObjectIds. */
const oid = (id) => new mongoose.Types.ObjectId(String(id));

const daysSince = (date) => (date ? Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000)) : null);

const countBy = (rows, key) =>
  rows.reduce((acc, row) => {
    const k = row[key] ?? 'unknown';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

/** Mongo aggregation `$group` counts as a plain object. */
async function groupCount(Model, match, field) {
  const rows = await Model.aggregate([{ $match: match }, { $group: { _id: `$${field}`, count: { $sum: 1 } } }]);
  return Object.fromEntries(rows.map((r) => [r._id ?? 'unknown', r.count]));
}

/** Open-Meteo pollutant keys as people write them. */
const POLLUTANT_NAMES = { pm2_5: 'PM2.5', pm25: 'PM2.5', pm10: 'PM10', o3: 'ozone (O₃)', no2: 'NO₂', so2: 'SO₂', co: 'CO', nh3: 'NH₃' };
const pollutantName = (key) => (key ? POLLUTANT_NAMES[String(key).toLowerCase()] || String(key).toUpperCase() : null);

const isOverdue = (o) =>
  o.status === 'overdue' || (o.status === 'scheduled' && o.scheduledDate && new Date(o.scheduledDate).getTime() < Date.now());

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const PARK_PARAM = {
  type: 'string',
  description: 'Park name, partial name or slug — e.g. "Cubbon Park", "cubbon", "lalbagh" — or "my park" for the user\'s home park. Omit for all parks combined.',
};
const PRIORITY_PARAM = { type: 'string', enum: PRIORITY_ORDER, description: 'Only this exact priority.' };
const MIN_PRIORITY_PARAM = {
  type: 'string',
  enum: PRIORITY_ORDER,
  description: 'This priority and above, e.g. "high" returns high and critical. Use this for "high priority" questions.',
};

/**
 * `access` is the lowest level allowed to call the tool. A tool open to guests
 * may still return less to them — e.g. counts instead of incident details.
 */
const DEFINITIONS = [
  {
    access: 'guest',
    name: 'find_parks',
    description: 'List the monitored parks with area, managing authority and current Ecosystem Health score (0–100), healthiest first. Pass `query` to look a park up by a partial or misspelt name ("cubbon" → Cubbon Park).',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Optional partial park name to look up.' } },
      additionalProperties: false,
    },
  },
  {
    access: 'guest',
    name: 'get_park_conditions',
    description: 'Current climate and environmental conditions at a park: live weather (condition, temperature, feels-like, humidity, wind, UV) and air quality (CPCB AQI, category, main pollutant) from Open-Meteo, plus the latest reading of every park sensor (AQI, temperature, humidity, noise, soil moisture, water quality). Use for "what is the climate / weather / condition at X".',
    input_schema: { type: 'object', properties: { park: PARK_PARAM }, additionalProperties: false },
  },
  {
    access: 'guest',
    name: 'get_ecosystem_health',
    description: 'Ecosystem Health score (0–100) and grade for one park or all parks, with the score of each indicator: air quality, water quality, soil health, tree health and biodiversity.',
    input_schema: { type: 'object', properties: { park: PARK_PARAM }, additionalProperties: false },
  },
  {
    access: 'guest',
    name: 'get_biodiversity',
    description: 'Biodiversity summary for a park or all parks: species recorded, observation records, threatened species, invasive records, breakdown by group (birds, plants, insects…) and the most frequently recorded species.',
    input_schema: { type: 'object', properties: { park: PARK_PARAM }, additionalProperties: false },
  },
  {
    access: 'guest',
    name: 'search_species',
    description: 'Look up a species by common or scientific name (partial names work): its group, IUCN status, whether it is invasive, habitat, and which parks it has been recorded in with how many verified records.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Species name, e.g. "kingfisher" or "Ficus".' }, park: PARK_PARAM },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    access: 'guest',
    name: 'get_sensors',
    description: 'Park sensors with their latest reading, unit, status (online, warning, offline) and reading time. Types: aqi, temperature, humidity, noise, soil, water.',
    input_schema: {
      type: 'object',
      properties: {
        park: PARK_PARAM,
        type: { type: 'string', enum: ['aqi', 'temperature', 'humidity', 'noise', 'soil', 'water'], description: 'Optional sensor type.' },
      },
      additionalProperties: false,
    },
  },
  {
    access: 'guest',
    name: 'get_alerts',
    description: 'Active and acknowledged alerts raised by sensors, AI image analysis and incident escalation, most recent first, with a count by severity.',
    input_schema: {
      type: 'object',
      properties: { park: PARK_PARAM, severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] } },
      additionalProperties: false,
    },
  },
  {
    access: 'guest',
    name: 'get_incidents',
    description: 'Open incidents (pollution, dumping, damage, hazards…). Staff get the list ranked by priority score with reference, type, status, park and who it is assigned to; the public gets only the counts by priority. Filter by park, priority, status, or only those assigned to the current user.',
    input_schema: {
      type: 'object',
      properties: {
        park: PARK_PARAM,
        priority: PRIORITY_PARAM,
        minPriority: MIN_PRIORITY_PARAM,
        status: { type: 'string', enum: ['reported', 'assigned', 'in-progress'], description: 'Only this open status.' },
        assignedToMe: { type: 'boolean', description: 'Only incidents assigned to the current user.' },
        limit: { type: 'integer', minimum: 1, maximum: 25, description: 'Maximum incidents to list (default 10).' },
      },
      additionalProperties: false,
    },
  },
  {
    access: 'guest',
    name: 'get_maintenance',
    description: 'Maintenance work orders: counts by status and priority and how many are overdue. Administrators also get every open work order, soonest first, with type, priority, scheduled date, team and assignee; a park officer gets only the work orders assigned to them; the public gets the counts only.',
    input_schema: {
      type: 'object',
      properties: {
        park: PARK_PARAM,
        priority: PRIORITY_PARAM,
        minPriority: MIN_PRIORITY_PARAM,
        overdueOnly: { type: 'boolean', description: 'Only overdue work orders.' },
      },
      additionalProperties: false,
    },
  },
  {
    access: 'officer',
    name: 'get_my_tasks',
    description: 'Tasks assigned to the current user: open work orders (WorkOrder.assignedTo) and open incidents assigned to them, highest priority first, with overdue flags. Use for "my tasks", "assigned to me", "what should I work on". Administrators may pass `assignee` to see a named staff member\'s tasks.',
    input_schema: {
      type: 'object',
      properties: {
        priority: PRIORITY_PARAM,
        minPriority: MIN_PRIORITY_PARAM,
        status: { type: 'string', enum: ['scheduled', 'in-progress', 'overdue'], description: 'Only work orders with this status.' },
        assignee: { type: 'string', description: 'Administrators only: a staff member\'s name.' },
      },
      additionalProperties: false,
    },
  },
  {
    access: 'officer',
    name: 'get_pending_reviews',
    description: 'The review queues: citizen reports awaiting review (submitted or in review), wildlife sightings awaiting verification, and AI image detections awaiting human review — counts, total, and the oldest items waiting.',
    input_schema: { type: 'object', properties: { park: PARK_PARAM }, additionalProperties: false },
  },
  {
    access: 'citizen',
    name: 'get_my_reports',
    description: 'Reports the current user submitted through the Citizen Portal, newest first, with their status and any official response.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    access: 'guest',
    name: 'search_records',
    description: 'Full-text search across parks, species, assets, sensors and citizen reports (and, for staff, incidents and work orders). Use it for a specific place, asset or issue the other tools do not cover.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'What to search for.' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
];

const ACCESS = Object.fromEntries(DEFINITIONS.map((d) => [d.name, d.access]));

/** The tool definitions this user may call ({ name, description, input_schema }; providers convert them). */
const toolsFor = (ctx) =>
  DEFINITIONS.filter((d) => can(ctx, d.access)).map(({ name, description, input_schema }) => ({ name, description, input_schema }));

// ---------------------------------------------------------------------------
// Handlers — each returns { data, citations }
// ---------------------------------------------------------------------------

const HANDLERS = {
  async find_parks({ query }, ctx) {
    let parks = await activeParks();
    if (query && String(query).trim()) {
      parks = parks
        .map((p) => ({ p, s: scorePark(query, p) }))
        .filter((r) => r.s >= MATCH_THRESHOLD)
        .sort((a, b) => b.s - a.s)
        .slice(0, 5)
        .map((r) => r.p);
      if (!parks.length) {
        const all = await activeParks();
        throw toolError(`No park matches "${query}". Monitored parks: ${all.map((p) => p.name).join(', ')}.`);
      }
    }
    const rows = await Promise.all(
      parks.map(async (p) => {
        const health = await computeEcosystemHealth(p._id);
        return {
          name: p.name,
          slug: p.slug,
          areaAcres: p.areaAcres,
          manager: p.manager || null,
          ecosystemHealth: round1(health.ecosystemHealth),
          grade: health.grade,
          isHomePark: Boolean(ctx?.homePark && String(ctx.homePark._id) === String(p._id)),
        };
      })
    );
    if (!query) rows.sort((a, b) => (b.ecosystemHealth ?? -1) - (a.ecosystemHealth ?? -1));
    return { data: { parks: rows }, citations: parks.slice(0, 5).map((p) => cite(p.name, 'Park', p._id)) };
  },

  async get_park_conditions({ park }, ctx) {
    const p = await findPark(park, ctx);
    const coords = p?.location?.coordinates || (await Park.findById(p?._id).select('location').lean())?.location?.coordinates;
    const [lng, lat] = p && coords ? coords : [77.5946, 12.9716];

    const sensorMatch = { active: true };
    if (p) sensorMatch.park = p._id;
    const [sensors, weather, air] = await Promise.all([
      Sensor.find(sensorMatch).select('name type currentValue unit status lastReadingAt source park').lean(),
      external.getWeather(lat, lng).catch((err) => ({ ok: false, reason: err.message })),
      external.getAirQuality(lat, lng).catch((err) => ({ ok: false, reason: err.message })),
    ]);

    // One figure per sensor type: the park's own sensor, or the mean of the
    // reporting sensors across all parks.
    const byType = {};
    for (const s of sensors) {
      if (s.status === 'offline' || !s.lastReadingAt) continue;
      (byType[s.type] ||= []).push(s);
    }
    const readings = Object.entries(byType).map(([type, list]) => {
      const latest = list.reduce((a, b) => (new Date(a.lastReadingAt) > new Date(b.lastReadingAt) ? a : b));
      return {
        type,
        value: round1(list.reduce((sum, s) => sum + s.currentValue, 0) / list.length),
        unit: list[0].unit,
        sensors: list.length,
        status: list.some((s) => s.status === 'warning') ? 'warning' : 'online',
        readAt: latest.lastReadingAt,
        source: list.every((s) => s.source === 'open-meteo') ? 'Open-Meteo' : 'park sensor',
      };
    });
    const offline = sensors.filter((s) => s.status === 'offline').length;

    const w = weather?.ok ? weather.current : null;
    const sensorAqi = readings.find((r) => r.type === 'aqi');
    let airQuality = { unavailable: air?.reason || 'no reading' };
    if (air?.ok) {
      airQuality = { aqi: air.aqi, category: air.label, mainPollutant: pollutantName(air.dominantPollutant), advice: air.advice || null, observedAt: air.observedAt, source: 'Open-Meteo (live)' };
    } else if (sensorAqi) {
      const band = describeAqi(sensorAqi.value);
      airQuality = { aqi: band.aqi, category: band.label, advice: band.advice, observedAt: sensorAqi.readAt, source: 'latest stored reading' };
    }

    return {
      data: {
        location: p ? p.name : 'Bengaluru (all parks)',
        weather: w
          ? {
              condition: w.condition,
              temperatureC: round1(w.temperature),
              feelsLikeC: round1(w.feelsLike),
              humidityPercent: w.humidity,
              windKmh: round1(w.windSpeed),
              precipitationMm: w.precipitation,
              cloudCoverPercent: w.cloudCover,
              uvIndexMax: w.uvIndexMax,
              observedAt: w.observedAt,
              source: 'Open-Meteo (live)',
            }
          : { unavailable: weather?.reason || 'weather service unreachable' },
        airQuality,
        parkSensors: readings,
        offlineSensors: offline,
      },
      citations: p ? [cite(p.name, 'Park', p._id)] : [],
    };
  },

  async get_ecosystem_health({ park }, ctx) {
    const p = await findPark(park, ctx);
    const health = await computeEcosystemHealth(p?._id || null);
    const indicators = Object.fromEntries(Object.entries(health.subIndices || {}).map(([k, v]) => [k, round1(v)]));
    return {
      data: { scope: scopeOf(p), ecosystemHealth: round1(health.ecosystemHealth), grade: health.grade, indicators },
      citations: p ? [cite(p.name, 'Park', p._id)] : [],
    };
  },

  async get_biodiversity({ park }, ctx) {
    const p = await findPark(park, ctx);
    const bio = await analyseBiodiversity({ parkId: p?._id || null });
    const records = bio.species.reduce((s, x) => s + (x.count || 0), 0);
    const top = [...bio.species]
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
      .map((s) => ({ name: s.commonName || s.scientificName, scientificName: s.scientificName, group: s.class, records: s.count }));
    return {
      data: {
        scope: scopeOf(p),
        speciesRecorded: bio.species.length,
        records,
        threatenedSpecies: bio.threatenedSpecies,
        invasiveRecords: bio.invasiveCount,
        byGroup: bio.byClass,
        biodiversityScore: round1(bio.score),
        mostRecorded: top,
        source: 'GBIF occurrence records plus sightings verified in the Park Ecosystem Portal',
      },
      citations: p ? [cite(`${p.name} · species`, 'Park', p._id)] : [],
    };
  },

  async search_species({ query, park }, ctx) {
    const text = String(query || '').trim();
    if (!text) throw toolError('Name a species to look up.');
    const p = await findPark(park, ctx);
    const pattern = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const species = await Species.find({ $or: [{ commonName: pattern }, { scientificName: pattern }] })
      .select('commonName scientificName class family conservationStatus isInvasive habitat')
      .limit(5)
      .lean();
    if (!species.length) return { data: { query: text, matches: [] }, citations: [] };

    const match = { species: { $in: species.map((s) => s._id) }, verified: true };
    if (p) match.park = p._id;
    const sightings = await Observation.aggregate([
      { $match: match },
      { $group: { _id: { species: '$species', park: '$park' }, records: { $sum: 1 }, lastSeen: { $max: '$observedAt' } } },
    ]);
    const parks = await activeParks();
    const nameOf = (id) => parks.find((x) => String(x._id) === String(id))?.name || 'Unknown park';

    return {
      data: {
        query: text,
        scope: scopeOf(p),
        matches: species.map((s) => ({
          commonName: s.commonName,
          scientificName: s.scientificName,
          group: s.class,
          family: s.family || null,
          iucnStatus: s.conservationStatus || null,
          invasive: Boolean(s.isInvasive),
          habitat: s.habitat || null,
          recordedIn: sightings
            .filter((r) => String(r._id.species) === String(s._id))
            .sort((a, b) => b.records - a.records)
            .map((r) => ({ park: nameOf(r._id.park), verifiedRecords: r.records, lastSeen: r.lastSeen })),
        })),
      },
      citations: species.map((s) => cite(s.commonName || s.scientificName, 'Species', s._id)),
    };
  },

  async get_sensors({ park, type }, ctx) {
    const p = await findPark(park, ctx);
    const match = { active: true };
    if (p) match.park = p._id;
    if (type) match.type = String(type).toLowerCase();
    const sensors = await Sensor.find(match).limit(60).populate('park', 'name').lean();
    return {
      data: {
        scope: scopeOf(p),
        count: sensors.length,
        byStatus: countBy(sensors, 'status'),
        sensors: sensors.map((s) => ({
          name: s.name,
          type: s.type,
          latest: round1(s.currentValue),
          unit: s.unit,
          status: s.status,
          readAt: s.lastReadingAt,
          source: s.source === 'open-meteo' ? 'Open-Meteo' : 'park sensor',
          park: parkName(s.park),
        })),
      },
      citations: sensors.slice(0, 5).map((s) => cite(s.name, 'Sensor', s._id)),
    };
  },

  async get_alerts({ park, severity }, ctx) {
    const p = await findPark(park, ctx);
    const match = { status: { $in: ['active', 'acknowledged'] } };
    if (p) match.park = p._id;
    if (severity) match.severity = String(severity).toLowerCase();
    const [alerts, bySeverity] = await Promise.all([
      Alert.find(match).sort({ createdAt: -1 }).limit(10).populate('park', 'name').lean(),
      groupCount(Alert, match, 'severity'),
    ]);
    return {
      data: {
        scope: scopeOf(p),
        activeAlerts: Object.values(bySeverity).reduce((a, b) => a + b, 0),
        bySeverity,
        latest: alerts.map((a) => ({
          title: a.title,
          message: a.message,
          severity: a.severity,
          status: a.status,
          module: a.module,
          park: parkName(a.park),
          raisedAt: a.createdAt,
        })),
      },
      citations: [],
    };
  },

  async get_incidents({ park, priority, minPriority, status, assignedToMe, limit }, ctx) {
    const p = await findPark(park, ctx);
    const match = { status: { $nin: CLOSED_INCIDENT_STATUSES } };
    if (p) match.park = p._id;
    const prio = priorityFilter({ priority, minPriority });
    if (prio) match.priority = prio;
    if (status && !CLOSED_INCIDENT_STATUSES.includes(status)) match.status = status;

    if (!isStaff(ctx)) {
      // The public sees how many, never the records themselves.
      const byPriority = await groupCount(Incident, match, 'priority');
      return {
        data: {
          scope: scopeOf(p),
          filter: describeFilter({ priority, minPriority }),
          openIncidents: Object.values(byPriority).reduce((a, b) => a + b, 0),
          byPriority,
          note: 'Incident details are visible to park staff only.',
        },
        citations: [],
      };
    }

    if (assignedToMe) match.assignedTo = oid(ctx.user.id);
    const [byPriority, list] = await Promise.all([
      groupCount(Incident, match, 'priority'),
      Incident.find(match)
        .sort({ priorityScore: -1, reportedAt: 1 })
        .limit(Math.min(25, Math.max(1, Number(limit) || 10)))
        .populate('park', 'name')
        .populate('assignedTo', 'name')
        .lean(),
    ]);
    const showNames = can(ctx, 'admin');
    return {
      data: {
        scope: scopeOf(p),
        filter: describeFilter({ priority, minPriority }),
        openIncidents: Object.values(byPriority).reduce((a, b) => a + b, 0),
        byPriority,
        incidents: list.map((i) => ({
          reference: i.referenceCode,
          title: i.title,
          type: i.type,
          status: i.status,
          priority: i.priority,
          priorityScore: i.priorityScore,
          park: parkName(i.park),
          reportedAt: i.reportedAt,
          ageDays: daysSince(i.reportedAt),
          assignedToYou: Boolean(i.assignedTo && String(i.assignedTo._id || i.assignedTo) === ctx.user.id),
          ...(showNames ? { assignee: i.assignedTo?.name || null } : { assigned: Boolean(i.assignedTo) }),
        })),
      },
      citations: list.slice(0, 5).map((i) => cite(i.title, 'Incident', i._id)),
    };
  },

  async get_maintenance({ park, priority, minPriority, overdueOnly }, ctx) {
    const p = await findPark(park, ctx);
    const base = p ? { park: p._id } : {};
    const open = { ...base, status: { $in: OPEN_WORK_STATUSES } };
    const prio = priorityFilter({ priority, minPriority });
    if (prio) open.priority = prio;

    const [byStatus, openOrders] = await Promise.all([
      groupCount(WorkOrder, prio ? { ...base, priority: prio } : base, 'status'),
      WorkOrder.find(open).sort({ scheduledDate: 1 }).limit(200).populate('park', 'name').populate('assignedTo', 'name').lean(),
    ]);
    const overdue = openOrders.filter(isOverdue);
    const listed = overdueOnly ? overdue : openOrders;

    const data = {
      scope: scopeOf(p),
      filter: describeFilter({ priority, minPriority }),
      byStatus,
      open: openOrders.length,
      overdue: overdue.length,
      openByPriority: countBy(openOrders, 'priority'),
    };
    if (!isStaff(ctx)) return { data: { ...data, note: 'Work-order details are visible to park staff only.' }, citations: [] };

    // As in the Maintenance module: an administrator sees every order, a park
    // officer only the orders assigned to them.
    const showAll = can(ctx, 'admin');
    const visible = showAll ? listed : listed.filter((o) => o.assignedTo && String(o.assignedTo._id || o.assignedTo) === ctx.user.id);
    data.listScope = showAll ? 'all work orders' : 'work orders assigned to you';
    data.workOrders = visible.slice(0, 15).map((o) => ({
      code: o.orderCode,
      title: o.title,
      type: o.type,
      priority: o.priority,
      status: o.status,
      progress: o.progress,
      scheduledDate: o.scheduledDate,
      overdue: isOverdue(o),
      team: o.assignedTeam || null,
      park: parkName(o.park),
      assignedToYou: Boolean(o.assignedTo && String(o.assignedTo._id || o.assignedTo) === ctx.user.id),
      ...(showAll ? { assignee: o.assignedTo?.name || null } : {}),
    }));
    return { data, citations: visible.slice(0, 5).map((o) => cite(o.title, 'WorkOrder', o._id)) };
  },

  async get_my_tasks({ priority, minPriority, status, assignee }, ctx) {
    if (!ctx?.user) throw toolError('Sign in to see the tasks assigned to you.');
    if (!isStaff(ctx)) {
      throw toolError('Tasks are assigned to park staff only. You can ask about the status of your own reports instead.');
    }

    let target = { id: ctx.user.id, name: ctx.user.name };
    if (assignee && String(assignee).trim()) {
      const wanted = String(assignee).trim();
      const isSelf = /^(me|myself|self)$/i.test(wanted) || wanted.toLowerCase() === ctx.user.name.toLowerCase();
      if (!isSelf) {
        if (!can(ctx, 'admin')) throw toolError('Officers can only view their own tasks.');
        const pattern = new RegExp(wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        const staff = await User.findOne({ name: pattern, role: { $in: ['officer', 'admin'] } }).select('name').lean();
        if (!staff) throw toolError(`No staff member matches "${wanted}".`);
        target = { id: String(staff._id), name: staff.name };
      }
    }

    const prio = priorityFilter({ priority, minPriority });
    const woMatch = { assignedTo: oid(target.id), status: status ? status : { $in: OPEN_WORK_STATUSES } };
    const incMatch = { assignedTo: oid(target.id), status: { $nin: CLOSED_INCIDENT_STATUSES } };
    if (prio) {
      woMatch.priority = prio;
      incMatch.priority = prio;
    }

    const [orders, incidents] = await Promise.all([
      WorkOrder.find(woMatch).populate('park', 'name').lean(),
      status ? Promise.resolve([]) : Incident.find(incMatch).populate('park', 'name').lean(),
    ]);

    orders.sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority) || new Date(a.scheduledDate) - new Date(b.scheduledDate));
    incidents.sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0));

    return {
      data: {
        assignee: target.name,
        isCurrentUser: target.id === ctx.user.id,
        filter: describeFilter({ priority, minPriority }),
        total: orders.length + incidents.length,
        workOrders: {
          count: orders.length,
          overdue: orders.filter(isOverdue).length,
          items: orders.slice(0, 15).map((o) => ({
            code: o.orderCode,
            title: o.title,
            type: o.type,
            priority: o.priority,
            status: o.status,
            progress: o.progress,
            scheduledDate: o.scheduledDate,
            overdue: isOverdue(o),
            park: parkName(o.park),
          })),
        },
        incidents: {
          count: incidents.length,
          items: incidents.slice(0, 10).map((i) => ({
            reference: i.referenceCode,
            title: i.title,
            type: i.type,
            priority: i.priority,
            priorityScore: i.priorityScore,
            status: i.status,
            park: parkName(i.park),
            ageDays: daysSince(i.reportedAt),
          })),
        },
      },
      citations: [
        ...orders.slice(0, 4).map((o) => cite(o.title, 'WorkOrder', o._id)),
        ...incidents.slice(0, 4).map((i) => cite(i.title, 'Incident', i._id)),
      ],
    };
  },

  async get_pending_reviews({ park }, ctx) {
    const p = await findPark(park, ctx);
    const scope = p ? { park: p._id } : {};
    const reportMatch = { ...scope, status: { $in: ['submitted', 'in-review'] } };
    // GBIF records arrive already curated; only the portal's own sightings wait for an officer.
    const sightingMatch = { ...scope, verified: false, source: { $ne: 'gbif' } };
    const detectionMatch = { ...scope, reviewStatus: 'pending' };

    const [reportStatus, sightings, detections, oldestReports, oldestSightings, oldestDetections] = await Promise.all([
      groupCount(CitizenReport, reportMatch, 'status'),
      Observation.countDocuments(sightingMatch),
      AiDetection.countDocuments(detectionMatch),
      CitizenReport.find(reportMatch).sort({ createdAt: 1 }).limit(3).populate('park', 'name').select('referenceCode title category status park createdAt').lean(),
      Observation.find(sightingMatch).sort({ observedAt: 1 }).limit(3).populate('park', 'name').populate('species', 'commonName scientificName').select('species park observedAt').lean(),
      AiDetection.find(detectionMatch).sort({ createdAt: 1 }).limit(3).populate('park', 'name').select('task prediction confidence park createdAt').lean(),
    ]);
    const submitted = reportStatus.submitted || 0;
    const inReview = reportStatus['in-review'] || 0;

    return {
      data: {
        scope: scopeOf(p),
        total: submitted + inReview + sightings + detections,
        citizenReports: {
          awaitingReview: submitted + inReview,
          submitted,
          inReview,
          oldest: oldestReports.map((r) => ({ reference: r.referenceCode, title: r.title, category: r.category, status: r.status, park: parkName(r.park), waitingDays: daysSince(r.createdAt) })),
        },
        wildlifeSightings: {
          awaitingVerification: sightings,
          oldest: oldestSightings.map((o) => ({ species: o.species?.commonName || o.species?.scientificName || 'Unknown species', park: parkName(o.park), waitingDays: daysSince(o.observedAt) })),
        },
        aiDetections: {
          awaitingReview: detections,
          oldest: oldestDetections.map((d) => ({ task: d.task, prediction: d.prediction, confidence: d.confidence, park: parkName(d.park) || null, waitingDays: daysSince(d.createdAt) })),
        },
      },
      citations: oldestReports.map((r) => cite(r.title, 'CitizenReport', r._id)),
    };
  },

  async get_my_reports(_input, ctx) {
    if (!ctx?.user) throw toolError('Sign in to see the reports you have submitted.');
    const reports = await CitizenReport.find({ submittedBy: ctx.user.id })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('park', 'name')
      .select('referenceCode title category status park officialResponse createdAt resolvedAt')
      .lean();
    const byStatus = await groupCount(CitizenReport, { submittedBy: oid(ctx.user.id) }, 'status');
    return {
      data: {
        total: Object.values(byStatus).reduce((a, b) => a + b, 0),
        byStatus,
        reports: reports.map((r) => ({
          reference: r.referenceCode,
          title: r.title,
          category: r.category,
          status: r.status,
          park: parkName(r.park),
          submittedAt: r.createdAt,
          officialResponse: r.officialResponse || null,
        })),
      },
      citations: reports.slice(0, 5).map((r) => cite(r.title, 'CitizenReport', r._id)),
    };
  },

  async search_records({ query }, ctx) {
    // Required lazily: the retrieval engine itself requires this module.
    const { retrieve } = require('./assistant.service');
    const hits = await retrieve(String(query || ''), { k: 6, entities: searchableEntities(ctx) });
    return {
      data: { results: hits.map((h) => ({ type: h.entity, label: h.label, details: summariseRecord(h.raw) })) },
      citations: hits.map((h) => cite(h.label, h.entity, h.id, h.score)),
    };
  },
};

/** The record types a user may search. Incidents and work orders are operational. */
const PUBLIC_ENTITIES = ['Park', 'Species', 'Asset', 'Sensor', 'CitizenReport'];
const searchableEntities = (ctx) => (isStaff(ctx) ? undefined : PUBLIC_ENTITIES);

/** Readable fields of a search hit — never geometry, ids or people's names. */
const RECORD_FIELDS = [
  'title', 'commonName', 'scientificName', 'class', 'family', 'conservationStatus', 'isInvasive', 'habitat',
  'description', 'type', 'status', 'severity', 'priority', 'category', 'areaAcres', 'manager', 'condition',
  'scheduledDate', 'reportedAt', 'createdAt',
];
function summariseRecord(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const out = {};
  for (const key of RECORD_FIELDS) {
    const v = raw[key];
    if (v === undefined || v === null || v === '') continue;
    out[key] = typeof v === 'string' ? v.slice(0, 400) : v;
  }
  return out;
}

/**
 * Run one tool for a user. Never throws: a refusal or failure comes back as
 * an error result the caller can show or hand to the model.
 *
 * @returns {Promise<{ok:boolean, data?:object, error?:string, citations:object[]}>}
 */
async function runTool(name, input, ctx) {
  const handler = HANDLERS[name];
  if (!handler) return { ok: false, error: `Unknown tool: ${name}`, citations: [] };

  const required = ACCESS[name];
  if (!can(ctx, required)) {
    let error = 'Sign in to see that information.';
    if (ctx?.user) {
      error = name === 'get_my_tasks'
        ? 'Tasks are assigned to park staff only. You can ask about the status of your own reports instead.'
        : required === 'officer' ? STAFF_ONLY : 'That is not available to this account.';
    } else if (name === 'get_my_tasks') {
      error = 'Sign in to see the tasks assigned to you.';
    }
    return { ok: false, error, citations: [] };
  }

  try {
    const { data, citations } = await handler(input && typeof input === 'object' ? input : {}, ctx);
    return { ok: true, data, citations: citations || [] };
  } catch (err) {
    if (!err.toolError) logger.warn(`Assistant tool ${name} failed: ${err.message}`);
    return { ok: false, error: err.toolError ? err.message : `The ${name} lookup failed.`, citations: [] };
  }
}

module.exports = {
  DEFINITIONS,
  HANDLERS,
  toolsFor,
  runTool,
  buildContext,
  accessOf,
  can,
  findPark,
  findParkInText,
  scorePark,
  clearParkCache,
  searchableEntities,
  priorityRank,
};

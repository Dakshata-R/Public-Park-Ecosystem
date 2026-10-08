'use strict';

/**
 * Module 11 — AI Environmental Assistant, language-model engine.
 *
 * Claude answers the question in context (including the earlier turns of the
 * conversation) and looks facts up through the tools below, which read the
 * same database the dashboards do. It never sees the database directly and is
 * told to state only figures a tool returned.
 *
 * Enabled when ANTHROPIC_API_KEY is set. Without a key — or if the API cannot
 * be reached — the controller falls back to the retrieval engine in
 * `assistant.service.js`, so the assistant always answers.
 */

const Anthropic = require('@anthropic-ai/sdk').default;
const env = require('../config/env');
const logger = require('../utils/logger');
const { Park, Incident, WorkOrder, Alert, Sensor } = require('../models');
const { computeEcosystemHealth } = require('./ecosystem-score.service');
const { analyseBiodiversity } = require('./biodiversity.service');
const { buildTriageQueue } = require('./priority.service');
const external = require('./external.service');
const { retrieve } = require('./assistant.service');

/** Upper bound on tool round trips for one question. */
const MAX_TOOL_ROUNDS = 6;

/** How many earlier messages of the conversation are sent for context. */
const HISTORY_MESSAGES = 10;

let client = null;
const getClient = () => {
  if (!client) client = new Anthropic({ apiKey: env.anthropicApiKey, maxRetries: 1, timeout: 60_000 });
  return client;
};

/** True when the language-model engine should answer. */
const isEnabled = () => Boolean(env.anthropicApiKey) && !env.isTest;

const SYSTEM_PROMPT = `You are the GreenPulse Eco Assistant, part of a management portal that monitors the ecological health of public parks in Bengaluru, India. Your users are park officers, ecologists, administrators and members of the public.

Answer questions about the parks: ecosystem health, air quality and weather, biodiversity and species, sensors, incidents, alerts and maintenance work. Use the tools to look up current figures — every number you state must come from a tool result in this conversation. If the tools do not have the information, say so plainly rather than guessing. You may add brief general ecological knowledge (for example what a species is, or why a lake attracts birds) when it helps, but keep it clearly separate from the park data.

Use the earlier turns of the conversation to resolve follow-up questions ("what about Lalbagh?", "which one is worst?").

Write for a non-specialist: short paragraphs or bullet points, plain language, no formulas or statistical notation. Name the park and, where relevant, the time of the reading. Keep answers under about 200 words unless the user asks for detail. Air quality uses India's CPCB AQI scale. Politely decline requests unrelated to parks, the environment or this portal.`;

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const PARK_PARAM = {
  type: 'string',
  description: 'Park name or slug, e.g. "Cubbon Park" or "lalbagh-botanical-garden". Omit for all parks combined.',
};

/** @type {import('@anthropic-ai/sdk').default.Tool[]} */
const TOOLS = [
  {
    name: 'list_parks',
    description: 'List every monitored park with its area, managing authority and current Ecosystem Health score (0–100). Use this to compare parks or to find which park is best or worst.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_ecosystem_health',
    description: 'Ecosystem Health score (0–100) and grade for one park or all parks, with the score of each indicator: air quality, water quality, soil health, tree health and biodiversity.',
    input_schema: { type: 'object', properties: { park: PARK_PARAM }, additionalProperties: false },
  },
  {
    name: 'get_live_conditions',
    description: 'Current weather (temperature, humidity, wind, UV) and air quality (CPCB AQI, category, main pollutant) at a park, fetched live from Open-Meteo.',
    input_schema: { type: 'object', properties: { park: PARK_PARAM }, additionalProperties: false },
  },
  {
    name: 'get_biodiversity',
    description: 'Species recorded at a park or across all parks: number of species, number of records, threatened species, invasive records, breakdown by group (birds, plants, insects…) and the most frequently recorded species.',
    input_schema: { type: 'object', properties: { park: PARK_PARAM }, additionalProperties: false },
  },
  {
    name: 'get_incidents',
    description: 'Open incidents (pollution, dumping, damage, hazards…) ranked by priority score, with type, status, severity and park.',
    input_schema: {
      type: 'object',
      properties: { park: PARK_PARAM, limit: { type: 'integer', description: 'Maximum incidents to return (default 10).' } },
      additionalProperties: false,
    },
  },
  {
    name: 'get_alerts',
    description: 'Active alerts raised by sensors, the AI image analysis and incident escalation, most recent first.',
    input_schema: { type: 'object', properties: { park: PARK_PARAM }, additionalProperties: false },
  },
  {
    name: 'get_sensors',
    description: 'Park sensors with their latest reading, unit and status (online, warning, offline). Types: aqi, temperature, humidity, noise, soil, water.',
    input_schema: {
      type: 'object',
      properties: { park: PARK_PARAM, type: { type: 'string', description: 'Optional sensor type filter.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'get_maintenance',
    description: 'Maintenance work orders that are scheduled, in progress or overdue, with type, priority, scheduled date and assigned team.',
    input_schema: { type: 'object', properties: { park: PARK_PARAM }, additionalProperties: false },
  },
  {
    name: 'search_records',
    description: 'Full-text search across parks, species, incidents, citizen reports and work orders. Use it for a specific species, place or issue the other tools do not cover.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'What to search for.' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
];

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Resolve a park name or slug; undefined input means "all parks". */
async function findPark(ref) {
  if (!ref || !String(ref).trim()) return null;
  const text = String(ref).trim();
  const park =
    (await Park.findOne({ slug: text.toLowerCase().replace(/\s+/g, '-') }).lean()) ||
    (await Park.findOne({ name: new RegExp(`^${escapeRegex(text)}$`, 'i') }).lean()) ||
    (await Park.findOne({ name: new RegExp(escapeRegex(text.replace(/\bpark\b/i, '').trim()), 'i') }).lean());
  if (!park) {
    const names = (await Park.find({ active: true }).select('name').lean()).map((p) => p.name);
    const err = new Error(`No park matches "${text}". Monitored parks: ${names.join(', ')}.`);
    err.toolError = true;
    throw err;
  }
  return park;
}

/** Readable fields of a search hit — never geometry or internal ids. */
const RECORD_FIELDS = [
  'title', 'commonName', 'scientificName', 'class', 'family', 'conservationStatus', 'isInvasive', 'habitat',
  'description', 'type', 'status', 'severity', 'priority', 'category', 'areaAcres', 'manager', 'condition',
  'scheduledDate', 'reportedAt', 'createdAt',
];
const summariseRecord = (raw) => {
  if (!raw || typeof raw !== 'object') return undefined;
  const out = {};
  for (const key of RECORD_FIELDS) {
    const v = raw[key];
    if (v === undefined || v === null || v === '') continue;
    out[key] = typeof v === 'string' ? v.slice(0, 400) : v;
  }
  return out;
};

const parkName = (p) => (p && typeof p === 'object' && p.name ? p.name : undefined);
const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

/** Each handler returns plain JSON and the citations it should add. */
const HANDLERS = {
  async list_parks() {
    const parks = await Park.find({ active: true }).select('name slug areaAcres manager establishedYear').lean();
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
        };
      })
    );
    rows.sort((a, b) => (b.ecosystemHealth ?? -1) - (a.ecosystemHealth ?? -1));
    return { data: { parks: rows }, citations: [] };
  },

  async get_ecosystem_health({ park }) {
    const p = await findPark(park);
    const health = await computeEcosystemHealth(p?._id || null);
    const sub = Object.fromEntries(Object.entries(health.subIndices || {}).map(([k, v]) => [k, round1(v)]));
    return {
      data: { scope: p ? p.name : 'All parks', ecosystemHealth: round1(health.ecosystemHealth), grade: health.grade, indicators: sub },
      citations: p ? [{ label: p.name, entity: 'Park', entityId: String(p._id), score: 1 }] : [],
    };
  },

  async get_live_conditions({ park }) {
    const p = await findPark(park);
    const [lng, lat] = p ? p.location.coordinates : [77.5946, 12.9716];
    const [weather, air] = await Promise.all([external.getWeather(lat, lng), external.getAirQuality(lat, lng)]);
    const w = weather.ok ? weather.current : null;
    return {
      data: {
        location: p ? p.name : 'Bengaluru city centre',
        weather: w
          ? {
              condition: w.condition,
              temperatureC: w.temperature,
              feelsLikeC: w.feelsLike,
              humidityPercent: w.humidity,
              windKmh: w.windSpeed,
              uvIndexMax: w.uvIndexMax,
              observedAt: w.observedAt,
            }
          : { unavailable: weather.reason || true },
        airQuality: air.ok
          ? { aqi: air.aqi, category: air.label, mainPollutant: air.dominantPollutant, observedAt: air.observedAt, advice: air.advice }
          : { unavailable: air.reason || true },
      },
      citations: [],
    };
  },

  async get_biodiversity({ park }) {
    const p = await findPark(park);
    const bio = await analyseBiodiversity({ parkId: p?._id });
    const records = bio.species.reduce((s, x) => s + (x.count || 0), 0);
    const top = [...bio.species]
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map((s) => ({ name: s.commonName || s.scientificName, scientificName: s.scientificName, group: s.class, records: s.count }));
    return {
      data: {
        scope: p ? p.name : 'All parks',
        speciesRecorded: bio.species.length,
        records,
        recordsSince: '2023-01-01',
        source: 'GBIF occurrence records plus sightings verified in GreenPulse',
        threatenedSpecies: bio.threatenedSpecies,
        invasiveRecords: bio.invasiveCount,
        byGroup: bio.byClass,
        biodiversityScore: round1(bio.score),
        mostRecorded: top,
      },
      citations: p ? [{ label: `${p.name} · species`, entity: 'Park', entityId: String(p._id), score: 1 }] : [],
    };
  },

  async get_incidents({ park, limit }) {
    const p = await findPark(park);
    const match = { status: { $nin: ['resolved', 'closed'] } };
    if (p) match.park = p._id;
    const open = await Incident.find(match).populate('park', 'name').lean();
    const queue = buildTriageQueue(open).slice(0, Math.min(25, Math.max(1, Number(limit) || 10)));
    return {
      data: {
        scope: p ? p.name : 'All parks',
        openIncidents: open.length,
        incidents: queue.map((i) => ({
          reference: i.referenceCode,
          title: i.title,
          type: i.type,
          status: i.status,
          severity: i.severity,
          priorityScore: i.triage?.score,
          priority: i.triage?.priority,
          park: parkName(i.park),
          reportedAt: i.reportedAt,
        })),
      },
      citations: queue.slice(0, 5).map((i) => ({ label: i.title, entity: 'Incident', entityId: String(i._id), score: 1 })),
    };
  },

  async get_alerts({ park }) {
    const p = await findPark(park);
    const match = { status: { $in: ['active', 'acknowledged'] } };
    if (p) match.park = p._id;
    const alerts = await Alert.find(match).sort({ createdAt: -1 }).limit(15).populate('park', 'name').lean();
    return {
      data: {
        scope: p ? p.name : 'All parks',
        activeAlerts: alerts.length,
        alerts: alerts.map((a) => ({
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

  async get_sensors({ park, type }) {
    const p = await findPark(park);
    const match = { active: true };
    if (p) match.park = p._id;
    if (type) match.type = String(type).toLowerCase();
    const sensors = await Sensor.find(match).populate('park', 'name').lean();
    return {
      data: {
        scope: p ? p.name : 'All parks',
        sensors: sensors.map((s) => ({
          name: s.name,
          type: s.type,
          latest: s.currentValue,
          unit: s.unit,
          status: s.status,
          readAt: s.lastReadingAt,
          source: s.source === 'open-meteo' ? 'Open-Meteo' : 'park sensor',
          park: parkName(s.park),
        })),
      },
      citations: [],
    };
  },

  async get_maintenance({ park }) {
    const p = await findPark(park);
    const match = { status: { $nin: ['completed', 'cancelled'] } };
    if (p) match.park = p._id;
    const orders = await WorkOrder.find(match).sort({ scheduledDate: 1 }).limit(20).populate('park', 'name').lean();
    const now = Date.now();
    return {
      data: {
        scope: p ? p.name : 'All parks',
        openWorkOrders: orders.length,
        workOrders: orders.map((o) => ({
          code: o.orderCode,
          title: o.title,
          type: o.type,
          priority: o.priority,
          status: o.status,
          scheduledDate: o.scheduledDate,
          overdue: Boolean(o.scheduledDate && new Date(o.scheduledDate).getTime() < now && o.status === 'scheduled'),
          team: o.assignedTeam || null,
          asset: o.assetName || null,
          park: parkName(o.park),
        })),
      },
      citations: orders.slice(0, 5).map((o) => ({ label: o.title, entity: 'WorkOrder', entityId: String(o._id), score: 1 })),
    };
  },

  async search_records({ query }) {
    const hits = await retrieve(String(query || ''), { k: 6 });
    return {
      data: { results: hits.map((h) => ({ type: h.entity, label: h.label, details: summariseRecord(h.raw) })) },
      citations: hits.map((h) => ({ label: h.label, entity: h.entity, entityId: h.id, score: h.score })),
    };
  },
};

async function runTool(name, input) {
  const handler = HANDLERS[name];
  if (!handler) return { content: `Unknown tool: ${name}`, isError: true, citations: [] };
  try {
    const { data, citations } = await handler(input && typeof input === 'object' ? input : {});
    return { content: JSON.stringify(data), isError: false, citations };
  } catch (err) {
    if (!err.toolError) logger.warn(`Assistant tool ${name} failed: ${err.message}`);
    return { content: err.toolError ? err.message : `The ${name} lookup failed.`, isError: true, citations: [] };
  }
}

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------

/**
 * Answer a question with Claude.
 *
 * @param {string} question
 * @param {{role:'user'|'assistant', content:string}[]} history earlier turns, oldest first
 * @returns {Promise<{answer:string, citations:object[], toolsUsed:string[], latencyMs:number}>}
 */
async function ask(question, history = []) {
  const startedAt = Date.now();

  // Earlier turns as plain text. The API requires the first message to be from
  // the user and roles to alternate, so drop a leading assistant message.
  const prior = history.slice(-HISTORY_MESSAGES).map((m) => ({ role: m.role, content: String(m.content) }));
  while (prior.length && prior[0].role !== 'user') prior.shift();

  const today = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'full' });
  const messages = [...prior, { role: 'user', content: question }];
  const citations = new Map();
  const toolsUsed = [];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    const response = await getClient().beta.messages.create({
      model: env.assistantModel,
      max_tokens: 16000,
      output_config: { effort: 'low' },
      // On a safety decline the API re-runs the request on a suitable model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [
        { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: `Today is ${today} (India Standard Time).` },
      ],
      tools: TOOLS,
      messages,
    });

    if (response.stop_reason === 'refusal') {
      return {
        answer: 'I can only help with questions about the parks, their environment and this portal.',
        citations: [],
        toolsUsed,
        latencyMs: Date.now() - startedAt,
      };
    }

    const toolUses = response.content.filter((b) => b.type === 'tool_use');
    if (response.stop_reason !== 'tool_use' || !toolUses.length || round === MAX_TOOL_ROUNDS) {
      const answer = response.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      return {
        answer: answer || 'I could not put together an answer to that. Please try rephrasing the question.',
        citations: [...citations.values()].slice(0, 8),
        toolsUsed,
        latencyMs: Date.now() - startedAt,
      };
    }

    // Keep the full assistant content (thinking blocks included) for the next round.
    messages.push({ role: 'assistant', content: response.content });
    const results = await Promise.all(toolUses.map((t) => runTool(t.name, t.input)));
    toolUses.forEach((t) => toolsUsed.push(t.name));
    for (const r of results) for (const c of r.citations) citations.set(`${c.entity}:${c.entityId}`, c);
    messages.push({
      role: 'user',
      content: toolUses.map((t, i) => ({
        type: 'tool_result',
        tool_use_id: t.id,
        content: results[i].content,
        ...(results[i].isError ? { is_error: true } : {}),
      })),
    });
  }

  // Unreachable: the loop returns on its last round.
  throw new Error('Assistant tool loop ended without an answer');
}

/** Test seam: substitute the API client. */
const _setClient = (fake) => {
  client = fake;
};

module.exports = { ask, isEnabled, TOOLS, HANDLERS, runTool, _setClient };

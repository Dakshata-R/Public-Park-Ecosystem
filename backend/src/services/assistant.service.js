'use strict';

/**
 * AI Environmental Assistant — Module 11.
 *
 * A retrieval-augmented question answering pipeline over the live database.
 * The retrieval half is genuinely implemented; the generation half is
 * template-based rather than an LLM, which is the honest scope for a
 * prototype and keeps every answer traceable to the record it came from.
 *
 * ---------------------------------------------------------------------------
 * Pipeline
 * ---------------------------------------------------------------------------
 *   question
 *     → tokenise + stopword removal + light suffix stripping
 *     → intent classification (keyword scoring over intent lexicons)
 *     → retrieve top-k documents by TF-IDF cosine similarity
 *     → compose an answer from the retrieved records via the intent's template
 *     → return answer + citations
 *
 * ---------------------------------------------------------------------------
 * Retrieval mathematics
 * ---------------------------------------------------------------------------
 * The corpus is rebuilt from MongoDB and cached. For term t in document d
 * within a corpus D of N documents:
 *
 *   tf(t, d)   = f(t, d) / |d|                       (term frequency)
 *   idf(t, D)  = ln( N / (1 + n_t) ) + 1             (smoothed inverse doc freq)
 *   w(t, d)    = tf(t, d) · idf(t, D)
 *
 * Documents and the query are represented as sparse weight vectors and ranked
 * by cosine similarity:
 *
 *              Σ_t  q_t · d_t
 *   cos(q,d) = ──────────────────
 *              ‖q‖₂ · ‖d‖₂
 *
 * Cosine rather than raw dot product because document lengths vary by an order
 * of magnitude here — a species description dwarfs an incident title, and
 * without length normalisation the long documents would always win.
 *
 * Swapping this stage for a vector database and sentence embeddings is the
 * documented Phase-3 upgrade; the interface (`retrieve` → ranked docs with
 * scores) would not change.
 */

const { Park, Species, Incident, Asset, Sensor, CitizenReport, WorkOrder } = require('../models');
const { computeEcosystemHealth } = require('./ecosystem-score.service');
const { analyseBiodiversity } = require('./biodiversity.service');
const tools = require('./assistant-tools.service');

/** Words carrying no retrieval signal. */
const STOPWORDS = new Set(
  ('a an the is are was were be been being of in on at to for with by from about into over after ' +
    'and or but if then than that this these those it its as i you we they he she what which who whom ' +
    'how when where why do does did doing done can could should would will shall may might must have ' +
    'has had having not no nor so such there here me my your our their his her them us any all some ' +
    'more most other please tell show give list get find').split(' ')
);

/**
 * Cache of the retrieval corpus. Rebuilt when older than `CORPUS_TTL_MS`,
 * so the assistant reflects new incidents without re-indexing on every turn.
 */
const CORPUS_TTL_MS = 60_000;
let corpusCache = { builtAt: 0, docs: [], idf: new Map() };

/**
 * Tokenise: lowercase, split on non-letters, drop stopwords and very short
 * tokens, then strip common English suffixes so "trees"/"tree" and
 * "reporting"/"report" collapse to one term. A full Porter stemmer would be
 * more accurate; this covers the plural/gerund cases that dominate the
 * questions this assistant sees.
 *
 * @param {string} text
 * @returns {string[]}
 */
function tokenise(text) {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t))
    .map((t) => {
      if (t.endsWith('ies') && t.length > 4) return `${t.slice(0, -3)}y`;
      if (t.endsWith('ing') && t.length > 5) return t.slice(0, -3);
      if (t.endsWith('ed') && t.length > 4) return t.slice(0, -2);
      if (t.endsWith('es') && t.length > 4) return t.slice(0, -2);
      if (t.endsWith('s') && !t.endsWith('ss') && t.length > 3) return t.slice(0, -1);
      return t;
    });
}

/** Term-frequency map for one token list. */
function termFrequency(tokens) {
  const counts = new Map();
  for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
  const length = tokens.length || 1;
  const tf = new Map();
  for (const [term, count] of counts) tf.set(term, count / length);
  return tf;
}

/**
 * Build the document corpus from MongoDB.
 * Each document carries the text to index plus the metadata a citation needs.
 */
async function buildCorpus() {
  const [parks, species, incidents, assets, sensors, reports, workOrders] = await Promise.all([
    Park.find({ active: true }).select('name description facilities areaAcres scores city manager').lean(),
    Species.find().select('commonName scientificName class habitat description conservationStatus isInvasive').lean(),
    Incident.find().sort({ reportedAt: -1 }).limit(200).populate('park', 'name').select('title description type status priority park referenceCode').lean(),
    Asset.find({ active: true }).limit(400).populate('park', 'name').select('name type status condition park assetCode notes').lean(),
    Sensor.find({ active: true }).populate('park', 'name').select('name type park currentValue unit status sensorCode').lean(),
    CitizenReport.find().sort({ createdAt: -1 }).limit(200).populate('park', 'name').select('title description category status park referenceCode').lean(),
    WorkOrder.find().sort({ scheduledDate: -1 }).limit(200).populate('park', 'name').select('title description type status park orderCode').lean(),
  ]);

  const docs = [];
  const push = (entity, id, label, text, extra = {}) =>
    docs.push({ entity, id: String(id), label, text, tokens: tokenise(text), ...extra });

  for (const p of parks) {
    push('Park', p._id, p.name,
      `${p.name} ${p.description} ${(p.facilities || []).join(' ')} park ${p.city} managed by ${p.manager} area ${p.areaAcres} acres ecosystem health ${p.scores?.ecosystemHealth}`,
      { raw: p });
  }

  for (const s of species) {
    push('Species', s._id, s.commonName,
      `${s.commonName} ${s.scientificName} ${s.class} ${s.habitat} ${s.description} conservation status ${s.conservationStatus}${s.isInvasive ? ' invasive species' : ''}`,
      { raw: s });
  }

  for (const i of incidents) {
    push('Incident', i._id, i.title,
      `incident ${i.title} ${i.description} ${i.type} ${i.status} ${i.priority} priority at ${i.park?.name || ''}`,
      { raw: i });
  }

  for (const a of assets) {
    push('Asset', a._id, a.name,
      `asset ${a.name} ${a.type} condition ${a.condition} ${a.status} at ${a.park?.name || ''} ${a.notes || ''}`,
      { raw: a });
  }

  for (const s of sensors) {
    push('Sensor', s._id, s.name,
      `sensor ${s.name} measuring ${s.type} at ${s.park?.name || ''} currently ${s.currentValue} ${s.unit} status ${s.status}`,
      { raw: s });
  }

  for (const r of reports) {
    push('CitizenReport', r._id, r.title,
      `citizen report ${r.title} ${r.description} ${r.category} ${r.status} at ${r.park?.name || ''}`,
      { raw: r });
  }

  for (const w of workOrders) {
    push('WorkOrder', w._id, w.title,
      `work order maintenance ${w.title} ${w.description} ${w.type} ${w.status} at ${w.park?.name || ''}`,
      { raw: w });
  }

  // idf(t) = ln(N / (1 + n_t)) + 1
  const documentFrequency = new Map();
  for (const doc of docs) {
    for (const term of new Set(doc.tokens)) {
      documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
    }
  }

  const N = docs.length || 1;
  const idf = new Map();
  for (const [term, df] of documentFrequency) {
    idf.set(term, Math.log(N / (1 + df)) + 1);
  }

  // Pre-compute each document's weight vector and its L2 norm.
  for (const doc of docs) {
    const tf = termFrequency(doc.tokens);
    const weights = new Map();
    let sumSquares = 0;
    for (const [term, freq] of tf) {
      const w = freq * (idf.get(term) || 1);
      weights.set(term, w);
      sumSquares += w * w;
    }
    doc.weights = weights;
    doc.norm = Math.sqrt(sumSquares) || 1;
  }

  return { builtAt: Date.now(), docs, idf };
}

/** Return the cached corpus, rebuilding it when stale. */
async function getCorpus(force = false) {
  if (force || Date.now() - corpusCache.builtAt > CORPUS_TTL_MS || !corpusCache.docs.length) {
    corpusCache = await buildCorpus();
  }
  return corpusCache;
}

/**
 * Rank corpus documents against a query by TF-IDF cosine similarity.
 *
 * @param {string} question
 * @param {object} [options]
 * @param {number} [options.k=5] Number of documents to return
 * @param {string[]} [options.entities] Restrict to these entity types
 * @returns {Promise<Array<{entity:string,id:string,label:string,score:number,raw:object}>>}
 */
async function retrieve(question, { k = 5, entities } = {}) {
  const { docs, idf } = await getCorpus();
  const queryTokens = tokenise(question);
  if (!queryTokens.length) return [];

  const queryTf = termFrequency(queryTokens);
  const queryWeights = new Map();
  let querySumSquares = 0;
  for (const [term, freq] of queryTf) {
    const w = freq * (idf.get(term) || 1);
    queryWeights.set(term, w);
    querySumSquares += w * w;
  }
  const queryNorm = Math.sqrt(querySumSquares) || 1;

  const pool = entities?.length ? docs.filter((d) => entities.includes(d.entity)) : docs;

  const scored = pool.map((doc) => {
    let dot = 0;
    // Iterate the shorter vector — the query — for efficiency.
    for (const [term, qWeight] of queryWeights) {
      const dWeight = doc.weights.get(term);
      if (dWeight) dot += qWeight * dWeight;
    }
    return { doc, score: dot / (queryNorm * doc.norm) };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(({ doc, score }) => ({
      entity: doc.entity,
      id: doc.id,
      label: doc.label,
      score: Math.round(score * 10000) / 10000,
      raw: doc.raw,
    }));
}

/**
 * Intent lexicons. A question's intent is the lexicon with the highest count
 * of matching tokens; ties and empty matches fall through to `general`.
 */
const INTENTS = {
  // 'quality' is deliberately absent — it collides with "air quality" and
  // "water quality". The specific sub-index terms carry it instead.
  health: ['health', 'score', 'index', 'ecosystem', 'condition', 'rating', 'overall', 'water', 'soil'],
  airQuality: ['air', 'aqi', 'pollution', 'pm', 'smog', 'breathe', 'pollutant'],
  biodiversity: ['biodiversity', 'species', 'diversity', 'shannon', 'wildlife', 'bird', 'animal', 'plant', 'flora', 'fauna', 'richness'],
  incidents: ['incident', 'alert', 'emergency', 'fire', 'dump', 'complaint', 'problem', 'issue', 'hazard'],
  maintenance: ['maintenance', 'work', 'order', 'repair', 'schedule', 'clean', 'trim', 'task'],
  assets: ['asset', 'tree', 'bench', 'lake', 'light', 'path', 'trail', 'inventory', 'infrastructure'],
  sensors: ['sensor', 'reading', 'measure', 'temperature', 'humidity', 'noise', 'soil', 'moisture', 'device'],
  parks: ['park', 'garden', 'reserve', 'location', 'visit', 'open', 'facility', 'area'],
  tips: ['tip', 'advice', 'help', 'how', 'improve', 'protect', 'conserve', 'reduce', 'suggest', 'recommend'],
};

/**
 * Questions that are about the asker or a specific view of the data — "my
 * tasks", "pending reviews", "the weather at Cubbon" — are recognised by
 * phrase before the keyword lexicons run, because their meaning lies in word
 * combinations the bag-of-words scoring cannot see ("assigned to me").
 */
const SELF = /\b(me|my|mine|i|i'm|myself)\b/;
const TASK_WORDS = /\b(tasks?|work ?orders?|assign(ed|ments?)|jobs?|to-?dos?|duties|workload)\b/;
const REVIEW_QUEUE = /\b(review|verification|moderation|approval) (queue|backlog)s?\b|\bpending (reviews?|verifications?|approvals?)\b|\b(awaiting|waiting for|needs?|need to be|to be|pending|yet to be) (review|reviewed|verif\w*|approv\w*|moderat\w*)\b/;
const PENDING_THINGS = /\b(pending|awaiting|waiting|unreviewed|unverified|outstanding)\b.*\b(reports?|sightings?|detections?|submissions?|observations?)\b/;
const MY_REPORTS = /\bmy (own )?(citizen )?(reports?|submissions?|complaints?|sightings?)\b|\breports? (i|that i|which i) (have )?(submitted|filed|made|sent|raised|reported)\b/;
const CLIMATE = /\b(climate|weather|temperature|temp|humidity|humid|rain|raining|rainfall|forecast|wind|windy|hot|cold|sunny|uv|feels like)\b|\b(current|live|environmental|weather|climatic) conditions?\b|\bconditions? (at|in|of|for|near)\b/;

function detectPersonalIntent(question) {
  const lower = String(question || '').toLowerCase();
  if (!lower.trim()) return null;

  if (MY_REPORTS.test(lower)) return 'myReports';
  // "tell me…" / "show me…" are phrasing, not a reference to the asker.
  const selfText = lower.replace(/\b(tell|show|give|let|get|find|help|remind|list) me\b/g, ' ');
  if (SELF.test(selfText) && (TASK_WORDS.test(selfText) || /\bmy (incidents?|queue|work)\b/.test(selfText) || /\bwhat should i (work on|do)\b/.test(selfText))) {
    return 'myTasks';
  }
  if ((REVIEW_QUEUE.test(lower) || PENDING_THINGS.test(lower)) && !/\b(work ?orders?|maintenance|tasks?|incidents?)\b/.test(lower)) {
    return 'pendingReviews';
  }
  if (/\balerts?\b/.test(lower) && !/\bincidents?\b/.test(lower)) return 'alerts';
  if (CLIMATE.test(lower) && !/\b(sensors?|trees?|assets?|benches|bench|paths?)\b/.test(lower)) return 'climate';
  return null;
}

/** "high priority" → high and above; "critical" → critical only. */
function priorityFromText(question) {
  const lower = String(question || '').toLowerCase();
  if (/\bcritical\b/.test(lower)) return { minPriority: 'critical' };
  if (/\b(high|urgent|top|important)\b/.test(lower)) return { minPriority: 'high' };
  if (/\bmedium\b/.test(lower)) return { priority: 'medium' };
  if (/\blow[- ]priority\b/.test(lower)) return { priority: 'low' };
  return {};
}

/**
 * Classify the question's intent.
 *
 * Matches are weighted rather than counted. A word that *names* an intent —
 * "biodiversity" for the biodiversity intent — is a far stronger signal than an
 * incidental lexicon word, so it counts double.
 *
 * Without that, "what is the biodiversity score?" ties at one hit each between
 * `biodiversity` (matching "biodiversity") and `health` (matching "score"), and
 * the winner is decided by whichever intent happens to be declared first in the
 * object — which is not a decision the object's ordering should be making.
 *
 * @param {string[]} tokens
 * @returns {{intent: string, confidence: number}}
 */
function classifyIntent(tokens, question = '') {
  const special = detectPersonalIntent(question);
  if (special) return { intent: special, confidence: 1 };

  const tokenSet = new Set(tokens);
  const lower = String(question).toLowerCase();
  let best = { intent: 'general', score: 0, hits: 0 };
  const scores = {};

  for (const [intent, lexicon] of Object.entries(INTENTS)) {
    /** The intent's own name, stemmed the same way the tokens were. */
    const intentToken = tokenise(intent)[0];

    let score = 0;
    let hits = 0;

    for (const word of lexicon) {
      if (!tokenSet.has(word) && !tokenSet.has(tokenise(word)[0])) continue;
      hits += 1;
      score += word === intent || word === intentToken ? 2 : 1;
    }

    // A question naming the intent directly counts even when that word is not
    // in the lexicon (e.g. "maintenance" for the maintenance intent).
    if (intentToken && tokenSet.has(intentToken) && !lexicon.includes(intent)) {
      score += 2;
      hits += 1;
    }

    scores[intent] = { score, hits };
    if (score > best.score) best = { intent, score, hits };
  }

  // Two-word terms carry meaning their words do not: "air quality" is about
  // air, however many other words the question shares with other intents.
  const PHRASES = [
    ['air quality', 'airQuality'],
    ['water quality', 'health'],
    ['soil health', 'health'],
    ['work order', 'maintenance'],
  ];
  for (const [phrase, intent] of PHRASES) {
    if (lower.includes(phrase)) {
      const boosted = (scores[intent]?.score || 0) + 3;
      if (boosted > best.score) best = { intent, score: boosted, hits: (scores[intent]?.hits || 0) + 1 };
    }
  }

  // Naming a park is how most questions set their scope ("…at Cubbon Park"),
  // so the generic `parks` intent only wins when nothing more specific matched.
  if (best.intent === 'parks') {
    const specific = Object.entries(scores)
      .filter(([intent, s]) => intent !== 'parks' && s.score > 0)
      .sort((a, b) => b[1].score - a[1].score)[0];
    if (specific) best = { intent: specific[0], ...specific[1] };
  }

  return {
    intent: best.intent,
    confidence: tokens.length ? Math.min(1, best.hits / Math.min(3, tokens.length)) : 0,
  };
}

const percent = (v) => (v === null || v === undefined ? 'not measured' : `${Math.round(v * 10) / 10}`);
const round2 = (v) => Math.round(v * 100) / 100;
const outOf100 = (v) => (v === null || v === undefined ? 'not measured' : `${percent(v)}/100`);

// ---------------------------------------------------------------------------
// Formatting for the built-in engine's answers
// ---------------------------------------------------------------------------

const IST = { timeZone: 'Asia/Kolkata' };
const fmtTime = (d) =>
  d ? new Date(d).toLocaleString('en-IN', { ...IST, hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' }) : null;
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { ...IST, day: 'numeric', month: 'short' }) : 'unscheduled');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const SENSOR_LABELS = {
  aqi: 'Air quality (AQI)',
  temperature: 'Temperature',
  humidity: 'Humidity',
  noise: 'Noise',
  soil: 'Soil moisture',
  water: 'Water quality',
};

/** "[HIGH] Clear the drains — Lalbagh, **overdue**" / "…, due 8 Nov (in-progress, 54%)". */
function workOrderLine(o) {
  const when = o.overdue ? `**overdue** since ${fmtDate(o.scheduledDate)}` : `due ${fmtDate(o.scheduledDate)}`;
  const state = [o.status !== 'overdue' && o.status !== 'scheduled' ? o.status : null, o.progress ? `${o.progress}%` : null].filter(Boolean);
  return `[${o.priority.toUpperCase()}] ${o.title} — ${o.park}, ${when}${state.length ? ` (${state.join(', ')})` : ''}`;
}

/** Run a tool for the built-in engine; a refusal becomes the answer itself. */
async function lookup(name, input, ctx, used) {
  used.push(name);
  return tools.runTool(name, input, ctx);
}

/**
 * Compose the answer for a classified intent using retrieved records.
 * Every branch reports figures pulled from the database, never invented.
 *
 * @returns {Promise<{text:string, citations?:object[]}>|string}
 */
async function compose(intent, question, hits, ctx = { access: 'guest', user: null, homePark: null }, used = []) {
  const park = await tools.findParkInText(question, ctx);
  const scope = park ? `at ${park.name}` : 'across all monitored parks';
  const parkArg = park ? park.name : undefined;

  switch (intent) {
    case 'climate': {
      const r = await lookup('get_park_conditions', { park: parkArg }, ctx, used);
      if (!r.ok) return r.error;
      const { weather: w, airQuality: a, parkSensors, offlineSensors, location } = r.data;
      const lines = [];
      if (w && !w.unavailable) {
        lines.push(
          `• **Weather:** ${w.condition}, **${w.temperatureC} °C** (feels like ${w.feelsLikeC} °C), humidity ${w.humidityPercent}%, wind ${w.windKmh} km/h` +
            (w.uvIndexMax != null ? `, UV index up to ${w.uvIndexMax}` : '')
        );
      }
      if (a && a.aqi != null) {
        lines.push(`• **Air quality:** AQI **${a.aqi}** — ${a.category}${a.mainPollutant ? ` (main pollutant ${a.mainPollutant})` : ''}`);
      }
      const shown = parkSensors.filter((s) => !(w && !w.unavailable && ['temperature', 'humidity'].includes(s.type)) && s.type !== 'aqi');
      if (w?.unavailable) {
        // Live weather is unreachable: fall back to the stored sensor channels.
        for (const s of parkSensors.filter((x) => ['temperature', 'humidity'].includes(x.type))) {
          lines.push(`• **${SENSOR_LABELS[s.type]}:** ${s.value} ${s.unit} (latest reading, ${fmtTime(s.readAt)})`);
        }
      }
      if (shown.length) {
        lines.push(
          `• **Park sensors:** ${shown
            .map((s) => `${SENSOR_LABELS[s.type] || s.type} ${s.value} ${s.unit}${s.status === 'warning' ? ' ⚠' : ''}`)
            .join(' · ')}`
        );
      }
      if (!lines.length) return `No current readings are available for ${location}.`;
      const when = w?.observedAt || a?.observedAt;
      return (
        `**Current conditions — ${location}**\n\n${lines.join('\n')}` +
        (a?.advice ? `\n\n${a.advice}` : '') +
        `\n\n${when ? `Observed ${fmtTime(when)} IST. ` : ''}Weather and air quality from Open-Meteo${offlineSensors ? `; ${plural(offlineSensors, 'sensor')} offline` : ''}.`
      );
    }

    case 'myTasks': {
      const filter = priorityFromText(question);
      const r = await lookup('get_my_tasks', filter, ctx, used);
      if (!r.ok) return r.error;
      const { workOrders, incidents, total, filter: label } = r.data;
      const what = label ? ` of ${label}` : '';
      if (!total) {
        if (!label) return 'You have no open tasks assigned to you right now.';
        // Say what *is* on their list, so "none" is not a dead end.
        const all = await lookup('get_my_tasks', {}, ctx, used);
        const rest = all.ok ? all.data.total : 0;
        return `You have no open tasks${what} assigned to you right now.` +
          (rest ? ` You do have ${plural(rest, 'open task')} at a lower priority — ask "what are my tasks?" to see them.` : '');
      }

      const parts = [`**You have ${plural(total, 'open task')}${what}** assigned to you${workOrders.overdue ? ` — ${workOrders.overdue} overdue` : ''}.`];
      if (workOrders.count) {
        parts.push(
          `**Work orders (${workOrders.count})**\n` +
            workOrders.items
              .slice(0, 6)
              .map((o) => `• ${workOrderLine(o)}`)
              .join('\n') +
            (workOrders.count > 6 ? `\n• …and ${workOrders.count - 6} more on the Maintenance page` : '')
        );
      }
      if (incidents.count) {
        parts.push(
          `**Incidents (${incidents.count})**\n` +
            incidents.items
              .slice(0, 5)
              .map((i) => `• [${i.priority.toUpperCase()} ${i.priorityScore}/100] ${i.title} — ${i.park}, ${i.status}, ${plural(i.ageDays, 'day')} old`)
              .join('\n') +
            (incidents.count > 5 ? `\n• …and ${incidents.count - 5} more on the Incidents page` : '')
        );
      }
      return { text: parts.join('\n\n'), citations: r.citations };
    }

    case 'pendingReviews': {
      const r = await lookup('get_pending_reviews', { park: parkArg }, ctx, used);
      if (!r.ok) return r.error;
      const { total, citizenReports: c, wildlifeSightings: s, aiDetections: d } = r.data;
      if (!total) return `Nothing is waiting for review ${scope}. The queues are clear.`;
      const oldest = [...c.oldest.map((x) => ({ what: `report "${x.title}"`, park: x.park, days: x.waitingDays }))]
        .concat(s.oldest.map((x) => ({ what: `${x.species} sighting`, park: x.park, days: x.waitingDays })))
        .sort((a, b) => b.days - a.days)[0];
      return {
        text:
          `**${plural(total, 'item')} ${total === 1 ? 'is' : 'are'} awaiting review** ${scope}:\n\n` +
          `• Citizen reports: **${c.awaitingReview}** (${c.submitted} new, ${c.inReview} in review)\n` +
          `• Wildlife sightings to verify: **${s.awaitingVerification}**\n` +
          `• AI detections to confirm: **${d.awaitingReview}**` +
          (oldest ? `\n\nLongest waiting: the ${oldest.what} at ${oldest.park}, ${plural(oldest.days, 'day')}.` : ''),
        citations: r.citations,
      };
    }

    case 'myReports': {
      const r = await lookup('get_my_reports', {}, ctx, used);
      if (!r.ok) return r.error;
      const { total, byStatus, reports } = r.data;
      if (!total) return 'You have not submitted any reports yet. You can file one from the Citizen Portal.';
      const summary = Object.entries(byStatus).map(([k, v]) => `${v} ${k}`).join(', ');
      return {
        text:
          `**You have submitted ${plural(total, 'report')}** (${summary}):\n\n` +
          reports
            .slice(0, 6)
            .map((x) => `• ${x.reference} · ${x.title} — ${x.park}, **${x.status}**${x.officialResponse ? `. Response: "${x.officialResponse.slice(0, 120)}"` : ''}`)
            .join('\n'),
        citations: r.citations,
      };
    }

    case 'alerts': {
      const r = await lookup('get_alerts', { park: parkArg }, ctx, used);
      if (!r.ok) return r.error;
      const { activeAlerts, bySeverity, latest } = r.data;
      if (!activeAlerts) return `There are no active alerts ${scope}.`;
      const counts = ['critical', 'high', 'medium', 'low'].filter((k) => bySeverity[k]).map((k) => `${bySeverity[k]} ${k}`).join(', ');
      return (
        `**${plural(activeAlerts, 'active alert')}** ${scope} (${counts}). Most recent:\n\n` +
        latest.slice(0, 5).map((a) => `• [${a.severity.toUpperCase()}] ${a.title}${a.park ? ` — ${a.park}` : ''}, ${fmtTime(a.raisedAt)}`).join('\n')
      );
    }

    case 'health': {
      const health = await computeEcosystemHealth(park?._id || null);
      const s = health.subIndices;
      if (health.ecosystemHealth === null) {
        return `No indicator has data ${scope} yet, so the Ecosystem Health Index cannot be computed.`;
      }
      return (
        `The Ecosystem Health Index ${scope} is **${health.ecosystemHealth}/100** (${health.grade}).\n\n` +
        `It is a weighted mean of the sub-indices that have data:\n` +
        `• Air quality ${outOf100(s.airQuality)} (weight ${round2(health.weights.air)})\n` +
        `• Water quality ${outOf100(s.waterQuality)} (weight ${round2(health.weights.water)})\n` +
        `• Soil health ${outOf100(s.soilHealth)} (weight ${round2(health.weights.soil)})\n` +
        `• Tree health ${outOf100(s.treeHealth)} (weight ${round2(health.weights.tree)})\n` +
        `• Biodiversity ${outOf100(s.biodiversity)} (weight ${round2(health.weights.biodiversity)})\n\n` +
        `The lowest-scoring component is the one to act on first.`
      );
    }

    case 'airQuality': {
      const filter = { type: 'aqi', active: true, status: { $ne: 'offline' }, lastReadingAt: { $ne: null } };
      if (park) filter.park = park._id;
      const sensors = await Sensor.find(filter).populate('park', 'name').lean();
      if (!sensors.length) {
        return `No air quality sensor is currently reporting ${scope}. Check the Sensors module for offline devices.`;
      }
      const mean = sensors.reduce((sum, x) => sum + x.currentValue, 0) / sensors.length;
      const { describeAqi } = require('./aqi.service');
      const band = describeAqi(mean);
      const latest = sensors.reduce((a, b) => (a.lastReadingAt > b.lastReadingAt ? a : b));
      const source = sensors.every((x) => x.source === 'open-meteo')
        ? 'Readings come from Open-Meteo CAMS pollutant concentrations for each park, scored with the CPCB breakpoints.'
        : 'Readings include modelled sensor channels.';
      return (
        `The AQI ${scope} is **${Math.round(mean)}** — CPCB category **${band.label}**.\n\n` +
        `${band.advice}\n\n` +
        `${source} Latest observation: ${new Date(latest.lastReadingAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}.`
      );
    }

    case 'biodiversity': {
      const bio = await analyseBiodiversity({ parkId: park?._id || null });
      if (!bio.richness) {
        return `No verified species observations have been recorded ${scope} yet. Citizen sightings become countable once an officer verifies them.`;
      }
      const topSpecies = bio.species.slice(0, 3).map((s) => `${s.commonName || s.scientificName} (${s.count})`).join(', ');
      return (
        `Biodiversity ${scope} scores **${bio.score}/100**.\n\n` +
        `• Species recorded: ${bio.richness}\n` +
        `• Species of elevated IUCN concern: ${bio.threatenedSpecies}\n\n` +
        `Most recorded: ${topSpecies}. Abundance counts observation records, largely from GBIF (eBird, iNaturalist), plus sightings verified in this portal.` +
        (bio.invasiveCount ? `\n\n⚠ ${bio.invasiveCount} records belong to species listed as invasive in India (GRIIS).` : '')
      );
    }

    case 'incidents': {
      const filter = priorityFromText(question);
      const r = await lookup('get_incidents', { park: parkArg, ...filter, limit: 5 }, ctx, used);
      if (!r.ok) return r.error;
      const { openIncidents, byPriority, incidents, filter: label } = r.data;
      const what = label ? ` of ${label}` : '';
      if (!openIncidents) return `There are no open incidents${what} ${scope} right now.`;
      const levels = ['critical', 'high', 'medium', 'low'].filter((k) => byPriority[k]);
      const counts = levels.length > 1 ? ` (${levels.map((k) => `${byPriority[k]} ${k}`).join(', ')})` : '';
      const head = `**${plural(openIncidents, 'open incident')}${what}** ${scope}${counts}.`;
      if (!incidents) return `${head}\n\nIncident details are visible to park staff only. You can follow your own reports from the Citizen Portal.`;
      return {
        text:
          `${head} Highest priority first:\n\n` +
          incidents
            .map((i) => `• [${i.priority.toUpperCase()} ${i.priorityScore}/100] ${i.title} — ${i.park}, ${i.status}${i.assignedToYou ? ' · **assigned to you**' : i.assignee ? ` · ${i.assignee}` : i.assigned === false || i.assignee === null ? ' · unassigned' : ''}`)
            .join('\n') +
          (openIncidents > incidents.length ? `\n\nThe full queue is on the Incidents page.` : ''),
        citations: r.citations,
      };
    }

    case 'maintenance': {
      const filter = priorityFromText(question);
      const overdueOnly = /\b(overdue|late|behind)\b/.test(question.toLowerCase());
      const r = await lookup('get_maintenance', { park: parkArg, ...filter, overdueOnly }, ctx, used);
      if (!r.ok) return r.error;
      const { open, overdue, workOrders, filter: label, listScope } = r.data;
      const what = label ? ` of ${label}` : '';
      const head = `**${plural(open, 'open work order')}${what}** ${scope}${overdue ? `, **${overdue} overdue**` : ''}.`;
      if (!workOrders) return `${head}\n\nWork-order details are visible to park staff only.`;
      const mine = listScope === 'work orders assigned to you';
      if (!workOrders.length) {
        return `${head}\n\n${mine ? `None of ${overdueOnly ? 'the overdue ones' : 'them'} are assigned to you.` : overdueOnly ? 'Nothing is overdue.' : 'Nothing is scheduled.'}`;
      }
      return {
        text:
          `${head}${overdueOnly ? ' Overdue' : ' Next up'}${mine ? ' on your list' : ''}:\n\n` +
          workOrders
            .slice(0, 5)
            .map((w) => `• ${workOrderLine(w)}${w.assignedToYou && !mine ? ' · **yours**' : ''}`)
            .join('\n'),
        citations: r.citations,
      };
    }

    case 'assets': {
      const filter = park ? { park: park._id, active: true } : { active: true };
      const byType = await Asset.aggregate([
        { $match: filter },
        { $group: { _id: '$type', count: { $sum: 1 }, avgCondition: { $avg: '$condition' } } },
        { $sort: { count: -1 } },
      ]);
      if (!byType.length) return `No assets are registered ${scope}.`;
      const lines = byType
        .map((t) => `• ${t.count} × ${t._id} — mean condition ${Math.round(t.avgCondition)}/100`)
        .join('\n');
      return `Asset inventory ${scope}:\n\n${lines}\n\nAssets below a condition of 30 are marked critical and should be prioritised for a work order.`;
    }

    case 'sensors': {
      const filter = park ? { park: park._id, active: true } : { active: true };
      const sensors = await Sensor.find(filter).populate('park', 'name').lean();
      if (!sensors.length) return `No sensors are deployed ${scope}.`;
      const offline = sensors.filter((s) => s.status === 'offline');
      const lines = sensors
        .slice(0, 8)
        .map((s) => `• ${s.name} (${s.type}): ${s.currentValue} ${s.unit} — ${s.status}`)
        .join('\n');
      return `${sensors.length} sensor${sensors.length === 1 ? '' : 's'} deployed ${scope}:\n\n${lines}` +
        (offline.length ? `\n\n⚠ ${offline.length} sensor${offline.length === 1 ? ' is' : 's are'} offline and excluded from scoring.` : '');
    }

    case 'parks': {
      if (park) {
        const full = await Park.findById(park._id).lean();
        return (
          `**${full.name}** — ${full.description}\n\n` +
          `• Area: ${full.areaAcres} acres (from the OpenStreetMap boundary)\n` +
          (full.establishedYear ? `• Established: ${full.establishedYear}\n` : '') +
          (full.manager ? `• Managed by: ${full.manager}\n` : '') +
          (full.openingHours ? `• Opening hours: ${full.openingHours}\n` : '') +
          `• Facilities mapped: ${(full.facilities || []).join(', ') || 'none recorded'}\n` +
          `• Ecosystem Health Index: ${outOf100(full.scores?.ecosystemHealth)}`
        );
      }
      const parks = await Park.find({ active: true }).sort({ 'scores.ecosystemHealth': -1 }).lean();
      const lines = parks
        .map((p) => `• ${p.name} — ${p.areaAcres} acres, health ${outOf100(p.scores?.ecosystemHealth)}`)
        .join('\n');
      return `${parks.length} parks are monitored, ranked by ecosystem health:\n\n${lines}`;
    }

    case 'tips': {
      const health = await computeEcosystemHealth(park?._id || null);
      const weakest = Object.entries(health.subIndices).filter(([, v]) => v !== null).sort((a, b) => a[1] - b[1])[0];
      if (!weakest) return `No indicator has data ${scope} yet, so there is no weakest component to advise on.`;
      const advice = {
        airQuality: 'Plant a dense buffer of broad-leaved species along the road-facing boundary; leaf surface area is the main driver of particulate capture.',
        waterQuality: 'Trace and cut nutrient runoff at the source. A vegetated buffer strip around the water body intercepts most fertiliser inflow.',
        soilHealth: 'Mulch exposed beds and reduce compaction on desire lines. Soil moisture recovers far faster under leaf litter than under bare earth.',
        treeHealth: 'Prioritise inspection of assets below 50 condition, and stagger replanting so the canopy is not all one age class.',
        biodiversity: 'Add native host plants rather than ornamentals — evenness improves faster when you support the species that are already present.',
      };
      return (
        `The weakest component ${scope} is **${weakest[0]}** at ${percent(weakest[1])}/100.\n\n` +
        `${advice[weakest[0]] || 'Focus monitoring effort on this indicator.'}\n\n` +
        `General practice: keep to marked trails, take litter home, never feed wildlife, and report anything unusual through the Citizen Portal — verified reports feed straight into the biodiversity indices.`
      );
    }

    default: {
      if (!hits.length) {
        return (
          `I could not find anything in the park database matching that question.\n\n` +
          `I can answer questions about: current weather and air quality at a park, ` +
          `ecosystem health scores, biodiversity and species records, alerts, incidents, ` +
          `maintenance work, sensor readings and park information` +
          (tools.can(ctx, 'officer') ? ', plus your assigned tasks and the review queues' : ctx?.user ? ', plus the status of your own reports' : '') +
          `. Try naming a specific park.`
        );
      }
      const lines = hits
        .slice(0, 3)
        .map((h) => `• **${h.label}** (${h.entity}) — relevance ${h.score}`)
        .join('\n');
      return `Here is what the database holds that matches your question:\n\n${lines}\n\nAsk about a specific park, species, or incident for more detail.`;
    }
  }
}

/**
 * Answer a question.
 *
 * The asker decides what the answer may contain: the same access rules as
 * the language-model engine apply, through the shared tool layer.
 *
 * @param {string} question
 * @param {object} [options]
 * @param {object|null} [options.user] the signed-in User document, or null for a guest
 * @param {object} [options.context] a pre-built tool context (see assistant-tools `buildContext`)
 * @returns {Promise<{answer:string, intent:string, intentConfidence:number,
 *   citations:Array<{label:string,entity:string,entityId:string,score:number}>,
 *   toolsUsed:string[], latencyMs:number}>}
 */
async function ask(question, { user = null, context } = {}) {
  const startedAt = Date.now();
  const ctx = context || (await tools.buildContext(user));
  const tokens = tokenise(question);
  const { intent, confidence } = classifyIntent(tokens, question);

  const hits = await retrieve(question, { k: 5, entities: tools.searchableEntities(ctx) });
  const used = [];
  const composed = await compose(intent, question, hits, ctx, used);
  const answer = typeof composed === 'string' ? composed : composed.text;

  // A lookup's own records are better sources than loose keyword matches.
  const fromTools = typeof composed === 'string' ? [] : composed.citations || [];
  const citations = fromTools.length
    ? fromTools.slice(0, 8)
    : hits.map((h) => ({ label: h.label, entity: h.entity, entityId: h.id, score: h.score }));

  return {
    answer,
    intent,
    intentConfidence: Math.round(confidence * 100) / 100,
    citations,
    toolsUsed: used,
    latencyMs: Date.now() - startedAt,
  };
}

/** Suggested prompts shown in the empty chat state, for anyone. */
const SUGGESTED_QUESTIONS = [
  'What is the climate condition of Cubbon Park?',
  'How is the air quality at Lalbagh right now?',
  'Which park has the best ecosystem health?',
  'Which birds are recorded at Sankey Tank?',
  'Are there any active alerts?',
  'How can we improve the weakest indicator?',
];

/**
 * Suggestions for the asker's role, so the empty state shows questions the
 * assistant will actually answer for them.
 *
 * @param {{access:string, homePark?:{name:string}|null}} ctx
 */
function suggestionsFor(ctx) {
  const home = ctx?.homePark?.name;
  switch (ctx?.access) {
    case 'admin':
      return [
        'Tell me the count of pending reviews',
        'Show the critical incidents across all parks',
        'What maintenance work is overdue?',
        'What is the climate condition of Cubbon Park?',
        'Which park has the worst ecosystem health?',
        'Are there any active alerts?',
      ];
    case 'officer':
      return [
        'Tell me the high priority tasks assigned to me',
        'Tell me the count of pending reviews',
        home ? `What is the climate condition of ${home}?` : 'What is the climate condition of Cubbon Park?',
        home ? `Show the open incidents at ${home}` : 'Show the open incidents by priority',
        'What maintenance work is overdue?',
        'Are there any active alerts?',
      ];
    case 'citizen':
      return [
        'What is the status of my reports?',
        home ? `What is the weather at ${home} right now?` : 'What is the climate condition of Cubbon Park?',
        'How is the air quality at Lalbagh right now?',
        'Which park has the best ecosystem health?',
        'Which birds are recorded at Sankey Tank?',
        'How can I help protect the parks?',
      ];
    default:
      return SUGGESTED_QUESTIONS;
  }
}

module.exports = {
  ask,
  retrieve,
  tokenise,
  classifyIntent,
  detectPersonalIntent,
  priorityFromText,
  compose,
  getCorpus,
  buildCorpus,
  suggestionsFor,
  SUGGESTED_QUESTIONS,
  INTENTS,
};

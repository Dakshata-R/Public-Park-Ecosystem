'use strict';

/**
 * Incident triage — Module 8.
 *
 * The zeroth-review deck names "priority-based solving" as a differentiator,
 * so priority is computed rather than typed in by whoever files the report.
 *
 * ---------------------------------------------------------------------------
 * The score
 * ---------------------------------------------------------------------------
 *   P = 100 · ( 0.35·H + 0.25·Ŝ + 0.20·Ê + 0.10·Û + 0.10·Ĉ )
 *
 *   H  hazard weight of the incident type, in [0, 1] — a fire is not a
 *      fallen branch, and no amount of upvotes should make it one
 *   Ŝ  reported severity, (s − 1)/4 for s ∈ 1…5
 *   Ê  exposure, log-scaled: ln(1 + people) / ln(1 + 5000), capped at 1.
 *      Logarithmic because the difference between 10 and 100 people affected
 *      matters far more than between 4 000 and 4 090
 *   Û  urgency from age — how long the incident has waited unresolved
 *   Ĉ  community signal, ln(1 + upvotes) / ln(1 + 200), capped at 1
 *
 * ---------------------------------------------------------------------------
 * Ageing (why Û is not simply "older = higher")
 * ---------------------------------------------------------------------------
 * An unattended incident must climb the queue or it starves behind a stream of
 * newer, slightly-higher-scoring ones. Urgency saturates on a bounded curve
 *
 *   Û(t) = 1 − e^(−t / τ)
 *
 * where t is hours since it was reported and τ is the type's target response
 * time. At t = τ the incident has ~63 % of the ageing weight, at t = 3τ it is
 * at 95 % — so it rises quickly while genuinely late and then stops growing,
 * rather than eventually outranking a new fire.
 *
 * Resolved and closed incidents stop ageing.
 */

/**
 * Per-type hazard weight H and target response time τ (hours).
 * τ values follow the response targets used in the Week-6 module revision.
 */
const TYPE_PROFILE = {
  fire:                    { hazard: 1.0,  responseHours: 0.5,  label: 'Fire' },
  'water-pollution':       { hazard: 0.8,  responseHours: 6,    label: 'Water pollution' },
  'air-pollution':         { hazard: 0.75, responseHours: 8,    label: 'Air pollution' },
  'tree-fall':             { hazard: 0.7,  responseHours: 4,    label: 'Tree fall' },
  'infrastructure-damage': { hazard: 0.6,  responseHours: 24,   label: 'Infrastructure damage' },
  'illegal-dumping':       { hazard: 0.5,  responseHours: 24,   label: 'Illegal dumping' },
  'dead-animal':           { hazard: 0.45, responseHours: 12,   label: 'Dead animal' },
  vandalism:               { hazard: 0.4,  responseHours: 48,   label: 'Vandalism' },
};

const DEFAULT_PROFILE = { hazard: 0.5, responseHours: 24, label: 'Other' };

/** Score bands. Ordered high→low; the first match wins. */
const PRIORITY_BANDS = [
  { min: 75, priority: 'critical' },
  { min: 55, priority: 'high' },
  { min: 35, priority: 'medium' },
  { min: 0,  priority: 'low' },
];

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * Compute the triage score for an incident.
 *
 * @param {object} incident
 * @param {string} incident.type
 * @param {number} [incident.severity=3]        1–5
 * @param {number} [incident.affectedPeople=0]
 * @param {number} [incident.upvotes=0]         Community signal from the linked citizen report
 * @param {Date|string} [incident.reportedAt]   Defaults to now
 * @param {string} [incident.status='reported']
 * @param {Date} [now]                          Injectable clock, for tests
 * @returns {{score:number, priority:string, ageHours:number, factors:object, explanation:string}}
 */
function scoreIncident(incident = {}, now = new Date()) {
  const profile = TYPE_PROFILE[incident.type] || DEFAULT_PROFILE;

  // H — hazard weight of the type
  const hazard = profile.hazard;

  // Ŝ — reported severity on 1…5 mapped to [0, 1]
  const severity = clamp01((Number(incident.severity ?? 3) - 1) / 4);

  // Ê — exposure, log-scaled and capped
  const people = Math.max(0, Number(incident.affectedPeople ?? 0));
  const exposure = clamp01(Math.log1p(people) / Math.log1p(5000));

  // Û — ageing; frozen once the incident is closed out
  const reportedAt = incident.reportedAt ? new Date(incident.reportedAt) : now;
  const isOpen = !['resolved', 'closed'].includes(incident.status || 'reported');
  const ageHours = Math.max(0, (now - reportedAt) / 3_600_000);
  const urgency = isOpen ? clamp01(1 - Math.exp(-ageHours / profile.responseHours)) : 0;

  // Ĉ — community signal
  const upvotes = Math.max(0, Number(incident.upvotes ?? 0));
  const community = clamp01(Math.log1p(upvotes) / Math.log1p(200));

  const score =
    100 *
    (0.35 * hazard + 0.25 * severity + 0.2 * exposure + 0.1 * urgency + 0.1 * community);

  const rounded = Math.round(score * 10) / 10;
  const band = PRIORITY_BANDS.find((b) => rounded >= b.min) || PRIORITY_BANDS[PRIORITY_BANDS.length - 1];

  const factors = {
    hazard: Math.round(hazard * 1000) / 1000,
    severity: Math.round(severity * 1000) / 1000,
    exposure: Math.round(exposure * 1000) / 1000,
    urgency: Math.round(urgency * 1000) / 1000,
    community: Math.round(community * 1000) / 1000,
  };

  const overdue = isOpen && ageHours > profile.responseHours;
  const explanation =
    `${profile.label} at severity ${incident.severity ?? 3}/5` +
    (people ? `, ~${people} people affected` : '') +
    (overdue ? `, ${Math.round(ageHours)} h old against a ${profile.responseHours} h target` : '') +
    ` → ${rounded}/100 (${band.priority}).`;

  return {
    score: rounded,
    priority: band.priority,
    ageHours: Math.round(ageHours * 10) / 10,
    responseTargetHours: profile.responseHours,
    isOverdue: overdue,
    factors,
    explanation,
  };
}

/**
 * Order a list of incidents the way the triage queue should present them:
 * highest score first, then oldest first as the tie-breaker.
 *
 * @template {{type:string}} T
 * @param {T[]} incidents
 * @returns {(T & {triage: ReturnType<typeof scoreIncident>})[]}
 */
function buildTriageQueue(incidents = [], now = new Date()) {
  return incidents
    .map((incident) => ({ ...incident, triage: scoreIncident(incident, now) }))
    .sort((a, b) => {
      if (b.triage.score !== a.triage.score) return b.triage.score - a.triage.score;
      return new Date(a.reportedAt || 0) - new Date(b.reportedAt || 0);
    });
}

module.exports = { scoreIncident, buildTriageQueue, TYPE_PROFILE, PRIORITY_BANDS };

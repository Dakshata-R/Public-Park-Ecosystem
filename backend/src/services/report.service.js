'use strict';

/**
 * Ecological report generation — Module 10.
 *
 * A report is a frozen snapshot: metrics computed from the database over a
 * period, plus findings and recommendations derived from those metrics by
 * stated rules. Nothing in a generated report is written by hand, so every
 * sentence can be traced to a number in `metrics`.
 */

const { Park, Incident, CitizenReport, WorkOrder, SensorReading, AiDetection, EcoReport } = require('../models');
const { REPORT_TYPES } = require('../models/EcoReport');
const { analyseBiodiversity } = require('./biodiversity.service');
const { computeEcosystemHealth } = require('./ecosystem-score.service');
const ApiError = require('../utils/ApiError');

const round1 = (v) => (v === null || v === undefined ? null : Math.round(v * 10) / 10);
const pct = (part, whole) => (whole ? round1((part / whole) * 100) : null);

const TITLES = {
  ecosystem: 'Ecosystem Health Assessment',
  biodiversity: 'Biodiversity Assessment',
  water: 'Water Quality Review',
  air: 'Air Quality Review',
  soil: 'Soil Moisture Review',
  maintenance: 'Maintenance and Asset Review',
  engagement: 'Citizen Engagement Report',
};

const SUB_INDEX_LABELS = {
  airQuality: 'Air quality',
  waterQuality: 'Water quality',
  soilHealth: 'Soil health',
  treeHealth: 'Tree health',
  biodiversity: 'Biodiversity',
};

/** Mean, extremes and anomaly count of one sensor type over the period. */
async function sensorSummary(type, match) {
  const [row] = await SensorReading.aggregate([
    { $match: { ...match, type } },
    {
      $group: {
        _id: null,
        mean: { $avg: '$value' },
        min: { $min: '$value' },
        max: { $max: '$value' },
        readings: { $sum: 1 },
        anomalies: { $sum: { $cond: ['$isAnomaly', 1, 0] } },
        sources: { $addToSet: '$source' },
      },
    },
  ]);
  return row ? { mean: round1(row.mean), min: row.min, max: row.max, readings: row.readings, anomalies: row.anomalies, sources: row.sources } : null;
}

/** All metrics for a park (or the network) over [from, to]. */
async function collectMetrics({ parkId, from, to }) {
  const park = parkId ? { park: parkId } : {};
  const window = { $gte: from, $lte: to };

  const [health, biodiversityAll, biodiversityPeriod, incidents, reports, orders, detections, aqi, water, soil, noise] = await Promise.all([
    computeEcosystemHealth(parkId),
    analyseBiodiversity({ parkId }),
    analyseBiodiversity({ parkId, since: from }),
    Incident.find({ ...park, reportedAt: window }).select('type status priority resolutionMinutes').lean(),
    CitizenReport.find({ ...park, createdAt: window }).select('category status upvotes').lean(),
    WorkOrder.find({ ...park, scheduledDate: window }).select('status actualCost estimatedCost').lean(),
    AiDetection.find({ ...park, createdAt: window }).select('task severity reviewStatus').lean(),
    sensorSummary('aqi', { ...park, recordedAt: window }),
    sensorSummary('water', { ...park, recordedAt: window }),
    sensorSummary('soil', { ...park, recordedAt: window }),
    sensorSummary('noise', { ...park, recordedAt: window }),
  ]);

  const resolved = incidents.filter((i) => ['resolved', 'closed'].includes(i.status));
  const resolutionHours = resolved.filter((i) => i.resolutionMinutes != null).map((i) => i.resolutionMinutes / 60);
  const completed = orders.filter((o) => o.status === 'completed');

  return {
    ecosystemHealth: health.ecosystemHealth,
    healthGrade: health.grade,
    subIndices: health.subIndices,
    biodiversity: {
      score: biodiversityAll.richness ? biodiversityAll.score : null,
      richness: biodiversityAll.richness,
      shannon: biodiversityAll.shannon,
      evenness: biodiversityAll.evenness,
      threatenedSpecies: biodiversityAll.threatenedSpecies,
      invasiveRecords: biodiversityAll.invasiveCount,
      richnessInPeriod: biodiversityPeriod.richness,
      recordsInPeriod: biodiversityPeriod.total,
      topSpecies: biodiversityAll.species.slice(0, 5).map((s) => ({ commonName: s.commonName || s.scientificName, records: s.count })),
    },
    incidents: {
      total: incidents.length,
      resolved: resolved.length,
      resolutionRate: pct(resolved.length, incidents.length),
      avgResolutionHours: resolutionHours.length ? round1(resolutionHours.reduce((a, b) => a + b, 0) / resolutionHours.length) : null,
      critical: incidents.filter((i) => i.priority === 'critical').length,
    },
    citizenReports: {
      total: reports.length,
      accepted: reports.filter((r) => ['accepted', 'resolved'].includes(r.status)).length,
      sightings: reports.filter((r) => r.category === 'wildlife-sighting').length,
      upvotes: reports.reduce((sum, r) => sum + (r.upvotes || 0), 0),
    },
    maintenance: {
      total: orders.length,
      completed: completed.length,
      overdue: orders.filter((o) => o.status === 'overdue').length,
      completionRate: pct(completed.length, orders.length),
      actualCost: completed.reduce((sum, o) => sum + (o.actualCost || 0), 0),
    },
    aiDetections: {
      total: detections.length,
      reviewed: detections.filter((d) => d.reviewStatus !== 'pending').length,
      confirmed: detections.filter((d) => d.reviewStatus === 'confirmed').length,
    },
    sensors: { aqi, water, soil, noise },
  };
}

/** Findings and recommendations, each derived from a metric by a stated rule. */
function interpret(type, m) {
  const findings = [];
  const recommendations = [];

  const measured = Object.entries(m.subIndices).filter(([, v]) => v !== null);
  const weakest = measured.sort((a, b) => a[1] - b[1])[0];

  if (['ecosystem'].includes(type)) {
    if (m.ecosystemHealth === null) {
      findings.push('No indicator had data in this period, so the Ecosystem Health Index could not be computed.');
    } else {
      findings.push(`The Ecosystem Health Index stands at ${m.ecosystemHealth}/100 (${m.healthGrade}), computed from ${measured.length} of 5 sub-indices.`);
      if (weakest) findings.push(`${SUB_INDEX_LABELS[weakest[0]]} is the weakest component at ${weakest[1]}/100.`);
    }
    if (weakest && weakest[1] < 55) recommendations.push(`Prioritise ${SUB_INDEX_LABELS[weakest[0]].toLowerCase()}: it is below the "moderate" band (55).`);
  }

  if (['ecosystem', 'biodiversity'].includes(type)) {
    const b = m.biodiversity;
    if (!b.richness) {
      findings.push('No verified species observations are recorded, so biodiversity indices are unavailable.');
      recommendations.push('Run a structured survey or verify pending citizen sightings to establish a baseline.');
    } else {
      findings.push(`${b.richness} species are on record.`);
      findings.push(`In this period, ${b.recordsInPeriod} observation records covered ${b.richnessInPeriod} species.`);
      if (b.topSpecies.length) findings.push(`Most recorded: ${b.topSpecies.slice(0, 3).map((s) => `${s.commonName} (${s.records})`).join(', ')}.`);
      if (b.threatenedSpecies) findings.push(`${b.threatenedSpecies} species of elevated IUCN concern (Near Threatened or worse) are recorded.`);
      if (b.invasiveRecords) {
        findings.push(`${b.invasiveRecords} records belong to species flagged invasive in India (GRIIS).`);
        recommendations.push('Map and schedule removal of invasive plant stands; prioritise those adjacent to water.');
      }
      if (b.evenness < 0.6) recommendations.push('Evenness is low — a few species dominate. Favour native understorey planting over further ornamental beds.');
    }
  }

  const sensorTypes = { air: ['aqi', 'AQI'], water: ['water', 'water quality index'], soil: ['soil', 'soil moisture (%)'] };
  if (sensorTypes[type] || type === 'ecosystem') {
    for (const [key, label] of Object.values(sensorTypes)) {
      if (type !== 'ecosystem' && sensorTypes[type][0] !== key) continue;
      const s = m.sensors[key];
      if (!s) {
        if (type !== 'ecosystem') findings.push(`No ${label} readings were recorded in this period.`);
        continue;
      }
      const simulated = s.sources.includes('simulated') ? ' (modelled channel)' : s.sources.includes('open-meteo') ? ' (Open-Meteo)' : '';
      findings.push(`Mean ${label} was ${s.mean}${simulated}, ranging ${s.min}–${s.max} across ${s.readings} readings, with ${s.anomalies} flagged anomalies.`);
      if (key === 'aqi' && s.mean > 100) recommendations.push('Mean AQI exceeds 100 (CPCB "satisfactory" ceiling). Publish daily advisories at entrances and extend roadside buffer planting.');
      if (key === 'water' && s.mean < 50) recommendations.push('Water quality index is below 50. Sample for nutrients at inflows and schedule weed removal.');
      if (key === 'soil' && s.mean < 30) recommendations.push('Soil moisture is below 30 %. Mulch exposed beds and review irrigation schedules.');
    }
  }

  if (['ecosystem', 'maintenance'].includes(type)) {
    const i = m.incidents;
    const w = m.maintenance;
    findings.push(`${i.total} incidents were reported and ${i.resolved} resolved${i.resolutionRate !== null ? ` (${i.resolutionRate} %)` : ''}${i.avgResolutionHours !== null ? `, averaging ${i.avgResolutionHours} h to resolve` : ''}.`);
    findings.push(`${w.total} work orders were scheduled; ${w.completed} completed${w.completionRate !== null ? ` (${w.completionRate} %)` : ''} at a recorded cost of ₹${w.actualCost.toLocaleString('en-IN')}.`);
    if (w.overdue) recommendations.push(`${w.overdue} work orders are overdue — rebalance crew allocation or reschedule.`);
    if (i.critical) recommendations.push(`${i.critical} critical incidents occurred; review response times against the triage targets.`);
  }

  if (type === 'engagement') {
    const c = m.citizenReports;
    findings.push(`Citizens submitted ${c.total} reports, of which ${c.accepted} were accepted and ${c.sightings} were wildlife sightings.`);
    findings.push(`Reports received ${c.upvotes} community upvotes in total.`);
    if (c.total && c.accepted / c.total < 0.5) recommendations.push('Fewer than half of submissions were accepted. Publish reporting guidance to improve report quality.');
    if (!c.total) recommendations.push('No citizen reports were received. Promote the portal at park entrances.');
  }

  if (!recommendations.length) recommendations.push('No metric crossed an action threshold in this period. Continue routine monitoring.');
  return { findings, recommendations };
}

/**
 * Build and save a draft report.
 *
 * @param {{type: string, parkId?: string|null, days?: number, user?: object, now?: Date}} input
 */
async function generateReport({ type, parkId = null, days = 90, user = null, now = new Date() }) {
  if (!REPORT_TYPES.includes(type)) {
    throw ApiError.badRequest(`\`type\` must be one of: ${REPORT_TYPES.join(', ')}`);
  }
  const park = parkId ? await Park.findById(parkId).select('name').lean() : null;
  if (parkId && !park) throw ApiError.badRequest('The selected park does not exist');

  const to = now;
  const from = new Date(to.getTime() - days * 86_400_000);
  const metrics = await collectMetrics({ parkId: park?._id || null, from, to });
  const { findings, recommendations } = interpret(type, metrics);

  const scope = park ? park.name : 'All monitored parks';
  return EcoReport.create({
    title: `${TITLES[type]} — ${scope}`,
    type,
    summary: `${TITLES[type]} for ${scope}, covering ${from.toDateString()} to ${to.toDateString()}. Generated from recorded data; every finding is derived from the metrics stored with this report.`,
    park: park?._id || null,
    author: user?._id || null,
    authorName: user?.name || 'GreenPulse',
    periodStart: from,
    periodEnd: to,
    metrics,
    findings,
    recommendations,
    status: 'draft',
  });
}

module.exports = { generateReport, collectMetrics, interpret };

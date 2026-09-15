'use strict';

/**
 * Module 7 — Citizen Engagement Portal.
 *
 * The flow this module implements end to end:
 *
 *   citizen submits  →  officer reviews  →  accepted
 *                                            ├─ 'issue'   → Incident opened
 *                                            └─ 'wildlife-sighting' → verified Observation
 *
 * Acceptance is the single point where public input enters the operational
 * and scientific record, which is why it lives in one handler rather than
 * being spread across the incident and biodiversity modules.
 */

const { CitizenReport, Incident, Observation, User, Setting } = require('../models');
const { createCrudController, normaliseId } = require('./crud.factory');
const asyncHandler = require('../middleware/asyncHandler');
const { ok, created } = require('../utils/response');
const ApiError = require('../utils/ApiError');
const { generateReferenceCode } = require('./incident.controller');
const { scoreIncident } = require('../services/priority.service');
const audit = require('../services/audit.service');
const { nextCode, year } = require('../utils/sequence');
const { ROLE_RANK } = require('../middleware/auth');

const generateReportCode = () =>
  nextCode({ model: CitizenReport, field: 'referenceCode', prefix: `CR-${year()}` });

const crud = createCrudController({
  model: CitizenReport,
  name: 'Citizen report',
  filterable: ['category', 'status', 'park', 'submittedBy'],
  searchable: ['title', 'description', 'referenceCode'],
  populate: [
    { path: 'park', select: 'name slug' },
    { path: 'submittedBy', select: 'name role' },
    { path: 'species', select: 'commonName scientificName class' },
    { path: 'linkedIncident', select: 'referenceCode status priority' },
  ],
  defaultSort: { createdAt: -1 },

  beforeCreate: async (body, req) => {
    // The administrator's "public reporting" switch closes the portal to
    // citizens; staff can still log reports on someone's behalf.
    const settings = await Setting.current();
    if (!settings.enablePublicReporting && (ROLE_RANK[req.user?.role] || 0) < ROLE_RANK.officer) {
      throw ApiError.forbidden('Public reporting is currently switched off by the administrator');
    }
    return {
      ...body,
      referenceCode: await generateReportCode(),
      submittedBy: req.user?._id || null,
      submittedByName: body.submittedByName || req.user?.name || 'Anonymous',
      status: 'submitted',
    };
  },

  afterCreate: async (doc, req) => {
    if (req.user) {
      await User.updateOne({ _id: req.user._id }, { $inc: { contributions: 1 } });
    }
  },
});

/**
 * The community signal feeds the priority formula, so a linked incident's
 * mirrored upvote count and score must follow the report's.
 */
async function syncLinkedIncident(report) {
  if (!report.linkedIncident) return;
  const incident = await Incident.findById(report.linkedIncident);
  if (!incident) return;

  incident.upvotes = report.upvotes;
  const triage = scoreIncident({
    type: incident.type,
    severity: incident.severity,
    affectedPeople: incident.affectedPeople,
    upvotes: incident.upvotes,
    reportedAt: incident.reportedAt,
    status: incident.status,
  });
  incident.priorityScore = triage.score;
  incident.priority = triage.priority;
  await incident.save();
}

/**
 * POST /api/citizen/reports/:id/upvote — one signal per account per report.
 * The conditional update is atomic, so two rapid clicks cannot both count.
 */
const upvote = asyncHandler(async (req, res) => {
  const report = await CitizenReport.findOneAndUpdate(
    { _id: req.params.id, upvotedBy: { $ne: req.user._id } },
    { $addToSet: { upvotedBy: req.user._id }, $inc: { upvotes: 1 } },
    { new: true }
  );

  if (!report) {
    const existing = await CitizenReport.findById(req.params.id);
    if (!existing) throw ApiError.notFound('Citizen report');
    return ok(res, { id: existing.id, upvotes: existing.upvotes, upvoted: true });
  }

  await syncLinkedIncident(report);
  return ok(res, { id: report.id, upvotes: report.upvotes, upvoted: true });
});

/** DELETE /api/citizen/reports/:id/upvote — withdraw an upvote. */
const removeUpvote = asyncHandler(async (req, res) => {
  const report = await CitizenReport.findOneAndUpdate(
    { _id: req.params.id, upvotedBy: req.user._id },
    { $pull: { upvotedBy: req.user._id }, $inc: { upvotes: -1 } },
    { new: true }
  );

  if (!report) {
    const existing = await CitizenReport.findById(req.params.id);
    if (!existing) throw ApiError.notFound('Citizen report');
    return ok(res, { id: existing.id, upvotes: existing.upvotes, upvoted: false });
  }

  await syncLinkedIncident(report);
  return ok(res, { id: report.id, upvotes: report.upvotes, upvoted: false });
});

/** GET /api/citizen/my-upvotes — ids of the reports the caller has upvoted. */
const myUpvotes = asyncHandler(async (req, res) => {
  const reports = await CitizenReport.find({ upvotedBy: req.user._id }).select('_id').lean();
  return ok(res, reports.map((r) => String(r._id)));
});

/**
 * POST /api/citizen/reports/:id/review
 * Officer decision. Accepting an issue opens an incident; accepting a
 * sighting writes a verified observation.
 */
const review = asyncHandler(async (req, res) => {
  const { decision, officialResponse, severity, affectedPeople, incidentType, species } = req.body;

  const report = await CitizenReport.findById(req.params.id);
  if (!report) throw ApiError.notFound('Citizen report');
  if (!['accepted', 'rejected', 'in-review'].includes(decision)) {
    throw ApiError.badRequest("`decision` must be one of 'accepted', 'rejected' or 'in-review'");
  }

  report.status = decision;
  report.reviewedBy = req.user._id;
  report.officialResponse = officialResponse || '';

  let createdIncident = null;
  let createdObservation = null;

  if (decision === 'accepted') {
    if (report.category === 'issue' && !report.linkedIncident) {
      createdIncident = await Incident.create({
        referenceCode: await generateReferenceCode(),
        type: incidentType || 'infrastructure-damage',
        title: report.title,
        description: report.description,
        park: report.park,
        location: report.location,
        severity: severity ?? 3,
        affectedPeople: affectedPeople ?? 0,
        upvotes: report.upvotes,
        source: 'citizen-report',
        reportedBy: report.submittedBy,
        sourceReport: report._id,
        images: report.images,
        timeline: [
          {
            status: 'reported',
            note: `Opened from citizen report ${report.referenceCode}`,
            by: req.user._id,
            byName: req.user.name,
          },
        ],
      });

      const triage = scoreIncident({
        type: createdIncident.type,
        severity: createdIncident.severity,
        affectedPeople: createdIncident.affectedPeople,
        upvotes: report.upvotes,
        reportedAt: createdIncident.reportedAt,
        status: createdIncident.status,
      });
      createdIncident.priorityScore = triage.score;
      createdIncident.priority = triage.priority;
      await createdIncident.save();

      report.linkedIncident = createdIncident._id;
    }

    if (report.category === 'wildlife-sighting') {
      const speciesId = species || report.species;
      if (!speciesId) {
        throw ApiError.badRequest('A species must be identified before a sighting can be accepted');
      }
      createdObservation = await Observation.create({
        species: speciesId,
        park: report.park,
        observedAt: report.createdAt,
        count: req.body.count ?? 1,
        location: report.location,
        locationName: report.title,
        observer: report.submittedBy,
        observerName: report.submittedByName,
        source: 'citizen-report',
        verified: true,
        verifiedBy: req.user._id,
        notes: report.description,
        images: report.images,
      });
      report.species = speciesId;
    }
  }

  if (decision === 'accepted' || decision === 'rejected') {
    report.resolvedAt = new Date();
  }

  await report.save();

  await audit.record({
    action: 'update',
    entity: 'CitizenReport',
    entityId: report._id,
    entityLabel: report.referenceCode,
    changes: { status: { from: 'submitted', to: decision } },
    req,
  });

  return ok(res, {
    report,
    createdIncident,
    createdObservation,
  });
});

/** GET /api/citizen/my-reports — the signed-in citizen's contribution history. */
const myReports = asyncHandler(async (req, res) => {
  const reports = await CitizenReport.find({ submittedBy: req.user._id })
    .sort({ createdAt: -1 })
    .populate('park', 'name slug')
    .populate('linkedIncident', 'referenceCode status')
    .lean();

  const byStatus = reports.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  return ok(res, {
    reports: reports.map(normaliseId),
    summary: {
      total: reports.length,
      byStatus,
      totalUpvotes: reports.reduce((sum, r) => sum + (r.upvotes || 0), 0),
      contributions: req.user.contributions,
    },
  });
});

/** GET /api/citizen/stats — engagement metrics for the analytics module. */
const getStats = asyncHandler(async (_req, res) => {
  const [byCategory, byStatus, byPark, topContributors] = await Promise.all([
    CitizenReport.aggregate([{ $group: { _id: '$category', count: { $sum: 1 } } }]),
    CitizenReport.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    CitizenReport.aggregate([
      { $group: { _id: '$park', reports: { $sum: 1 }, upvotes: { $sum: '$upvotes' } } },
      { $lookup: { from: 'parks', localField: '_id', foreignField: '_id', as: 'park' } },
      { $unwind: '$park' },
      { $project: { _id: 0, park: '$park.name', reports: 1, upvotes: 1 } },
      { $sort: { reports: -1 } },
    ]),
    User.find({ role: 'citizen' }).sort({ contributions: -1 }).limit(5).select('name contributions').lean(),
  ]);

  const accepted = byStatus.find((s) => s._id === 'accepted')?.count || 0;
  const resolved = byStatus.find((s) => s._id === 'resolved')?.count || 0;
  const total = byStatus.reduce((sum, s) => sum + s.count, 0);

  return ok(res, {
    byCategory: byCategory.map((c) => ({ category: c._id, count: c.count })),
    byStatus: byStatus.map((s) => ({ status: s._id, count: s.count })),
    byPark,
    topContributors: topContributors.map(normaliseId),
    total,
    /** Share of submissions that officers acted on — the engagement quality metric. */
    acceptanceRate: total ? Math.round(((accepted + resolved) / total) * 1000) / 10 : 0,
  });
});

module.exports = { ...crud, upvote, removeUpvote, myUpvotes, review, myReports, getStats, generateReportCode };

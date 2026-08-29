'use strict';

/**
 * Module 5 — AI Ecosystem Monitoring.
 *
 * The endpoints here own the *consequences* of an inference, not the
 * inference itself: persisting the result, escalating a dangerous finding to
 * an incident, and collecting the human verdicts that would form the
 * retraining set for a real model.
 */

const { AiDetection, Incident, Setting, Park } = require('../models');
const { createCrudController, normaliseId } = require('./crud.factory');
const asyncHandler = require('../middleware/asyncHandler');
const { ok, created } = require('../utils/response');
const ApiError = require('../utils/ApiError');
const { runInference, classesFor, TASK_CLASSES, MODEL_CARDS } = require('../services/ai-inference.service');
const { generateReferenceCode } = require('./incident.controller');
const { scoreIncident } = require('../services/priority.service');
const alertService = require('../services/alert.service');

const crud = createCrudController({
  model: AiDetection,
  name: 'AI detection',
  filterable: ['task', 'severity', 'reviewStatus', 'park'],
  searchable: ['prediction', 'imageName'],
  populate: [
    { path: 'park', select: 'name slug' },
    { path: 'submittedBy', select: 'name role' },
    { path: 'linkedIncident', select: 'referenceCode priority status' },
  ],
  defaultSort: { createdAt: -1 },
});

/** Detection severity → incident type, for automatic escalation. */
const TASK_TO_INCIDENT_TYPE = {
  fire: 'fire',
  waste: 'illegal-dumping',
  'tree-disease': 'tree-fall',
};

/**
 * POST /api/ai/analyze
 * Run one image through a task classifier, store the result, and escalate
 * when the finding is both dangerous and confident.
 */
const analyze = asyncHandler(async (req, res) => {
  const { task, imageUrl, imageName, park, location } = req.body;

  if (!TASK_CLASSES[task]) {
    throw ApiError.badRequest(
      `Unknown task '${task}'. Expected one of: ${Object.keys(TASK_CLASSES).join(', ')}`
    );
  }
  if (!imageUrl) throw ApiError.badRequest('`imageUrl` is required');

  if (park && !(await Park.exists({ _id: park }))) {
    throw ApiError.badRequest('The selected park does not exist');
  }

  const result = await runInference(task, imageUrl);
  const settings = await Setting.current();

  const detection = await AiDetection.create({
    task,
    imageUrl,
    imageName: imageName || '',
    park: park || null,
    location: location || undefined,
    prediction: result.prediction,
    confidence: result.confidence,
    probabilities: result.probabilities,
    severity: result.severity,
    recommendedAction: result.recommendedAction,
    modelName: result.model.name,
    modelVersion: result.model.version,
    inferenceMs: result.inferenceMs,
    submittedBy: req.user?._id || null,
  });

  // Escalation rule: a high-or-critical finding above the configured
  // confidence floor opens an incident automatically. Below that floor it is
  // logged for human review instead — a false fire alarm is expensive.
  let escalated = null;
  const dangerous = ['high', 'critical'].includes(result.severity);
  const confident = result.confidence >= settings.aiAutoIncidentConfidence;

  if (dangerous && confident && park) {
    const incidentType = TASK_TO_INCIDENT_TYPE[task] || 'infrastructure-damage';
    escalated = await Incident.create({
      referenceCode: await generateReferenceCode(),
      type: incidentType,
      title: `AI detection: ${result.prediction}`,
      description: `${result.recommendedAction}\n\nDetected by ${result.model.name} ${result.model.version} at ${result.confidence}% confidence.`,
      park,
      location: location || (await Park.findById(park).lean()).location,
      severity: result.severity === 'critical' ? 5 : 4,
      source: 'ai-detection',
      reportedBy: req.user?._id || null,
      images: [imageUrl],
      timeline: [{ status: 'reported', note: 'Opened automatically from an AI detection', byName: result.model.name }],
    });

    const triage = scoreIncident({
      type: escalated.type,
      severity: escalated.severity,
      affectedPeople: 0,
      reportedAt: escalated.reportedAt,
      status: escalated.status,
    });
    escalated.priorityScore = triage.score;
    escalated.priority = triage.priority;
    await escalated.save();

    detection.linkedIncident = escalated._id;
    await detection.save();

    await alertService.raise({
      title: `AI: ${result.prediction}`,
      message: result.recommendedAction,
      module: 'AI Ecosystem Monitoring',
      source: 'ai',
      severity: result.severity,
      park,
      relatedModel: 'AiDetection',
      relatedId: detection._id,
      dedupeKey: `ai:${detection._id}`,
    });
  }

  return created(res, {
    detection,
    inference: {
      prediction: result.prediction,
      confidence: result.confidence,
      probabilities: result.probabilities,
      severity: result.severity,
      recommendedAction: result.recommendedAction,
      model: result.model,
      inferenceMs: result.inferenceMs,
      simulated: result.simulated,
    },
    escalated: escalated ? { id: escalated.id, referenceCode: escalated.referenceCode, priority: escalated.priority } : null,
    escalationRule: {
      dangerous,
      confident,
      confidenceFloor: settings.aiAutoIncidentConfidence,
      applied: Boolean(escalated),
      reason: escalated
        ? 'High-severity finding above the confidence floor — incident opened automatically.'
        : dangerous && !confident
        ? `Severity warranted escalation but confidence ${result.confidence}% is below the ${settings.aiAutoIncidentConfidence}% floor; queued for human review.`
        : dangerous && !park
        ? 'No park supplied, so no incident could be located; queued for human review.'
        : 'Finding does not warrant an incident.',
    },
  });
});

/** GET /api/ai/tasks — the label vocabulary and model card for each task. */
const getTasks = asyncHandler(async (_req, res) => {
  const tasks = Object.keys(TASK_CLASSES).map((task) => ({
    task,
    model: MODEL_CARDS[task],
    classes: classesFor(task),
  }));
  return ok(res, tasks);
});

/**
 * POST /api/ai/:id/review
 * Human-in-the-loop verification. `correctedLabel` is what a retraining
 * pipeline would consume as ground truth.
 */
const review = asyncHandler(async (req, res) => {
  const detection = await AiDetection.findById(req.params.id);
  if (!detection) throw ApiError.notFound('AI detection');

  const { verdict, correctedLabel } = req.body;
  if (!['confirmed', 'rejected'].includes(verdict)) {
    throw ApiError.badRequest("`verdict` must be 'confirmed' or 'rejected'");
  }

  detection.reviewStatus = verdict;
  detection.reviewedBy = req.user._id;
  detection.correctedLabel = verdict === 'rejected' ? correctedLabel || '' : '';
  await detection.save();

  return ok(res, detection);
});

/**
 * GET /api/ai/stats
 * Detection volume, confidence distribution, and — where reviews exist —
 * the model's observed precision.
 */
const getStats = asyncHandler(async (_req, res) => {
  const [byTask, bySeverity, confidence, reviews] = await Promise.all([
    AiDetection.aggregate([
      { $group: { _id: '$task', count: { $sum: 1 }, avgConfidence: { $avg: '$confidence' } } },
      { $sort: { count: -1 } },
    ]),
    AiDetection.aggregate([{ $group: { _id: '$severity', count: { $sum: 1 } } }]),
    AiDetection.aggregate([
      {
        $bucket: {
          groupBy: '$confidence',
          boundaries: [0, 50, 70, 85, 95, 100.01],
          default: 'other',
          output: { count: { $sum: 1 } },
        },
      },
    ]),
    AiDetection.aggregate([{ $group: { _id: '$reviewStatus', count: { $sum: 1 } } }]),
  ]);

  const reviewCounts = Object.fromEntries(reviews.map((r) => [r._id, r.count]));
  const confirmed = reviewCounts.confirmed || 0;
  const rejected = reviewCounts.rejected || 0;
  const reviewed = confirmed + rejected;

  const BUCKET_LABELS = { 0: '<50%', 50: '50–70%', 70: '70–85%', 85: '85–95%', 95: '95–100%' };

  return ok(res, {
    byTask: byTask.map((t) => ({
      task: t._id,
      count: t.count,
      avgConfidence: Math.round(t.avgConfidence * 10) / 10,
    })),
    bySeverity: bySeverity.map((s) => ({ severity: s._id, count: s.count })),
    confidenceDistribution: confidence.map((c) => ({
      band: BUCKET_LABELS[c._id] ?? String(c._id),
      count: c.count,
    })),
    review: {
      pending: reviewCounts.pending || 0,
      confirmed,
      rejected,
      /** Precision over reviewed detections; null until reviews exist. */
      precision: reviewed ? Math.round((confirmed / reviewed) * 1000) / 10 : null,
    },
    total: await AiDetection.countDocuments(),
  });
});

/** GET /api/ai/gallery?task= — recent detections for the module's image grid. */
const getGallery = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.task) filter.task = req.query.task;

  const detections = await AiDetection.find(filter)
    .sort({ createdAt: -1 })
    .limit(24)
    .populate('park', 'name')
    .lean();

  return ok(res, detections.map(normaliseId));
});

module.exports = { ...crud, analyze, getTasks, review, getStats, getGallery };

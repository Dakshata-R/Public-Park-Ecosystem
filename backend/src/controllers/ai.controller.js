'use strict';

/**
 * Module 5 — AI Ecosystem Monitoring.
 *
 * The endpoints here own the *consequences* of an inference, not the
 * inference itself: storing the image and the full result, escalating a fire
 * finding to an incident, and collecting the human verdicts that measure the
 * model's real precision.
 */

const crypto = require('crypto');
const { AiDetection, AiImage, Incident, Setting, Park } = require('../models');
const { createCrudController, normaliseId } = require('./crud.factory');
const asyncHandler = require('../middleware/asyncHandler');
const { ok, created } = require('../utils/response');
const ApiError = require('../utils/ApiError');
const { runInference, describeTasks, TASKS } = require('../services/ai-inference.service');
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

/** The API path a stored image is served from. */
const imagePath = (id) => `/api/ai/images/${id}`;

/**
 * Store the analysed image once, keyed by content hash.
 * @returns {Promise<import('mongoose').Document>}
 */
async function storeImage(stored, { source, originalUrl = '', credit = '' }) {
  const sha256 = crypto.createHash('sha256').update(stored.buffer).digest('hex');
  const existing = await AiImage.findOne({ sha256 }).select('_id');
  if (existing) return existing;

  try {
    return await AiImage.create({
      data: stored.buffer,
      width: stored.width,
      height: stored.height,
      bytes: stored.buffer.length,
      sha256,
      source,
      originalUrl,
      credit,
    });
  } catch (err) {
    if (err.code === 11000) return AiImage.findOne({ sha256 }).select('_id'); // concurrent duplicate
    throw err;
  }
}

/**
 * Persist one inference result and apply the escalation rule.
 *
 * Shared by the HTTP handler and the seeder so both follow exactly the same
 * path — a seeded detection is a real inference over a real photograph.
 */
async function recordDetection({ task, result, image, imageName = '', imageCredit = '', park = null, location, user = null, createdAt }) {
  const settings = await Setting.current();

  const detection = await AiDetection.create({
    task,
    imageUrl: imagePath(image._id),
    image: image._id,
    imageName,
    imageCredit,
    park,
    location: location || undefined,
    prediction: result.prediction,
    detail: result.detail || '',
    confidence: result.confidence,
    probabilities: result.probabilities,
    imagenet: result.imagenet,
    evidence: result.evidence,
    notes: result.notes,
    severity: result.severity,
    recommendedAction: result.recommendedAction,
    modelName: result.model.name,
    modelVersion: result.model.version,
    inferenceMs: result.inferenceMs,
    submittedBy: user?._id || null,
    ...(createdAt ? { createdAt } : {}),
  });

  /**
   * Escalation rule. Only a finding whose class names an incident type (fire
   * and smoke) may open an incident without review, and only above the
   * administrator's confidence floor and with a park to locate it in.
   * Everything else — a colour-based foliage reading, a litter guess — waits
   * for a person, because a general-purpose model is not trusted to dispatch
   * crews on its own.
   */
  const escalatable = Boolean(result.incidentType);
  const confident = result.confidence >= settings.aiAutoIncidentConfidence;
  let escalated = null;

  if (escalatable && confident && park) {
    const parkDoc = await Park.findById(park).select('location').lean();
    escalated = await Incident.create({
      referenceCode: await generateReferenceCode(),
      type: result.incidentType,
      title: `AI detection: ${result.prediction}`,
      description:
        `${result.recommendedAction}\n\nDetected by ${result.model.name} at ${result.confidence}% confidence ` +
        `(evidence: ${Object.entries(result.evidence).map(([k, v]) => `${k} ${v}`).join(', ')}).`,
      park,
      location: location || parkDoc.location,
      severity: result.severity === 'critical' ? 5 : 4,
      source: 'ai-detection',
      reportedBy: user?._id || null,
      images: [detection.imageUrl],
      timeline: [{ status: 'reported', note: 'Opened automatically from an AI detection', byName: 'AI Ecosystem Monitoring' }],
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
      // Keyed to the incident, like every incident alert, so resolving the
      // incident clears it (incident resolution auto-resolves `incident:<id>`).
      relatedModel: 'Incident',
      relatedId: escalated._id,
      dedupeKey: `incident:${escalated._id}`,
    });
  }

  const reason = escalated
    ? 'Fire finding above the confidence floor — incident opened automatically.'
    : !escalatable
    ? 'This finding type always goes to human review; only fire and smoke open incidents automatically.'
    : !confident
    ? `Confidence ${result.confidence}% is below the ${settings.aiAutoIncidentConfidence}% floor; queued for human review.`
    : 'No park was selected, so no incident could be located; queued for human review.';

  return {
    detection,
    escalated,
    escalationRule: { escalatable, confident, confidenceFloor: settings.aiAutoIncidentConfidence, applied: Boolean(escalated), reason },
  };
}

/**
 * POST /api/ai/analyze
 * Run one image — an upload (data URL) or an http(s) URL — through a task.
 */
const analyze = asyncHandler(async (req, res) => {
  const { task, imageUrl, imageName, park, location } = req.body;

  if (!TASKS[task]) {
    throw ApiError.badRequest(`Unknown task '${task}'. Expected one of: ${Object.keys(TASKS).join(', ')}`);
  }
  if (park && !(await Park.exists({ _id: park }))) {
    throw ApiError.badRequest('The selected park does not exist');
  }

  const result = await runInference(task, imageUrl);
  const isUpload = imageUrl.trim().startsWith('data:');
  const image = await storeImage(result.stored, { source: isUpload ? 'upload' : 'url', originalUrl: isUpload ? '' : imageUrl });

  const { detection, escalated, escalationRule } = await recordDetection({
    task,
    result,
    image,
    imageName: imageName || (isUpload ? 'upload.jpg' : decodeURIComponent(new URL(imageUrl).pathname.split('/').pop() || '')),
    park: park || null,
    location,
    user: req.user,
  });

  return created(res, {
    detection,
    inference: {
      title: result.title,
      method: result.method,
      prediction: result.prediction,
      detail: result.detail,
      confidence: result.confidence,
      probabilities: result.probabilities,
      severity: result.severity,
      recommendedAction: result.recommendedAction,
      evidence: result.evidence,
      notes: result.notes,
      imagenet: result.imagenet,
      stats: result.stats,
      image: result.image,
      model: result.model,
      timings: result.timings,
      inferenceMs: result.inferenceMs,
    },
    escalated: escalated ? { id: escalated.id, referenceCode: escalated.referenceCode, priority: escalated.priority } : null,
    escalationRule,
  });
});

/** GET /api/ai/images/:id — the stored JPEG behind a detection. */
const getImage = asyncHandler(async (req, res) => {
  const image = await AiImage.findById(req.params.id).select('+data');
  if (!image) throw ApiError.notFound('Image');

  res.set({
    'Content-Type': image.contentType,
    'Cache-Control': 'public, max-age=31536000, immutable',
    ETag: `"${image.sha256}"`,
  });
  if (image.credit) res.set('X-Image-Credit', encodeURIComponent(image.credit));
  return res.send(image.data);
});

/** GET /api/ai/tasks — the label vocabulary, method and model for each task. */
const getTasks = asyncHandler(async (_req, res) => ok(res, describeTasks()));

/**
 * POST /api/ai/:id/review
 * Human-in-the-loop verification. A rejection should carry the label the
 * reviewer believes is correct, which is what makes the precision figure
 * and any later retraining set meaningful.
 */
const review = asyncHandler(async (req, res) => {
  const detection = await AiDetection.findById(req.params.id);
  if (!detection) throw ApiError.notFound('AI detection');

  const { verdict, correctedLabel } = req.body;
  if (!['confirmed', 'rejected'].includes(verdict)) {
    throw ApiError.badRequest("`verdict` must be 'confirmed' or 'rejected'");
  }

  const labels = TASKS[detection.task].classes.map((c) => c.label);
  if (verdict === 'rejected' && correctedLabel && !labels.includes(correctedLabel)) {
    throw ApiError.badRequest(`\`correctedLabel\` must be one of: ${labels.join('; ')}`);
  }
  if (verdict === 'rejected' && correctedLabel === detection.prediction) {
    throw ApiError.badRequest('The corrected label is the same as the prediction — confirm the detection instead');
  }

  detection.reviewStatus = verdict;
  detection.reviewedBy = req.user._id;
  detection.reviewedAt = new Date();
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

  // Every band is always present, so a client can colour bands by position.
  const BANDS = [[0, '<50%'], [50, '50–70%'], [70, '70–85%'], [85, '85–95%'], [95, '95–100%']];
  const bucketCounts = Object.fromEntries(confidence.map((c) => [c._id, c.count]));

  return ok(res, {
    byTask: byTask.map((t) => ({
      task: t._id,
      count: t.count,
      avgConfidence: Math.round(t.avgConfidence * 10) / 10,
    })),
    bySeverity: bySeverity.map((s) => ({ severity: s._id, count: s.count })),
    confidenceDistribution: BANDS.map(([floor, band]) => ({ band, count: bucketCounts[floor] || 0 })),
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
  if (req.query.task) {
    if (!TASKS[req.query.task]) throw ApiError.badRequest(`Unknown task '${req.query.task}'`);
    filter.task = req.query.task;
  }

  const detections = await AiDetection.find(filter)
    .sort({ createdAt: -1 })
    .limit(24)
    .populate('park', 'name')
    .populate('linkedIncident', 'referenceCode priority status')
    .lean();

  return ok(res, detections.map(normaliseId));
});

module.exports = { ...crud, analyze, getImage, getTasks, review, getStats, getGallery, storeImage, recordDetection };

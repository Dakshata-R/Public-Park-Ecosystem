'use strict';

/**
 * Module 5 — AI Ecosystem Monitoring (wildlife recognition).
 *
 * The endpoints here own the *consequences* of an inference, not the
 * inference itself: storing the image and the full result — engine and
 * species included — and collecting the human verdicts that measure the
 * engines' real precision. No finding acts on its own: every detection waits
 * in the review queue for a park officer.
 */

const crypto = require('crypto');
const { AiDetection, AiImage, Park } = require('../models');
const { createCrudController, normaliseId } = require('./crud.factory');
const asyncHandler = require('../middleware/asyncHandler');
const { ok, created } = require('../utils/response');
const ApiError = require('../utils/ApiError');
const { runInference, describeTasks, TASKS } = require('../services/ai-inference.service');

const crud = createCrudController({
  model: AiDetection,
  name: 'AI detection',
  filterable: ['task', 'severity', 'reviewStatus', 'park', 'engine'],
  searchable: ['prediction', 'imageName', 'species.common', 'species.scientific'],
  populate: [
    { path: 'park', select: 'name slug' },
    { path: 'submittedBy', select: 'name role' },
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
 * Persist one inference result.
 *
 * Shared by the HTTP handler and the seeder so both follow exactly the same
 * path — a seeded detection is a real inference over a real photograph.
 */
async function recordDetection({ task, result, image, imageName = '', imageCredit = '', park = null, location, user = null, createdAt }) {
  const detection = await AiDetection.create({
    task,
    imageUrl: imagePath(image._id),
    image: image._id,
    imageName,
    imageCredit,
    park,
    location: location || undefined,
    engine: result.engine,
    provider: result.provider || '',
    prediction: result.prediction,
    detail: result.detail || '',
    confidence: result.confidence,
    probabilities: result.probabilities,
    species: result.species || undefined,
    imagenet: result.imagenet,
    evidence: result.evidence,
    notes: result.notes,
    severity: result.severity,
    recommendedAction: result.recommendedAction,
    modelName: result.engineModel.name,
    modelVersion: result.engineModel.version,
    inferenceMs: result.inferenceMs,
    submittedBy: user?._id || null,
    ...(createdAt ? { createdAt } : {}),
  });
  return { detection };
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

  const { detection } = await recordDetection({
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
      engine: result.engine,
      provider: result.provider || null,
      providerLabel: result.providerLabel || null,
      engineModel: result.engineModel,
      prediction: result.prediction,
      detail: result.detail,
      confidence: result.confidence,
      probabilities: result.probabilities,
      species: result.species,
      severity: result.severity,
      recommendedAction: result.recommendedAction,
      evidence: result.evidence,
      notes: result.notes,
      imagenet: result.imagenet,
      image: result.image,
      model: result.model,
      timings: result.timings,
      inferenceMs: result.inferenceMs,
    },
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

  if (!TASKS[detection.task]) {
    throw ApiError.badRequest(`The '${detection.task}' task is no longer offered, so this detection cannot be reviewed`);
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
  const [byTask, bySeverity, byEngine, confidence, reviews] = await Promise.all([
    AiDetection.aggregate([
      { $group: { _id: '$task', count: { $sum: 1 }, avgConfidence: { $avg: '$confidence' } } },
      { $sort: { count: -1 } },
    ]),
    AiDetection.aggregate([{ $group: { _id: '$severity', count: { $sum: 1 } } }]),
    AiDetection.aggregate([{ $group: { _id: { $ifNull: ['$engine', 'mobilenet-fallback'] }, count: { $sum: 1 } } }]),
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
    byEngine: byEngine.map((e) => ({ engine: e._id, count: e.count })),
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
    .lean();

  return ok(res, detections.map(normaliseId));
});

module.exports = { ...crud, analyze, getImage, getTasks, review, getStats, getGallery, storeImage, recordDetection };

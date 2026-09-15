'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const controller = require('../controllers/ai.controller');
const validate = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { idParam, listQuery } = require('../validators/common');
const { ai } = require('../validators/schemas');
const env = require('../config/env');

const router = express.Router();

router.get('/tasks', controller.getTasks);
router.get('/stats', controller.getStats);
router.get('/gallery', controller.getGallery);
router.get('/images/:id', validate({ params: idParam }), controller.getImage);
router.get('/detections', validate({ query: listQuery }), controller.list);
router.get('/detections/:id', validate({ params: idParam }), controller.getOne);

/**
 * Inference needs an account: every analysis stores an image, can open an
 * incident and raise an alert, and makes the server fetch a remote URL, so
 * it must be attributable. A per-user limit keeps one account from turning
 * the CPU-bound model into a denial of service.
 */
router.post(
  '/analyze',
  requireAuth,
  rateLimit({
    windowMs: 60_000,
    limit: env.isTest ? 1000 : 20,
    keyGenerator: (req) => String(req.user._id),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { success: false, error: { message: 'Too many image analyses — wait a minute and try again' } },
  }),
  validate({ body: ai.analyze }),
  controller.analyze
);

// Only staff may confirm or overturn a model's call.
router.post('/:id/review', requireAuth, requireRole('ecologist'), validate({ params: idParam, body: ai.review }), controller.review);
router.delete('/detections/:id', requireAuth, requireRole('admin'), validate({ params: idParam }), controller.remove);

module.exports = router;

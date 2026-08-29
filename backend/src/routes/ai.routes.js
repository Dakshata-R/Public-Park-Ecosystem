'use strict';

const express = require('express');
const controller = require('../controllers/ai.controller');
const validate = require('../middleware/validate');
const { requireAuth, requireRole, optionalAuth } = require('../middleware/auth');
const { idParam, listQuery } = require('../validators/common');
const { ai } = require('../validators/schemas');

const router = express.Router();

router.get('/tasks', controller.getTasks);
router.get('/stats', controller.getStats);
router.get('/gallery', controller.getGallery);
router.get('/detections', validate({ query: listQuery }), controller.list);
router.get('/detections/:id', validate({ params: idParam }), controller.getOne);

/**
 * Inference is open to any visitor — a citizen photographing a sick tree is
 * exactly the use case — but `optionalAuth` attributes the detection when the
 * caller is signed in.
 */
router.post('/analyze', optionalAuth, validate({ body: ai.analyze }), controller.analyze);

// Only staff may confirm or overturn a model's call.
router.post('/:id/review', requireAuth, requireRole('ecologist'), validate({ params: idParam, body: ai.review }), controller.review);
router.delete('/detections/:id', requireAuth, requireRole('admin'), validate({ params: idParam }), controller.remove);

module.exports = router;

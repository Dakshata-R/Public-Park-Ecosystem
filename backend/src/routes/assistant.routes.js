'use strict';

const express = require('express');
const controller = require('../controllers/assistant.controller');
const validate = require('../middleware/validate');
const { optionalAuth, requireAuth, requireRole } = require('../middleware/auth');
const { assistant } = require('../validators/schemas');

const router = express.Router();

router.get('/suggestions', controller.getSuggestions);
router.get('/history/:sessionId', controller.getHistory);

router.post('/ask', optionalAuth, validate({ body: assistant.ask }), controller.ask);
router.post('/search', optionalAuth, validate({ body: assistant.search }), controller.search);

router.post('/reindex', requireAuth, requireRole('admin'), controller.reindex);

module.exports = router;

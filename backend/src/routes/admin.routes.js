'use strict';

const express = require('express');
const controller = require('../controllers/admin.controller');
const validate = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { idParam, listQuery } = require('../validators/common');
const { admin } = require('../validators/schemas');

const router = express.Router();

// Every route in this module is administrator-only.
router.use(requireAuth, requireRole('admin'));

// --- Users -----------------------------------------------------------------
router.get('/users', validate({ query: listQuery }), controller.users.list);
router.get('/users/:id', validate({ params: idParam }), controller.users.getOne);
router.post('/users', validate({ body: admin.createUser }), controller.users.create);
router.patch('/users/:id', validate({ params: idParam, body: admin.updateUser }), controller.users.update);
router.delete('/users/:id', validate({ params: idParam }), controller.users.remove);

// --- System ----------------------------------------------------------------
router.get('/settings', controller.getSettings);
router.patch('/settings', validate({ body: admin.updateSettings }), controller.updateSettings);
router.get('/audit-log', validate({ query: listQuery }), controller.getAuditLog);
router.get('/stats', controller.getSystemStats);

// --- Maintenance actions ---------------------------------------------------
router.post('/recompute-scores', controller.recomputeScores);
router.post('/reindex-assistant', controller.reindexAssistant);
router.post('/reseed', controller.reseed);

module.exports = router;

'use strict';

const express = require('express');
const controller = require('../controllers/analytics.controller');
const validate = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { idParam, listQuery } = require('../validators/common');
const { reports } = require('../validators/schemas');

const router = express.Router();

router.get('/summary', controller.getSummary);
router.get('/environmental-trend', controller.getEnvironmentalTrend);
router.get('/biodiversity-trend', controller.getBiodiversityTrend);
router.get('/incident-trend', controller.getIncidentTrend);
router.get('/engagement', controller.getEngagementTrend);
router.get('/park-comparison', controller.getParkComparison);
router.get('/export', controller.exportDataset);

// --- Saved reports ---------------------------------------------------------
router.get('/reports', validate({ query: listQuery }), controller.reports.list);
router.get('/reports/:id', validate({ params: idParam }), controller.reports.getOne);
router.post('/reports', requireAuth, requireRole('ecologist'), validate({ body: reports.create }), controller.reports.create);
router.patch('/reports/:id', requireAuth, requireRole('ecologist'), validate({ params: idParam, body: reports.update }), controller.reports.update);
router.delete('/reports/:id', requireAuth, requireRole('admin'), validate({ params: idParam }), controller.reports.remove);

module.exports = router;

'use strict';

const express = require('express');
const controller = require('../controllers/sensor.controller');
const validate = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { idParam, listQuery } = require('../validators/common');
const { sensors } = require('../validators/schemas');

const router = express.Router();

router.get('/live', controller.getLive);
router.get('/', validate({ query: listQuery }), controller.list);
router.get('/:id', validate({ params: idParam }), controller.getOne);
router.get('/:id/readings', validate({ params: idParam }), controller.getReadings);
router.get('/:id/anomalies', validate({ params: idParam }), controller.getAnomalies);

/**
 * Ingestion endpoint for physical devices. A field gateway POSTs here,
 * authenticated as a service account with the officer role. Virtual and
 * simulated sensors refuse posted readings.
 */
router.post(
  '/:id/readings',
  requireAuth,
  requireRole('officer'),
  validate({ params: idParam, body: sensors.ingest }),
  controller.ingestReading
);

router.post('/refresh', requireAuth, requireRole('officer'), controller.refresh);

router.post('/', requireAuth, requireRole('admin'), validate({ body: sensors.create }), controller.create);
router.patch('/:id', requireAuth, requireRole('officer'), validate({ params: idParam, body: sensors.update }), controller.update);
router.delete('/:id', requireAuth, requireRole('admin'), validate({ params: idParam }), controller.remove);

module.exports = router;

'use strict';

const express = require('express');
const controller = require('../controllers/incident.controller');
const validate = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { idParam, listQuery } = require('../validators/common');
const { incidents } = require('../validators/schemas');

const router = express.Router();

router.get('/triage', controller.getTriageQueue);
router.get('/stats', controller.getStats);
router.get('/', validate({ query: listQuery }), controller.list);
router.get('/:id', validate({ params: idParam }), controller.getOne);

router.post('/', requireAuth, requireRole('officer'), validate({ body: incidents.create }), controller.create);
router.patch('/:id', requireAuth, requireRole('officer'), validate({ params: idParam, body: incidents.update }), controller.update);
router.delete('/:id', requireAuth, requireRole('admin'), validate({ params: idParam }), controller.remove);

router.post('/:id/assign', requireAuth, requireRole('officer'), validate({ params: idParam, body: incidents.assign }), controller.assign);
router.post('/:id/resolve', requireAuth, requireRole('officer'), validate({ params: idParam, body: incidents.resolve }), controller.resolve);
router.post(
  '/:id/work-order',
  requireAuth,
  requireRole('officer'),
  validate({ params: idParam, body: incidents.createWorkOrder }),
  controller.createWorkOrder
);

module.exports = router;

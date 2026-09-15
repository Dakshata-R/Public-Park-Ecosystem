'use strict';

const express = require('express');
const controller = require('../controllers/incident.controller');
const validate = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { idParam, listQuery } = require('../validators/common');
const { incidents } = require('../validators/schemas');

const router = express.Router();

// Incident records are operational data, not public transparency data: they
// carry reporter identities, exact hazard locations and assignment history.
// The navigation hides this module below `officer`, and the role hierarchy in
// `middleware/auth.js` lists incidents as an officer duty — so the API has to
// enforce the same boundary rather than relying on the UI to hide the link.
//
// Public surfaces stay served by their own aggregates: the dashboard reads
// `/dashboard/overview` and the analytics page reads
// `/analytics/incident-trend`, neither of which exposes individual records.
router.get('/triage', requireAuth, requireRole('officer'), controller.getTriageQueue);
router.get('/stats', requireAuth, requireRole('officer'), controller.getStats);
router.get('/', requireAuth, requireRole('officer'), validate({ query: listQuery }), controller.list);
router.get('/:id', requireAuth, requireRole('officer'), validate({ params: idParam }), controller.getOne);

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

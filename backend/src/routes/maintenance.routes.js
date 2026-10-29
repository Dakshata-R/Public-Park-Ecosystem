'use strict';

const express = require('express');
const controller = require('../controllers/maintenance.controller');
const validate = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { idParam, listQuery } = require('../validators/common');
const { maintenance } = require('../validators/schemas');

const router = express.Router();

// Work orders are operational records for staff only. Administrators see and
// manage all of them; a park officer sees only their own tasks (scoped in the
// controller) and can update progress on those.
router.get('/calendar', requireAuth, requireRole('officer'), controller.getCalendar);
router.get('/stats', requireAuth, requireRole('officer'), controller.getStats);
router.get('/', requireAuth, requireRole('officer'), validate({ query: listQuery }), controller.list);
router.get('/:id', requireAuth, requireRole('officer'), validate({ params: idParam }), controller.getOne);

router.post('/', requireAuth, requireRole('admin'), validate({ body: maintenance.create }), controller.create);
router.patch('/:id', requireAuth, requireRole('admin'), validate({ params: idParam, body: maintenance.update }), controller.update);
router.patch('/:id/progress', requireAuth, requireRole('officer'), validate({ params: idParam, body: maintenance.progress }), controller.updateProgress);
router.delete('/:id', requireAuth, requireRole('admin'), validate({ params: idParam }), controller.remove);

module.exports = router;

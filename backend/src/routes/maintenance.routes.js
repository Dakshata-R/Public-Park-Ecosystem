'use strict';

const express = require('express');
const controller = require('../controllers/maintenance.controller');
const validate = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { idParam, listQuery } = require('../validators/common');
const { maintenance } = require('../validators/schemas');

const router = express.Router();

router.get('/calendar', controller.getCalendar);
router.get('/stats', controller.getStats);
router.get('/', validate({ query: listQuery }), controller.list);
router.get('/:id', validate({ params: idParam }), controller.getOne);

router.post('/', requireAuth, requireRole('officer'), validate({ body: maintenance.create }), controller.create);
router.patch('/:id', requireAuth, requireRole('officer'), validate({ params: idParam, body: maintenance.update }), controller.update);
router.patch('/:id/progress', requireAuth, requireRole('officer'), validate({ params: idParam, body: maintenance.progress }), controller.updateProgress);
router.delete('/:id', requireAuth, requireRole('admin'), validate({ params: idParam }), controller.remove);

module.exports = router;

'use strict';

const express = require('express');
const controller = require('../controllers/park.controller');
const validate = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { idParam, listQuery } = require('../validators/common');
const { parks } = require('../validators/schemas');

const router = express.Router();

// Park information is public — citizens browse it without signing in.
router.get('/near', controller.findNearby);
router.get('/', validate({ query: listQuery }), controller.list);
router.get('/:id', validate({ params: idParam }), controller.getOne);
router.get('/:id/health', validate({ params: idParam }), controller.getHealth);
router.get('/:id/summary', validate({ params: idParam }), controller.getSummary);
router.get('/:id/trend', validate({ params: idParam }), controller.getTrend);

// Writing to the park registry is an administrative act.
router.post('/', requireAuth, requireRole('admin'), validate({ body: parks.create }), controller.create);
router.patch('/:id', requireAuth, requireRole('admin'), validate({ params: idParam, body: parks.update }), controller.update);
router.delete('/:id', requireAuth, requireRole('admin'), validate({ params: idParam }), controller.remove);

module.exports = router;

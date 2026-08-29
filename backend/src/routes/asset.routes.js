'use strict';

const express = require('express');
const controller = require('../controllers/asset.controller');
const validate = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { idParam, listQuery } = require('../validators/common');
const { assets } = require('../validators/schemas');

const router = express.Router();

router.get('/stats', controller.getStats);
router.get('/', validate({ query: listQuery }), controller.list);
router.get('/:id', validate({ params: idParam }), controller.getOne);
router.get('/:id/history', validate({ params: idParam }), controller.getHistory);

// Field staff maintain the inventory; citizens may only read it.
router.post('/', requireAuth, requireRole('officer'), validate({ body: assets.create }), controller.create);
router.patch('/:id', requireAuth, requireRole('officer'), validate({ params: idParam, body: assets.update }), controller.update);
router.delete('/:id', requireAuth, requireRole('admin'), validate({ params: idParam }), controller.remove);

router.post(
  '/:id/maintenance',
  requireAuth,
  requireRole('officer'),
  validate({ params: idParam, body: assets.addMaintenance }),
  controller.addMaintenance
);

module.exports = router;

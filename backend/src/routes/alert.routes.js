'use strict';

const express = require('express');
const controller = require('../controllers/alert.controller');
const validate = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { idParam, listQuery } = require('../validators/common');

const router = express.Router();

router.get('/', validate({ query: listQuery }), controller.list);
router.get('/:id', validate({ params: idParam }), controller.getOne);

// Alerts are raised by services, so there is no create endpoint — only
// operational responses to an existing alert.
router.post('/acknowledge-all', requireAuth, requireRole('officer'), controller.acknowledgeAll);
router.post('/:id/acknowledge', requireAuth, requireRole('officer'), validate({ params: idParam }), controller.acknowledge);
router.post('/:id/resolve', requireAuth, requireRole('officer'), validate({ params: idParam }), controller.resolve);

module.exports = router;

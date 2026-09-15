'use strict';

const express = require('express');
const controller = require('../controllers/citizen.controller');
const validate = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { idParam, listQuery } = require('../validators/common');
const { citizen } = require('../validators/schemas');

const router = express.Router();

router.get('/stats', controller.getStats);
router.get('/my-reports', requireAuth, controller.myReports);
router.get('/my-upvotes', requireAuth, controller.myUpvotes);

router.get('/reports', validate({ query: listQuery }), controller.list);
router.get('/reports/:id', validate({ params: idParam }), controller.getOne);

/**
 * Submission is open to anyone with an account. `optionalAuth` is not used
 * here: attributing a report to a person is what makes the contribution
 * history and the acceptance-rate metric meaningful.
 */
router.post('/reports', requireAuth, validate({ body: citizen.create }), controller.create);
router.post('/reports/:id/upvote', requireAuth, validate({ params: idParam }), controller.upvote);
router.delete('/reports/:id/upvote', requireAuth, validate({ params: idParam }), controller.removeUpvote);

// Officer review is the gate between public input and the operational record.
router.post(
  '/reports/:id/review',
  requireAuth,
  requireRole('officer'),
  validate({ params: idParam, body: citizen.review }),
  controller.review
);

router.patch('/reports/:id', requireAuth, requireRole('officer'), validate({ params: idParam, body: citizen.update }), controller.update);
router.delete('/reports/:id', requireAuth, requireRole('admin'), validate({ params: idParam }), controller.remove);

module.exports = router;

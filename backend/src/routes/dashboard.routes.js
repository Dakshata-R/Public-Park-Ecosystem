'use strict';

const express = require('express');
const controller = require('../controllers/dashboard.controller');

const router = express.Router();

// The dashboard is a public-facing transparency surface — one of the stated
// benefits of the project — so it does not require a sign-in.
router.get('/overview', controller.getOverview);
router.get('/trend', controller.getTrend);
router.get('/activity', controller.getActivity);

module.exports = router;

'use strict';

const express = require('express');
const controller = require('../controllers/gis.controller');

const router = express.Router();

router.get('/layers', controller.getLayers);
router.get('/heatmap', controller.getHeatmap);
router.get('/within', controller.getWithinRadius);

module.exports = router;

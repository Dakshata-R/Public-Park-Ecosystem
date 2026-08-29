'use strict';

const express = require('express');
const controller = require('../controllers/integration.controller');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// Live conditions are public information — the same data a visitor would look
// up before deciding whether to walk to the park.
router.get('/status', controller.getStatus);
router.get('/weather', controller.getWeather);
router.get('/air-quality', controller.getAirQuality);
router.get('/park-conditions', controller.getParkConditions);
router.get('/geocode', controller.reverseGeocode);
router.get('/ebird', controller.getEbird);

// `search` is declared before `:speciesId` so the literal path is not
// swallowed by the parameter route.
router.get('/gbif/search', controller.searchGbif);
router.get('/gbif/:speciesId', controller.verifySpecies);

router.post('/clear-cache', requireAuth, requireRole('admin'), controller.clearCache);

module.exports = router;

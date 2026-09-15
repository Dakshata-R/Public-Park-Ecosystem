'use strict';

/**
 * GET /api/settings/public — the subset of system settings every visitor's
 * interface needs: who runs the portal, how to contact them, whether public
 * reporting is open, and the map zoom. Everything else stays admin-only.
 */

const express = require('express');
const { Setting } = require('../models');
const asyncHandler = require('../middleware/asyncHandler');
const { ok } = require('../utils/response');

const router = express.Router();

router.get(
  '/public',
  asyncHandler(async (_req, res) => {
    const s = await Setting.current();
    return ok(res, {
      organisationName: s.organisationName,
      city: s.city,
      contactEmail: s.contactEmail,
      enablePublicReporting: s.enablePublicReporting,
      enableSensorSimulation: s.enableSensorSimulation,
      mapDefaultZoom: s.mapDefaultZoom,
    });
  })
);

module.exports = router;

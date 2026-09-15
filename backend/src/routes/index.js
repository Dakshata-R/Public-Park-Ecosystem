'use strict';

/**
 * API router. Each of the twelve modules mounts under its own prefix, so the
 * URL space mirrors the module list in the project report exactly.
 */

const express = require('express');
const mongoose = require('mongoose');

const router = express.Router();

/** Module → mount path. Order is presentational only; paths do not overlap. */
const MODULES = [
  { path: '/auth',         router: require('./auth.routes'),         module: 'Authentication' },
  { path: '/dashboard',    router: require('./dashboard.routes'),    module: '1 · Ecosystem Monitoring Dashboard' },
  { path: '/gis',          router: require('./gis.routes'),          module: '2 · GIS & Urban Biodiversity Mapping' },
  { path: '/parks',        router: require('./park.routes'),         module: '3 · Park Registry' },
  { path: '/assets',       router: require('./asset.routes'),        module: '3 · Park Asset Management' },
  { path: '/biodiversity', router: require('./biodiversity.routes'), module: '4 · Biodiversity Management' },
  { path: '/ai',           router: require('./ai.routes'),           module: '5 · AI Ecosystem Monitoring' },
  { path: '/sensors',      router: require('./sensor.routes'),       module: '6 · Environmental Sensor Monitoring' },
  { path: '/citizen',      router: require('./citizen.routes'),      module: '7 · Citizen Engagement Portal' },
  { path: '/incidents',    router: require('./incident.routes'),     module: '8 · Incident & Alert Management' },
  { path: '/alerts',       router: require('./alert.routes'),        module: '8 · Incident & Alert Management' },
  { path: '/maintenance',  router: require('./maintenance.routes'),  module: '9 · Maintenance Management' },
  { path: '/analytics',    router: require('./analytics.routes'),    module: '10 · Analytics & Reports' },
  { path: '/assistant',    router: require('./assistant.routes'),    module: '11 · AI Environmental Assistant' },
  { path: '/admin',        router: require('./admin.routes'),        module: '12 · Administration' },
  { path: '/users',        router: require('./user.routes'),         module: 'Staff directory' },
  { path: '/settings',     router: require('./settings.routes'),     module: 'Public configuration' },
  { path: '/integrations', router: require('./integration.routes'),  module: 'External APIs · Weather, air quality, GBIF, geocoding' },
];

for (const { path, router: moduleRouter } of MODULES) {
  router.use(path, moduleRouter);
}

/** GET /api/health — liveness probe. */
router.get('/health', (_req, res) => {
  const STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const dbState = STATES[mongoose.connection.readyState] || 'unknown';

  res.status(dbState === 'connected' ? 200 : 503).json({
    success: dbState === 'connected',
    data: {
      status: dbState === 'connected' ? 'ok' : 'degraded',
      database: dbState,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    },
  });
});

/** GET /api — the API index, listing every module mount point. */
router.get('/', (_req, res) => {
  res.json({
    success: true,
    data: {
      name: 'GreenPulse API',
      description:
        'Public Park Ecosystem Health Monitoring System & Urban Biodiversity Mapping Portal',
      version: '1.0.0',
      modules: MODULES.map(({ path, module }) => ({ module, basePath: `/api${path}` })),
      documentation: 'docs/api-reference.md in the repository',
    },
  });
});

module.exports = router;

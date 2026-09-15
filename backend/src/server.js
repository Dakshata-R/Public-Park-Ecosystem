'use strict';

/**
 * Process entry point: validate configuration, connect the database, seed it
 * if empty, start the background jobs, listen, and shut all of it down
 * cleanly.
 */

const app = require('./app');
const env = require('./config/env');
const logger = require('./utils/logger');
const { connectDatabase, disconnectDatabase, isInMemory } = require('./config/db');
const { startSensorRefresh, stopSensorRefresh } = require('./services/sensor.service');
const vision = require('./services/vision.service');

let server = null;
let overdueTimer = null;

/** How often scheduled work orders past their date are marked overdue. */
const OVERDUE_SWEEP_MS = 10 * 60_000;

async function start() {
  const problems = env.productionProblems();
  if (problems.length) {
    logger.error('Refusing to start in production with an unsafe configuration:');
    problems.forEach((p) => logger.error(`  • ${p}`));
    process.exit(1);
  }

  await connectDatabase();

  // An in-memory database is empty on every boot, so seeding is unconditional
  // there; a persistent one is only seeded when it has no parks yet.
  if (env.autoSeed) {
    const { seedDatabase } = require('./seed/seed');
    const { Park } = require('./models');
    const isEmpty = (await Park.estimatedDocumentCount()) === 0;

    if (isEmpty) {
      logger.info('Database is empty — seeding the reference dataset…');
      const summary = await seedDatabase({ force: false });
      logger.success(
        `Seeded ${summary.parks} parks, ${summary.species} species, ${summary.observations} observation records, ` +
          `${summary.assets} assets, ${summary.sensors} sensors, ${summary.readings} readings, ${summary.aiDetections} AI detections.`
      );
    } else if (isInMemory()) {
      logger.info('In-memory database already populated this session.');
    }
  }

  startSensorRefresh();
  vision.warmUp();

  const { markOverdueOrders } = require('./controllers/maintenance.controller');
  overdueTimer = setInterval(() => {
    markOverdueOrders().catch((err) => logger.warn('Overdue sweep failed:', err.message));
  }, OVERDUE_SWEEP_MS);
  overdueTimer.unref();

  server = app.listen(env.port, () => {
    logger.success(`GreenPulse API listening on port ${env.port}`);
    logger.info(`Environment: ${env.nodeEnv} · CORS: ${env.corsOrigins.join(', ')}`);
    if (!env.isProduction) logger.info(`API index: http://localhost:${env.port}/api`);
  });
}

/** Close the HTTP listener, the background jobs and the database in that order. */
async function shutdown(signal) {
  logger.warn(`${signal} received — shutting down…`);
  stopSensorRefresh();
  if (overdueTimer) clearInterval(overdueTimer);

  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }

  await disconnectDatabase();
  logger.info('Shutdown complete.');
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    shutdown(signal).catch((err) => {
      logger.error('Error during shutdown:', err.message);
      process.exit(1);
    });
  });
}

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection:', reason);
});

start().catch((err) => {
  logger.error('Failed to start the server:', err.message);
  logger.error(err.stack);
  process.exit(1);
});

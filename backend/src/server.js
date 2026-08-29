'use strict';

/**
 * Process entry point: connect the database, seed it if empty, start the
 * sensor simulator, listen, and shut all of it down cleanly.
 */

const app = require('./app');
const env = require('./config/env');
const logger = require('./utils/logger');
const { connectDatabase, disconnectDatabase, isInMemory } = require('./config/db');
const { startSimulator, stopSimulator } = require('./services/sensor.service');

let server = null;

async function start() {
  await connectDatabase();

  // An in-memory database is empty on every boot, so seeding is unconditional
  // there; a persistent one is only seeded when it has no parks yet.
  if (env.autoSeed) {
    const { seedDatabase } = require('./seed/seed');
    const { Park } = require('./models');
    const isEmpty = (await Park.estimatedDocumentCount()) === 0;

    if (isEmpty) {
      logger.info('Database is empty — seeding the demonstration dataset…');
      const summary = await seedDatabase({ force: false });
      logger.success(
        `Seeded ${summary.parks} parks, ${summary.species} species, ${summary.assets} assets, ` +
          `${summary.sensors} sensors, ${summary.readings} readings.`
      );
    } else if (isInMemory()) {
      logger.info('In-memory database already populated this session.');
    }
  }

  startSimulator();

  server = app.listen(env.port, () => {
    logger.success(`GreenPulse API listening on http://localhost:${env.port}`);
    logger.info(`Environment: ${env.nodeEnv} · CORS: ${env.corsOrigins.join(', ')}`);
    logger.info(`API index: http://localhost:${env.port}/api`);
  });
}

/** Close the HTTP listener, the simulator and the database in that order. */
async function shutdown(signal) {
  logger.warn(`${signal} received — shutting down…`);
  stopSimulator();

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

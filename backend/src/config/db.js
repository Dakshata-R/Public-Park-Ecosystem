'use strict';

/**
 * MongoDB connection management.
 *
 * The project is a university prototype that must run on any machine, so the
 * connection strategy has two modes:
 *
 *   1. `MONGODB_URI` set   → connect to that server (local mongod or Atlas).
 *   2. `MONGODB_URI` blank → boot an ephemeral in-memory MongoDB via
 *                            `mongodb-memory-server`. Real MongoDB wire
 *                            protocol, real Mongoose queries, zero install.
 *
 * Mode 2 keeps demos reproducible: every `npm run dev` starts from a freshly
 * seeded database.
 */

const mongoose = require('mongoose');
const env = require('./env');
const logger = require('../utils/logger');

let memoryServer = null;

/** True when the current connection is backed by the in-memory server. */
let usingMemoryServer = false;

async function startMemoryServer() {
  let MongoMemoryServer;
  try {
    ({ MongoMemoryServer } = require('mongodb-memory-server'));
  } catch (err) {
    throw new Error(
      'MONGODB_URI is not set and `mongodb-memory-server` is not installed.\n' +
        'Either set MONGODB_URI in server/.env or run `npm install` inside server/.'
    );
  }

  logger.info('No MONGODB_URI set — starting in-memory MongoDB (data is not persisted)…');
  memoryServer = await MongoMemoryServer.create({
    instance: { dbName: 'greenpulse' },
  });
  usingMemoryServer = true;
  return memoryServer.getUri();
}

/**
 * Connect Mongoose. Resolves once the connection is open.
 * @returns {Promise<{uri: string, inMemory: boolean}>}
 */
async function connectDatabase() {
  const uri = env.mongoUri || (await startMemoryServer());

  mongoose.set('strictQuery', true);

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
    autoIndex: true,
  });

  const shown = usingMemoryServer ? '(in-memory instance)' : uri.replace(/\/\/[^@]*@/, '//<credentials>@');
  logger.info(`MongoDB connected → ${shown}`);

  mongoose.connection.on('error', (err) => logger.error('MongoDB error:', err.message));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));

  return { uri, inMemory: usingMemoryServer };
}

/** Close the connection (and the in-memory server, if one was started). */
async function disconnectDatabase() {
  await mongoose.connection.close();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
    usingMemoryServer = false;
  }
}

module.exports = { connectDatabase, disconnectDatabase, isInMemory: () => usingMemoryServer };

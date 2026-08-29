'use strict';

/**
 * Centralised environment configuration.
 *
 * Every other module imports settings from here rather than reading
 * `process.env` directly, so defaults live in exactly one place.
 */

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBool = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
};

const env = {
  port: toInt(process.env.PORT, 5000),
  nodeEnv: process.env.NODE_ENV || 'development',

  // Empty string means "spin up an in-memory MongoDB instead".
  mongoUri: (process.env.MONGODB_URI || '').trim(),

  jwtSecret: process.env.JWT_SECRET || 'greenpulse-dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  autoSeed: toBool(process.env.AUTO_SEED, true),
  sensorIntervalMs: toInt(process.env.SENSOR_SIMULATION_INTERVAL_MS, 60000),
};

env.isProduction = env.nodeEnv === 'production';
env.isTest = env.nodeEnv === 'test';

module.exports = env;

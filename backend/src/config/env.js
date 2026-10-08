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

const DEV_JWT_SECRET = 'greenpulse-dev-secret-change-me';

const env = {
  port: toInt(process.env.PORT, 5000),
  nodeEnv: process.env.NODE_ENV || 'development',

  // Empty string means "spin up an in-memory MongoDB instead" (development only).
  mongoUri: (process.env.MONGODB_URI || '').trim(),

  jwtSecret: process.env.JWT_SECRET || DEV_JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean),

  autoSeed: toBool(process.env.AUTO_SEED, true),
  sensorIntervalMs: toInt(process.env.SENSOR_SIMULATION_INTERVAL_MS, 60000),

  // Eco Assistant language model. Blank key → the built-in retrieval engine answers.
  anthropicApiKey: (process.env.ANTHROPIC_API_KEY || '').trim(),
  assistantModel: (process.env.ASSISTANT_MODEL || 'claude-opus-5-5').trim(),
};

env.isProduction = env.nodeEnv === 'production';
env.isTest = env.nodeEnv === 'test';

/**
 * Settings that are convenient defaults on a laptop and dangerous on a server.
 * Refusing to boot is kinder than a deployment that silently accepts tokens
 * signed with a secret published in this repository.
 *
 * @returns {string[]} problems; empty when the configuration is safe
 */
env.productionProblems = () => {
  if (!env.isProduction) return [];
  const problems = [];
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === DEV_JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    problems.push('JWT_SECRET must be set to a random string of at least 32 characters');
  }
  if (!env.mongoUri) {
    problems.push('MONGODB_URI must point at a persistent MongoDB (e.g. MongoDB Atlas) — the in-memory database is for development');
  }
  if (!process.env.CORS_ORIGIN) {
    problems.push('CORS_ORIGIN must list the deployed frontend origin(s)');
  }
  return problems;
};

module.exports = env;

'use strict';

/**
 * Express application assembly.
 *
 * Kept separate from `server.js` so the app can be imported by tests without
 * opening a port or connecting to a database.
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const env = require('./config/env');
const routes = require('./routes');
const { notFoundHandler, errorHandler } = require('./middleware/error');

const app = express();

// Behind a reverse proxy (Render, Railway, nginx) the client IP arrives in
// X-Forwarded-For; without this the rate limiter would see one shared IP.
app.set('trust proxy', 1);

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(compression());

app.use(
  cors({
    origin(origin, callback) {
      // Requests with no Origin (curl, server-to-server, health checks) pass.
      if (!origin || env.corsOrigins.includes(origin) || env.corsOrigins.includes('*')) {
        return callback(null, true);
      }
      return callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
    credentials: true,
  })
);

// Image uploads arrive as data URLs from the AI module, so the default 100 kB
// body limit is too small.
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

if (!env.isTest) {
  app.use(morgan(env.isProduction ? 'combined' : 'dev'));
}

/**
 * Two rate limits: a generous one for reads, a strict one for authentication,
 * because the login endpoint is the only one worth brute-forcing.
 */
app.use(
  '/api',
  rateLimit({
    windowMs: 60_000,
    limit: env.isProduction ? 300 : 2000,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { success: false, error: { message: 'Too many requests — please slow down' } },
  })
);

app.use(
  '/api/auth/login',
  rateLimit({
    windowMs: 15 * 60_000,
    limit: 20,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { success: false, error: { message: 'Too many sign-in attempts — try again in 15 minutes' } },
  })
);

app.use('/api', routes);

// Root banner, so hitting the bare host says something useful.
app.get('/', (_req, res) => {
  res.json({
    success: true,
    data: {
      name: 'GreenPulse API',
      docs: '/api',
      health: '/api/health',
    },
  });
});

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;

'use strict';

/**
 * Central error handling: a 404 catcher for unmatched routes and a single
 * error middleware that normalises everything (ApiError, Mongoose validation
 * errors, duplicate keys, cast errors, JWT errors, and genuine bugs) into the
 * API's failure envelope.
 */

const ApiError = require('../utils/ApiError');
const env = require('../config/env');
const logger = require('../utils/logger');

/** Runs when no route matched. */
function notFoundHandler(req, _res, next) {
  next(new ApiError(404, `Route ${req.method} ${req.originalUrl} does not exist`));
}

/** Translate framework/driver errors into ApiError instances. */
function normalise(err) {
  if (err instanceof ApiError) return err;

  // Mongoose schema validation
  if (err.name === 'ValidationError') {
    const details = Object.fromEntries(
      Object.entries(err.errors).map(([field, e]) => [field, e.message])
    );
    return new ApiError(422, 'Validation failed', details);
  }

  // Invalid ObjectId (or other cast failure)
  if (err.name === 'CastError') {
    return new ApiError(400, `Invalid value '${err.value}' for field '${err.path}'`);
  }

  // Unique index violation
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || 'field';
    return new ApiError(409, `A record with that ${field} already exists`);
  }

  if (err.name === 'JsonWebTokenError') return new ApiError(401, 'Invalid authentication token');
  if (err.name === 'TokenExpiredError') return new ApiError(401, 'Authentication token has expired');

  // body-parser rejects an unparseable or oversized body before any route
  // runs. That is a bad request, not a server fault, so it must not fall
  // through to the 500 branch below.
  if (err.type === 'entity.parse.failed' || (err instanceof SyntaxError && 'body' in err)) {
    return new ApiError(400, 'Request body is not valid JSON');
  }
  if (err.type === 'entity.too.large') {
    return new ApiError(413, 'Request body is too large');
  }

  return null; // unexpected — treat as a bug
}

// eslint-disable-next-line no-unused-vars -- Express requires the 4-arg signature
function errorHandler(err, _req, res, _next) {
  const known = normalise(err);

  if (!known) {
    logger.error('Unhandled error:', err.stack || err.message);
    const body = { success: false, error: { message: 'Internal server error' } };
    if (!env.isProduction) body.error.debug = err.message;
    return res.status(500).json(body);
  }

  const body = { success: false, error: { message: known.message } };
  if (known.details) body.error.details = known.details;
  return res.status(known.statusCode).json(body);
}

module.exports = { notFoundHandler, errorHandler };

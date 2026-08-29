'use strict';

/**
 * Wrap an async route handler so a rejected promise reaches Express'
 * error middleware instead of becoming an unhandled rejection.
 *
 *   router.get('/', asyncHandler(async (req, res) => { … }))
 *
 * @param {Function} fn
 * @returns {import('express').RequestHandler}
 */
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

module.exports = asyncHandler;

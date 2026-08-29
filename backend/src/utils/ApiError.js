'use strict';

/**
 * Operational error carrying an HTTP status code.
 *
 * Anything thrown as an `ApiError` is considered an expected failure
 * (bad input, missing record, forbidden action) and is reported to the
 * client verbatim. Every other thrown value is treated as a bug and
 * collapsed to a generic 500 by the error middleware.
 */
class ApiError extends Error {
  /**
   * @param {number} statusCode HTTP status to return
   * @param {string} message    Human-readable explanation
   * @param {object} [details]  Optional structured detail (e.g. field errors)
   */
  constructor(statusCode, message, details) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.isOperational = true;
    if (details) this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message = 'Bad request', details) {
    return new ApiError(400, message, details);
  }

  static unauthorized(message = 'Authentication required') {
    return new ApiError(401, message);
  }

  static forbidden(message = 'You do not have permission to perform this action') {
    return new ApiError(403, message);
  }

  static notFound(resource = 'Resource') {
    return new ApiError(404, `${resource} not found`);
  }

  static conflict(message = 'Resource already exists') {
    return new ApiError(409, message);
  }
}

module.exports = ApiError;

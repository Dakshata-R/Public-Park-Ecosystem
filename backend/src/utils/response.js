'use strict';

/**
 * A single response envelope for the whole API.
 *
 * Success: { success: true, data, meta? }
 * Failure: { success: false, error: { message, details? } }
 *
 * The frontend `lib/api/client.ts` unwraps exactly this shape, so keeping
 * every handler on it removes per-endpoint parsing code.
 */

/**
 * @param {import('express').Response} res
 * @param {*} data      Payload
 * @param {object} [meta] Pagination / aggregate metadata
 * @param {number} [statusCode=200]
 */
function ok(res, data, meta, statusCode = 200) {
  const body = { success: true, data };
  if (meta) body.meta = meta;
  return res.status(statusCode).json(body);
}

/** 201 Created shorthand. */
function created(res, data) {
  return ok(res, data, undefined, 201);
}

/** 204 No Content shorthand. */
function noContent(res) {
  return res.status(204).send();
}

module.exports = { ok, created, noContent };

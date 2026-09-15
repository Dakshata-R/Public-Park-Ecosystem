'use strict';

const mongoose = require('mongoose');

/**
 * Coerce a value into an ObjectId for use inside an aggregation `$match`.
 * Aggregation pipelines bypass Mongoose casting, so string ids must be
 * converted explicitly or the stage silently matches nothing.
 *
 * @param {string|import('mongoose').Types.ObjectId|null|undefined} value
 * @returns {import('mongoose').Types.ObjectId|null}
 */
function toObjectId(value) {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (mongoose.Types.ObjectId.isValid(value)) return new mongoose.Types.ObjectId(String(value));
  return null;
}

/** True when the value is a well-formed ObjectId string or instance. */
const isObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

/**
 * `toObjectId` for a query parameter: `undefined` when absent, an ObjectId
 * when valid, and a 400 when malformed — so a bad `?park=` is reported rather
 * than silently matching nothing (or, as `null`, matching the wrong rows).
 */
function queryObjectId(value, name = 'id') {
  if (value === undefined || value === null || value === '') return undefined;
  const id = toObjectId(value);
  if (!id) {
    const ApiError = require('./ApiError');
    throw ApiError.badRequest(`\`${name}\` is not a valid id`);
  }
  return id;
}

module.exports = { toObjectId, isObjectId, queryObjectId };

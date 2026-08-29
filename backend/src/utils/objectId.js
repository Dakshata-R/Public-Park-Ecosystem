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

module.exports = { toObjectId, isObjectId };

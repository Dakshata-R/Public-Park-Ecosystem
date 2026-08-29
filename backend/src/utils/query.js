'use strict';

/**
 * Helpers that translate the common `?page=&limit=&sort=&q=&<field>=` query
 * string into Mongoose arguments. Shared by every list endpoint so filtering,
 * sorting and pagination behave identically across the twelve modules.
 */

const MAX_LIMIT = 200;

/**
 * Parse pagination parameters.
 * @param {object} query Express `req.query`
 * @returns {{page: number, limit: number, skip: number}}
 */
function parsePagination(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const rawLimit = Number.parseInt(query.limit, 10) || 20;
  const limit = Math.min(MAX_LIMIT, Math.max(1, rawLimit));
  return { page, limit, skip: (page - 1) * limit };
}

/**
 * Parse a `sort` parameter such as `-createdAt` or `name,-condition`
 * into a Mongoose sort object.
 * @param {string} sort
 * @param {object} [fallback]
 */
function parseSort(sort, fallback = { createdAt: -1 }) {
  if (!sort) return fallback;
  const spec = {};
  for (const token of String(sort).split(',')) {
    const field = token.trim();
    if (!field) continue;
    if (field.startsWith('-')) spec[field.slice(1)] = -1;
    else spec[field] = 1;
  }
  return Object.keys(spec).length ? spec : fallback;
}

/** Escape a user-supplied string so it is safe inside a RegExp. */
function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a Mongoose filter from the query string.
 *
 * @param {object}   query          Express `req.query`
 * @param {object}   options
 * @param {string[]} options.allowed      Fields that may be filtered by exact match
 * @param {string[]} [options.searchable] Fields included in the `?q=` text search
 * @returns {object} Mongoose filter document
 */
function buildFilter(query = {}, { allowed = [], searchable = [] } = {}) {
  const filter = {};

  for (const field of allowed) {
    const value = query[field];
    if (value === undefined || value === '' || value === 'all') continue;
    // `?status=active,resolved` becomes an $in query.
    filter[field] = String(value).includes(',')
      ? { $in: String(value).split(',').map((v) => v.trim()) }
      : value;
  }

  if (query.q && searchable.length) {
    const rx = new RegExp(escapeRegex(String(query.q).trim()), 'i');
    filter.$or = searchable.map((field) => ({ [field]: rx }));
  }

  return filter;
}

/**
 * Metadata block returned alongside paginated lists.
 * @param {number} total
 * @param {{page: number, limit: number}} pagination
 */
function buildMeta(total, { page, limit }) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return {
    total,
    page,
    limit,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
}

module.exports = { parsePagination, parseSort, buildFilter, buildMeta, escapeRegex, MAX_LIMIT };

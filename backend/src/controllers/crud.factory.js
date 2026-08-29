'use strict';

/**
 * Generic CRUD handler factory.
 *
 * Eleven of the twelve modules need the same five operations over a Mongoose
 * model — list with filter/sort/pagination, read one, create, update, delete —
 * differing only in which fields are filterable, searchable and populated.
 * Writing those out per module would be ~700 lines of near-identical code with
 * eleven chances to get pagination or the audit hook subtly wrong.
 *
 * Each module's controller therefore calls `createCrudController` for the
 * routine operations and adds only its genuinely module-specific handlers on
 * top (triage for incidents, inference for AI, indices for biodiversity…).
 */

const ApiError = require('../utils/ApiError');
const asyncHandler = require('../middleware/asyncHandler');
const { ok, created, noContent } = require('../utils/response');
const { parsePagination, parseSort, buildFilter, buildMeta } = require('../utils/query');
const audit = require('../services/audit.service');

/**
 * @param {object} config
 * @param {import('mongoose').Model} config.model
 * @param {string} config.name              Singular, for error messages ("Incident")
 * @param {string[]} config.filterable      Query params allowed as exact-match filters
 * @param {string[]} [config.searchable]    Fields covered by `?q=`
 * @param {string|object[]} [config.populate] Mongoose populate spec for list & read
 * @param {object} [config.defaultSort]
 * @param {Function} [config.beforeCreate]  async (body, req) => body
 * @param {Function} [config.afterCreate]   async (doc, req) => void
 * @param {Function} [config.beforeUpdate]  async (body, doc, req) => body
 * @param {Function} [config.afterUpdate]   async (doc, previous, req) => void
 * @param {Function} [config.beforeDelete]  async (doc, req) => void
 * @param {boolean} [config.softDelete]     Set `active: false` instead of removing
 */
function createCrudController(config) {
  const {
    model,
    name,
    filterable = [],
    searchable = [],
    populate,
    defaultSort = { createdAt: -1 },
    beforeCreate,
    afterCreate,
    beforeUpdate,
    afterUpdate,
    beforeDelete,
    softDelete = false,
  } = config;

  /** Apply the configured populate spec to a query, if any. */
  const withPopulate = (query) => (populate ? query.populate(populate) : query);

  /** GET / — paginated, filtered, sorted list. */
  const list = asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const sort = parseSort(req.query.sort, defaultSort);
    const filter = buildFilter(req.query, { allowed: filterable, searchable });

    const [items, total] = await Promise.all([
      withPopulate(model.find(filter).sort(sort).skip(skip).limit(limit)).lean(),
      model.countDocuments(filter),
    ]);

    return ok(res, items.map(normaliseId), buildMeta(total, { page, limit }));
  });

  /** GET /:id */
  const getOne = asyncHandler(async (req, res) => {
    const doc = await withPopulate(model.findById(req.params.id));
    if (!doc) throw ApiError.notFound(name);
    return ok(res, doc);
  });

  /** POST / */
  const create = asyncHandler(async (req, res) => {
    const payload = beforeCreate ? await beforeCreate(req.body, req) : req.body;
    const doc = await model.create(payload);
    if (afterCreate) await afterCreate(doc, req);

    await audit.record({
      action: 'create',
      entity: model.modelName,
      entityId: doc._id,
      entityLabel: doc.name || doc.title || doc.referenceCode || String(doc._id),
      changes: audit.diff({}, payload),
      req,
    });

    const populated = await withPopulate(model.findById(doc._id));
    return created(res, populated);
  });

  /** PATCH /:id */
  const update = asyncHandler(async (req, res) => {
    const doc = await model.findById(req.params.id);
    if (!doc) throw ApiError.notFound(name);

    const previous = doc.toObject();
    const payload = beforeUpdate ? await beforeUpdate(req.body, doc, req) : req.body;

    // Assign through the document (rather than findOneAndUpdate) so schema
    // pre-save hooks — derived status, resolution stamps — still run.
    Object.assign(doc, payload);
    await doc.save();
    if (afterUpdate) await afterUpdate(doc, previous, req);

    await audit.record({
      action: 'update',
      entity: model.modelName,
      entityId: doc._id,
      entityLabel: doc.name || doc.title || doc.referenceCode || String(doc._id),
      changes: audit.diff(previous, payload),
      req,
    });

    const populated = await withPopulate(model.findById(doc._id));
    return ok(res, populated);
  });

  /** DELETE /:id */
  const remove = asyncHandler(async (req, res) => {
    const doc = await model.findById(req.params.id);
    if (!doc) throw ApiError.notFound(name);
    if (beforeDelete) await beforeDelete(doc, req);

    const label = doc.name || doc.title || doc.referenceCode || String(doc._id);

    if (softDelete && 'active' in doc) {
      doc.active = false;
      await doc.save();
    } else {
      await doc.deleteOne();
    }

    await audit.record({
      action: 'delete',
      entity: model.modelName,
      entityId: doc._id,
      entityLabel: label,
      req,
    });

    return noContent(res);
  });

  return { list, getOne, create, update, remove };
}

/**
 * `.lean()` skips the toJSON transform, so `_id` must be renamed by hand for
 * list responses to match the shape of single-document responses.
 */
function normaliseId(doc) {
  if (!doc || typeof doc !== 'object') return doc;
  if (Array.isArray(doc)) return doc.map(normaliseId);

  const out = { ...doc };
  if (out._id) {
    out.id = String(out._id);
    delete out._id;
  }
  delete out.__v;
  delete out.password;

  for (const [key, value] of Object.entries(out)) {
    if (value && typeof value === 'object' && (value._id || Array.isArray(value))) {
      out[key] = normaliseId(value);
    }
  }
  return out;
}

module.exports = { createCrudController, normaliseId };

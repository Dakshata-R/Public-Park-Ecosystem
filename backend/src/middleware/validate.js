'use strict';

/**
 * Request validation using Zod.
 *
 * The same schema library is used on the frontend (react-hook-form +
 * @hookform/resolvers/zod), so a field's rules are expressed the same way
 * on both sides of the wire.
 *
 *   router.post('/', validate({ body: createIncidentSchema }), controller.create)
 *
 * On success the parsed (and coerced) value replaces `req.body` / `req.query`
 * / `req.params`; on failure a 422 with per-field messages is returned.
 */

const ApiError = require('../utils/ApiError');

/** Convert a ZodError into `{ 'field.path': 'message' }`. */
function flatten(zodError) {
  const details = {};
  for (const issue of zodError.issues) {
    const key = issue.path.join('.') || '_';
    if (!details[key]) details[key] = issue.message;
  }
  return details;
}

/**
 * @param {{body?: import('zod').ZodTypeAny, query?: import('zod').ZodTypeAny, params?: import('zod').ZodTypeAny}} schemas
 * @returns {import('express').RequestHandler}
 */
function validate(schemas = {}) {
  return (req, _res, next) => {
    for (const source of ['params', 'query', 'body']) {
      const schema = schemas[source];
      if (!schema) continue;

      const result = schema.safeParse(req[source]);
      if (!result.success) {
        return next(
          new ApiError(422, `Invalid request ${source}`, flatten(result.error))
        );
      }

      // `req.query` has only a getter in Express 5; assigning per-key keeps
      // this working on both Express 4 and 5.
      if (source === 'query') {
        for (const key of Object.keys(result.data)) req.query[key] = result.data[key];
      } else {
        req[source] = result.data;
      }
    }
    next();
  };
}

module.exports = validate;

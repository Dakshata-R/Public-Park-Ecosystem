'use strict';

/**
 * Mongoose plugin that normalises documents for the wire.
 *
 * MongoDB's `_id`/`__v` leak database concerns into the UI, so every schema
 * applies this plugin to expose a plain `id` string instead and to strip
 * fields marked `private: true` (used for the password hash).
 */

module.exports = function toJSONPlugin(schema) {
  schema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform(doc, ret) {
      ret.id = ret._id?.toString?.() ?? ret._id;
      delete ret._id;

      for (const [path, options] of Object.entries(schema.paths)) {
        if (options.options && options.options.private) {
          delete ret[path];
        }
      }
      return ret;
    },
  });

  schema.set('toObject', { virtuals: true });
};

'use strict';

/**
 * Collision-free reference codes backed by the `Counter` collection.
 */

const Counter = require('../models/Counter');

const DUPLICATE_KEY = 11000;

/** Highest numeric suffix among existing `<prefix>-NNNN` codes. */
async function highestExisting(model, field, prefix) {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const docs = await model
    .find({ [field]: { $regex: `^${escaped}-\\d+$` } })
    .select(field)
    .lean();
  return docs.reduce((max, doc) => Math.max(max, Number.parseInt(doc[field].slice(prefix.length + 1), 10) || 0), 0);
}

/**
 * The next code for a prefix, e.g. `nextCode({ model: Incident, field:
 * 'referenceCode', prefix: 'INC-2026' })` → `INC-2026-0035`.
 *
 * The first call for a prefix seeds the counter from the highest code already
 * stored, so an existing database adopts counters without renumbering.
 */
async function nextCode({ model, field, prefix, width = 4 }) {
  if (!(await Counter.exists({ _id: prefix }))) {
    const highest = await highestExisting(model, field, prefix);
    try {
      await Counter.updateOne({ _id: prefix }, { $max: { seq: highest } }, { upsert: true });
    } catch (err) {
      if (err.code !== DUPLICATE_KEY) throw err; // another request initialised it first
    }
  }

  const { seq } = await Counter.findOneAndUpdate({ _id: prefix }, { $inc: { seq: 1 } }, { new: true, upsert: true });
  return `${prefix}-${String(seq).padStart(width, '0')}`;
}

const year = () => new Date().getFullYear();

module.exports = { nextCode, highestExisting, year };

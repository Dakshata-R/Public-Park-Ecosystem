'use strict';

/**
 * Named monotonic sequences for human-readable reference codes
 * (`INC-2026-0042`, `WO-2026-0007`, `CR-2026-0113`, `TRE-0231`).
 *
 * Deriving the next number from `countDocuments() + 1` breaks the moment a
 * record is deleted: the count falls, the next code repeats an existing one,
 * and the unique index rejects the insert. A counter incremented atomically
 * with `$inc` never goes backwards, so a code is never reissued.
 */

const mongoose = require('mongoose');

const counterSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    seq: { type: Number, required: true, default: 0 },
  },
  { versionKey: false }
);

module.exports = mongoose.model('Counter', counterSchema);

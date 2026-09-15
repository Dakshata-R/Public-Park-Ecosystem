'use strict';

/**
 * Module 5 — the photograph behind an AI detection.
 *
 * Every analysed image is stored as a ≤640 px JPEG copy, whether it arrived
 * as an upload or a URL. Detections, incidents opened from them, and the
 * gallery then reference `/api/ai/images/:id` rather than a multi-megabyte
 * data URL embedded in every document, or a third-party URL that can vanish.
 *
 * Identical images (by SHA-256 of the stored bytes) are stored once.
 */

const mongoose = require('mongoose');
const toJSONPlugin = require('./plugins/toJSON');

const aiImageSchema = new mongoose.Schema(
  {
    /** Excluded from queries unless asked for — only the image route needs the bytes. */
    data: { type: Buffer, required: true, select: false, private: true },
    contentType: { type: String, default: 'image/jpeg' },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    bytes: { type: Number, required: true },
    sha256: { type: String, required: true, unique: true },

    source: { type: String, enum: ['upload', 'url', 'sample'], required: true },
    /** The URL the image was fetched from, when it was not an upload. */
    originalUrl: { type: String, default: '' },
    /** Author and licence, for openly licensed sample photographs. */
    credit: { type: String, default: '' },
  },
  { timestamps: true }
);

aiImageSchema.plugin(toJSONPlugin);

module.exports = mongoose.model('AiImage', aiImageSchema);

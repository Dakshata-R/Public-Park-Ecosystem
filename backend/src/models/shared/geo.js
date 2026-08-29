'use strict';

/**
 * Reusable GeoJSON sub-schemas.
 *
 * MongoDB indexes and the GeoJSON spec both order coordinates as
 * [longitude, latitude] — the opposite of Leaflet's [lat, lng]. The
 * conversion happens once, in the frontend mapper (`lib/api/geo.ts`), so
 * everything stored here stays spec-compliant.
 */

const mongoose = require('mongoose');

const pointSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: {
      type: [Number],
      required: true,
      validate: {
        validator: (v) =>
          Array.isArray(v) &&
          v.length === 2 &&
          v[0] >= -180 && v[0] <= 180 &&
          v[1] >= -90 && v[1] <= 90,
        message: 'coordinates must be [longitude, latitude] within valid ranges',
      },
    },
  },
  { _id: false }
);

const polygonSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['Polygon'], default: 'Polygon' },
    coordinates: { type: [[[Number]]], required: true },
  },
  { _id: false }
);

const lineStringSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['LineString'], default: 'LineString' },
    coordinates: { type: [[Number]], required: true },
  },
  { _id: false }
);

/** Convenience constructor: `point(lng, lat)`. */
const point = (lng, lat) => ({ type: 'Point', coordinates: [lng, lat] });

module.exports = { pointSchema, polygonSchema, lineStringSchema, point };

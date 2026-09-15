'use strict';

/**
 * Zod building blocks shared across the module schemas.
 */

const { z } = require('zod');

/** A 24-character hex MongoDB ObjectId. */
const objectId = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid id');

/**
 * GeoJSON Point with [longitude, latitude] ordering.
 * [0, 0] is rejected: it is in the Gulf of Guinea, and in practice only ever
 * means a form was submitted before a location was picked.
 */
const geoPoint = z.object({
  type: z.literal('Point').default('Point'),
  coordinates: z
    .tuple([
      z.number().min(-180).max(180),
      z.number().min(-90).max(90),
    ])
    .refine(([lng, lat]) => !(lng === 0 && lat === 0), 'Pick a location — [0, 0] is not a valid position')
    .describe('[longitude, latitude]'),
});

/** GeoJSON LineString, used for walking trails. */
const geoLineString = z.object({
  type: z.literal('LineString').default('LineString'),
  coordinates: z.array(z.tuple([z.number(), z.number()])).min(2),
});

/** `/:id` route parameter. */
const idParam = z.object({ id: objectId });

/** Query parameters every list endpoint accepts. */
const listQuery = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(200).optional(),
    sort: z.string().optional(),
    q: z.string().max(200).optional(),
  })
  .passthrough(); // module-specific filters pass through untouched

/** ISO date string or Date, coerced to a Date. */
const dateish = z.coerce.date();

module.exports = { objectId, geoPoint, geoLineString, idParam, listQuery, dateish, z };

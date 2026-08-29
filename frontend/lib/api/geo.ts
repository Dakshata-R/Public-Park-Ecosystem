/**
 * GeoJSON ↔ Leaflet coordinate conversion.
 *
 * GeoJSON (and therefore MongoDB, and therefore every API response) orders
 * coordinates as [longitude, latitude]. Leaflet orders them [latitude,
 * longitude]. Getting this backwards puts a park in the Indian Ocean, and the
 * mistake is invisible until the map renders — so the swap happens only here,
 * never inline in a component.
 */

import type {
  GeoPoint,
  GeoLineString,
  GeoPolygon,
  LatLng,
  Position,
} from '@/lib/types';

/** [lng, lat] → [lat, lng]. */
export function toLatLng(position: Position): LatLng {
  return [position[1], position[0]];
}

/** [lat, lng] → [lng, lat]. */
export function toPosition(latLng: LatLng): Position {
  return [latLng[1], latLng[0]];
}

/** A GeoJSON Point's centre, in Leaflet order. */
export function pointToLatLng(point: GeoPoint | undefined | null): LatLng | null {
  if (!point?.coordinates) return null;
  return toLatLng(point.coordinates);
}

/** A LineString's vertices, in Leaflet order. */
export function lineToLatLngs(line: GeoLineString | undefined | null): LatLng[] {
  if (!line?.coordinates) return [];
  return line.coordinates.map(toLatLng);
}

/** A Polygon's outer ring, in Leaflet order. */
export function polygonToLatLngs(polygon: GeoPolygon | undefined | null): LatLng[] {
  if (!polygon?.coordinates?.[0]) return [];
  return polygon.coordinates[0].map(toLatLng);
}

/** Build a GeoJSON Point for sending to the API. */
export function makePoint(lat: number, lng: number): GeoPoint {
  return { type: 'Point', coordinates: [lng, lat] };
}

/**
 * Bounding box covering a set of points, as Leaflet expects for `fitBounds`.
 * Returns null when there is nothing to fit.
 */
export function boundsOf(points: LatLng[]): [LatLng, LatLng] | null {
  if (!points.length) return null;

  let minLat = points[0][0];
  let maxLat = points[0][0];
  let minLng = points[0][1];
  let maxLng = points[0][1];

  for (const [lat, lng] of points) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }

  // A single point produces a zero-area box, which Leaflet renders at maximum
  // zoom. Pad it slightly so the result is usable.
  if (minLat === maxLat && minLng === maxLng) {
    const pad = 0.004;
    return [
      [minLat - pad, minLng - pad],
      [maxLat + pad, maxLng + pad],
    ];
  }

  return [
    [minLat, minLng],
    [maxLat, maxLng],
  ];
}

/**
 * Great-circle distance in metres between two Leaflet points (haversine).
 * Used for the "within N metres" filters in the map sidebar.
 */
export function distanceMetres(a: LatLng, b: LatLng): number {
  const R = 6_371_000; // mean Earth radius, metres
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/** Default map view when nothing has loaded yet — the demonstration city. */
export const DEFAULT_CENTRE: LatLng = [12.9716, 77.5946];
export const DEFAULT_ZOOM = 13;

'use strict';

/**
 * Public API integrations — weather, real air quality, GBIF, geocoding.
 *
 * Endpoints here proxy upstream services rather than letting the browser call
 * them directly. That is deliberate:
 *
 *   • API keys stay on the server, never in a bundle;
 *   • one shared cache serves every visitor instead of one per browser,
 *     which is what keeps the project inside Nominatim's and eBird's rate
 *     limits;
 *   • upstream responses are reshaped into the project's own vocabulary, so a
 *     change of provider does not ripple into the frontend;
 *   • air-quality concentrations are scored through this project's CPCB
 *     implementation before they leave the server.
 */

const { Park, Species } = require('../models');
const asyncHandler = require('../middleware/asyncHandler');
const { ok } = require('../utils/response');
const ApiError = require('../utils/ApiError');
const external = require('../services/external.service');

/**
 * Resolve the coordinate a request is about: an explicit lat/lng, a park id,
 * or the network centroid as a last resort.
 *
 * @returns {Promise<{lat:number, lng:number, park:object|null, label:string}>}
 */
async function resolveLocation(query) {
  const lat = Number.parseFloat(query.lat);
  const lng = Number.parseFloat(query.lng);

  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw ApiError.badRequest('lat must be within ±90 and lng within ±180');
    }
    return { lat, lng, park: null, label: `${lat.toFixed(4)}, ${lng.toFixed(4)}` };
  }

  if (query.park) {
    const park = await Park.findById(query.park).lean();
    if (!park) throw ApiError.notFound('Park');
    const [plng, plat] = park.location.coordinates;
    return { lat: plat, lng: plng, park, label: park.name };
  }

  // Centroid of every active park — the sensible "citywide" answer.
  const parks = await Park.find({ active: true }).select('location').lean();
  if (!parks.length) throw ApiError.badRequest('No parks are configured; pass lat and lng explicitly');

  const sum = parks.reduce(
    (acc, p) => ({ lng: acc.lng + p.location.coordinates[0], lat: acc.lat + p.location.coordinates[1] }),
    { lng: 0, lat: 0 }
  );

  return {
    lat: sum.lat / parks.length,
    lng: sum.lng / parks.length,
    park: null,
    label: 'City centre (mean of all parks)',
  };
}

/** GET /api/integrations/weather?park=|lat=&lng= */
const getWeather = asyncHandler(async (req, res) => {
  const location = await resolveLocation(req.query);

  // Prefer OpenWeatherMap only when a key is present, since the deck names it;
  // otherwise Open-Meteo, which needs no key and returns a richer forecast.
  const preferred = process.env.OPENWEATHER_API_KEY && req.query.source === 'openweathermap'
    ? await external.getWeatherOpenWeatherMap(location.lat, location.lng)
    : await external.getWeather(location.lat, location.lng);

  return ok(res, {
    location: { lat: location.lat, lng: location.lng, label: location.label, park: location.park?.name || null },
    ...preferred,
  });
});

/**
 * GET /api/integrations/air-quality?park=
 *
 * Returns the live CPCB AQI computed from real CAMS concentrations, alongside
 * whatever this park's own AQI sensor is currently reading. Showing both is
 * the point: the difference between a satellite-model estimate and a
 * ground-truth sensor is exactly what a deployment needs to see.
 */
const getAirQuality = asyncHandler(async (req, res) => {
  const location = await resolveLocation(req.query);
  const live = await external.getAirQuality(location.lat, location.lng);

  let localSensor = null;
  if (location.park) {
    const { Sensor } = require('../models');
    const sensor = await Sensor.findOne({ park: location.park._id, type: 'aqi', active: true })
      .select('name currentValue unit status lastReadingAt')
      .lean();
    if (sensor) {
      localSensor = {
        name: sensor.name,
        value: sensor.currentValue,
        unit: sensor.unit,
        status: sensor.status,
        lastReadingAt: sensor.lastReadingAt,
      };
    }
  }

  return ok(res, {
    location: { lat: location.lat, lng: location.lng, label: location.label, park: location.park?.name || null },
    live,
    localSensor,
    divergence:
      live.ok && localSensor ? Math.round((localSensor.value - live.aqi) * 10) / 10 : null,
  });
});

/**
 * GET /api/integrations/park-conditions?park=
 * Weather and air quality in one call — what the dashboard's conditions panel
 * needs, without making the browser wait on two round trips.
 */
const getParkConditions = asyncHandler(async (req, res) => {
  const location = await resolveLocation(req.query);

  const [weather, airQuality] = await Promise.all([
    external.getWeather(location.lat, location.lng),
    external.getAirQuality(location.lat, location.lng),
  ]);

  /**
   * A plain-language advisory combining both. This is the piece a visitor
   * actually acts on, and it belongs on the server so the rule is stated once.
   */
  let advisory = 'Conditions are suitable for outdoor activity.';
  if (airQuality.ok && airQuality.aqi > 200) {
    advisory = 'Air quality is poor. Avoid strenuous outdoor activity, particularly for children and older visitors.';
  } else if (airQuality.ok && airQuality.aqi > 100) {
    advisory = 'Air quality is moderate. Sensitive individuals should limit prolonged exertion outdoors.';
  } else if (weather.ok && weather.current?.uvIndexMax >= 8) {
    advisory = 'UV index is very high. Seek shade between 11:00 and 15:00 and use sun protection.';
  } else if (weather.ok && weather.current?.precipitation > 2) {
    advisory = 'Rain is falling. Paths may be slippery and unpaved trails waterlogged.';
  } else if (weather.ok && weather.current?.temperature >= 38) {
    advisory = 'Heat is extreme. Carry water and avoid the open lawns during the afternoon.';
  }

  return ok(res, {
    location: { lat: location.lat, lng: location.lng, label: location.label, park: location.park?.name || null },
    weather,
    airQuality,
    advisory,
  });
});

/**
 * GET /api/integrations/gbif/:speciesId
 * Cross-check a catalogued species against GBIF: does the global record agree
 * that this species occurs near these parks, and is the scientific name the
 * accepted one?
 */
const verifySpecies = asyncHandler(async (req, res) => {
  const species = await Species.findById(req.params.speciesId).lean();
  if (!species) throw ApiError.notFound('Species');

  const location = await resolveLocation(req.query);

  const [occurrences, taxonomy] = await Promise.all([
    external.getGbifOccurrences(species.scientificName, {
      lat: location.lat,
      lng: location.lng,
      radiusKm: Number.parseInt(req.query.radiusKm, 10) || 50,
    }),
    external.matchGbifSpecies(species.scientificName),
  ]);

  /** Whether the local record survives the external check. */
  const verdict = !occurrences.ok
    ? 'unknown'
    : occurrences.recordedNearby
    ? 'corroborated'
    : 'not-recorded-nearby';

  return ok(res, {
    species: {
      id: String(species._id),
      commonName: species.commonName,
      scientificName: species.scientificName,
      class: species.class,
    },
    taxonomy,
    occurrences,
    verdict,
    note:
      verdict === 'not-recorded-nearby'
        ? 'GBIF holds no georeferenced record of this species within the search radius. The local identification is worth reviewing.'
        : verdict === 'corroborated'
        ? 'GBIF holds georeferenced records of this species nearby, which supports the local identification.'
        : 'GBIF could not be reached, so no external check was possible.',
  });
});

/** GET /api/integrations/gbif/search?name=&lat=&lng= */
const searchGbif = asyncHandler(async (req, res) => {
  const name = String(req.query.name || '').trim();
  if (!name) throw ApiError.badRequest('`name` (a scientific name) is required');

  const location = await resolveLocation(req.query);
  const occurrences = await external.getGbifOccurrences(name, {
    lat: location.lat,
    lng: location.lng,
    radiusKm: Number.parseInt(req.query.radiusKm, 10) || 50,
    limit: Math.min(50, Number.parseInt(req.query.limit, 10) || 20),
  });

  return ok(res, occurrences);
});

/** GET /api/integrations/ebird?park= — optional, requires EBIRD_API_KEY. */
const getEbird = asyncHandler(async (req, res) => {
  const location = await resolveLocation(req.query);
  const observations = await external.getEbirdNearby(location.lat, location.lng, {
    radiusKm: Number.parseInt(req.query.radiusKm, 10) || 25,
    days: Number.parseInt(req.query.days, 10) || 14,
  });

  return ok(res, {
    location: { lat: location.lat, lng: location.lng, label: location.label },
    ...observations,
  });
});

/** GET /api/integrations/geocode?lat=&lng= */
const reverseGeocode = asyncHandler(async (req, res) => {
  const lat = Number.parseFloat(req.query.lat);
  const lng = Number.parseFloat(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw ApiError.badRequest('Both `lat` and `lng` are required');
  }
  return ok(res, await external.reverseGeocode(lat, lng));
});

/** GET /api/integrations/status */
const getStatus = asyncHandler(async (_req, res) => ok(res, await external.getIntegrationStatus()));

/** POST /api/integrations/clear-cache — administrator only. */
const clearCache = asyncHandler(async (_req, res) =>
  ok(res, { cleared: external.clearCache() })
);

module.exports = {
  getWeather,
  getAirQuality,
  getParkConditions,
  verifySpecies,
  searchGbif,
  getEbird,
  reverseGeocode,
  getStatus,
  clearCache,
};

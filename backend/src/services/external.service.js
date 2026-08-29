'use strict';

/**
 * Public API integrations.
 *
 * ---------------------------------------------------------------------------
 * Which services, and why these
 * ---------------------------------------------------------------------------
 * The zeroth-review deck lists OpenWeatherMap, GBIF, eBird and OpenStreetMap.
 * Three of those need an API key, and a project that only works once a marker
 * has registered for four accounts is not a working project. So the defaults
 * are the keyless services, and the keyed ones activate automatically if the
 * corresponding environment variable is present.
 *
 *   Open-Meteo Forecast      no key   current weather + 7-day forecast
 *   Open-Meteo Air Quality   no key   PM2.5, PM10, NO₂, SO₂, CO, O₃ concentrations
 *   GBIF Occurrence          no key   global species occurrence records
 *   Nominatim (OSM)          no key   reverse geocoding for report locations
 *   OpenWeatherMap           key      alternative weather source
 *   eBird                    key      recent bird observations near a point
 *
 * ---------------------------------------------------------------------------
 * The air-quality integration is the important one
 * ---------------------------------------------------------------------------
 * Open-Meteo returns raw pollutant *concentrations*, not a pre-computed index.
 * That means the CPCB sub-index mathematics in `aqi.service.js` runs on real
 * measured data rather than on a number somebody else already calculated —
 * the formula is genuinely being applied, not decorated with.
 *
 * ---------------------------------------------------------------------------
 * Failure is expected, not exceptional
 * ---------------------------------------------------------------------------
 * A demonstration may run offline, behind a captive portal, or against a rate
 * limited endpoint. Every call here is wrapped with a timeout and returns
 * `{ ok: false, reason }` instead of throwing, and every caller has a local
 * fallback. Nothing in the system stops working because an upstream is down.
 */

const logger = require('../utils/logger');
const { computeAqi, describeAqi } = require('./aqi.service');

/** Upstream endpoints. */
const ENDPOINTS = {
  openMeteoForecast: 'https://api.open-meteo.com/v1/forecast',
  openMeteoAirQuality: 'https://air-quality-api.open-meteo.com/v1/air-quality',
  gbifOccurrence: 'https://api.gbif.org/v1/occurrence/search',
  gbifSpeciesMatch: 'https://api.gbif.org/v1/species/match',
  nominatimReverse: 'https://nominatim.openstreetmap.org/reverse',
  openWeather: 'https://api.openweathermap.org/data/2.5/weather',
  ebirdRecentNearby: 'https://api.ebird.org/v2/data/obs/geo/recent',
};

const REQUEST_TIMEOUT_MS = 8000;

/**
 * Nominatim's usage policy requires an identifying User-Agent. Sending a
 * generic one is the fastest way to get an IP blocked, so it is set here.
 */
const USER_AGENT = 'GreenPulse/1.0 (university project; park ecosystem monitoring)';

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/**
 * In-process TTL cache.
 *
 * Weather does not change between two dashboard loads a second apart, and
 * every one of these services is rate limited. A plain Map is sufficient — a
 * single Node process serves this application, so there is nothing to share
 * across instances and no reason to add Redis.
 */
const cache = new Map();

/** Cache lifetimes, chosen from how fast each source actually changes. */
const TTL = {
  weather: 10 * 60_000,      // Open-Meteo updates hourly
  airQuality: 15 * 60_000,   // hourly model output
  gbif: 24 * 60 * 60_000,    // occurrence records are effectively static
  geocode: 7 * 24 * 60 * 60_000, // an address does not move
  ebird: 30 * 60_000,
};

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key, value, ttlMs) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  // Bound the cache so a long-running process cannot leak memory through it.
  if (cache.size > 500) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
    if (oldest) cache.delete(oldest[0]);
  }
}

/** Drop every cached response — exposed to the admin module. */
function clearCache() {
  const size = cache.size;
  cache.clear();
  return size;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/**
 * GET JSON with a timeout, returning a result object rather than throwing.
 *
 * @param {string} url
 * @param {object} [options]
 * @param {Record<string,string>} [options.headers]
 * @returns {Promise<{ok: true, data: any} | {ok: false, reason: string, status?: number}>}
 */
async function fetchJson(url, { headers = {} } = {}) {
  if (typeof fetch !== 'function') {
    return { ok: false, reason: 'This Node runtime has no global fetch (Node 18+ required)' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers },
    });

    if (!response.ok) {
      return { ok: false, reason: `Upstream responded ${response.status}`, status: response.status };
    }
    return { ok: true, data: await response.json() };
  } catch (err) {
    const reason = err.name === 'AbortError'
      ? `Timed out after ${REQUEST_TIMEOUT_MS / 1000}s`
      : err.message || 'Network error';
    return { ok: false, reason };
  } finally {
    clearTimeout(timer);
  }
}

const query = (params) =>
  Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

// ---------------------------------------------------------------------------
// Weather — Open-Meteo
// ---------------------------------------------------------------------------

/** WMO weather interpretation codes, as returned by Open-Meteo. */
const WMO_CODES = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Depositing rime fog',
  51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
  56: 'Light freezing drizzle', 57: 'Dense freezing drizzle',
  61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
  66: 'Light freezing rain', 67: 'Heavy freezing rain',
  71: 'Slight snowfall', 73: 'Moderate snowfall', 75: 'Heavy snowfall', 77: 'Snow grains',
  80: 'Slight rain showers', 81: 'Moderate rain showers', 82: 'Violent rain showers',
  85: 'Slight snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with slight hail', 99: 'Thunderstorm with heavy hail',
};

/** Icon key for the frontend to map onto a Lucide component. */
function weatherIcon(code, isDay = true) {
  if (code === 0) return isDay ? 'sun' : 'moon';
  if (code <= 2) return isDay ? 'cloud-sun' : 'cloud-moon';
  if (code === 3) return 'cloud';
  if (code <= 48) return 'cloud-fog';
  if (code <= 57) return 'cloud-drizzle';
  if (code <= 67) return 'cloud-rain';
  if (code <= 77) return 'cloud-snow';
  if (code <= 86) return 'cloud-rain-wind';
  return 'cloud-lightning';
}

/**
 * Current conditions and a short forecast for a coordinate.
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<{ok: boolean, source?: string, current?: object, forecast?: object[], reason?: string}>}
 */
async function getWeather(lat, lng) {
  const key = `weather:${lat.toFixed(3)},${lng.toFixed(3)}`;
  const cached = cacheGet(key);
  if (cached) return { ...cached, cached: true };

  const url = `${ENDPOINTS.openMeteoForecast}?${query({
    latitude: lat,
    longitude: lng,
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,surface_pressure,wind_speed_10m,wind_direction_10m,cloud_cover',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,uv_index_max,sunrise,sunset',
    timezone: 'auto',
    forecast_days: 7,
  })}`;

  const result = await fetchJson(url);
  if (!result.ok) {
    logger.warn(`Weather lookup failed: ${result.reason}`);
    return { ok: false, reason: result.reason, source: 'open-meteo' };
  }

  const c = result.data.current || {};
  const d = result.data.daily || {};

  const payload = {
    ok: true,
    source: 'Open-Meteo',
    attribution: 'Weather data by Open-Meteo.com (CC BY 4.0)',
    current: {
      temperature: c.temperature_2m,
      feelsLike: c.apparent_temperature,
      humidity: c.relative_humidity_2m,
      precipitation: c.precipitation,
      pressure: c.surface_pressure,
      windSpeed: c.wind_speed_10m,
      windDirection: c.wind_direction_10m,
      cloudCover: c.cloud_cover,
      isDay: c.is_day === 1,
      code: c.weather_code,
      condition: WMO_CODES[c.weather_code] || 'Unknown',
      icon: weatherIcon(c.weather_code, c.is_day === 1),
      observedAt: c.time,
      // Today's UV maximum, which the daily block carries rather than current.
      uvIndexMax: d.uv_index_max?.[0] ?? null,
      sunrise: d.sunrise?.[0] ?? null,
      sunset: d.sunset?.[0] ?? null,
    },
    forecast: (d.time || []).map((date, i) => ({
      date,
      code: d.weather_code?.[i],
      condition: WMO_CODES[d.weather_code?.[i]] || 'Unknown',
      icon: weatherIcon(d.weather_code?.[i], true),
      tempMax: d.temperature_2m_max?.[i],
      tempMin: d.temperature_2m_min?.[i],
      precipitation: d.precipitation_sum?.[i],
      uvIndexMax: d.uv_index_max?.[i],
    })),
  };

  cacheSet(key, payload, TTL.weather);
  return payload;
}

/**
 * Alternative weather source, used only when `OPENWEATHER_API_KEY` is set.
 * Kept because the project deck names OpenWeatherMap explicitly.
 */
async function getWeatherOpenWeatherMap(lat, lng) {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) return { ok: false, reason: 'OPENWEATHER_API_KEY is not configured' };

  const url = `${ENDPOINTS.openWeather}?${query({ lat, lon: lng, appid: apiKey, units: 'metric' })}`;
  const result = await fetchJson(url);
  if (!result.ok) return { ok: false, reason: result.reason, source: 'openweathermap' };

  const d = result.data;
  return {
    ok: true,
    source: 'OpenWeatherMap',
    current: {
      temperature: d.main?.temp,
      feelsLike: d.main?.feels_like,
      humidity: d.main?.humidity,
      pressure: d.main?.pressure,
      windSpeed: d.wind?.speed != null ? d.wind.speed * 3.6 : null, // m/s → km/h
      windDirection: d.wind?.deg,
      cloudCover: d.clouds?.all,
      condition: d.weather?.[0]?.description,
      icon: 'cloud',
      observedAt: new Date((d.dt || 0) * 1000).toISOString(),
    },
  };
}

// ---------------------------------------------------------------------------
// Air quality — Open-Meteo, scored with the project's own CPCB mathematics
// ---------------------------------------------------------------------------

/**
 * Real pollutant concentrations for a coordinate, converted to a CPCB AQI by
 * this project's own `aqi.service`.
 *
 * Open-Meteo reports CO in µg/m³ while the CPCB table is in mg/m³, so the
 * conversion happens here rather than being silently wrong by a factor of a
 * thousand.
 *
 * @param {number} lat
 * @param {number} lng
 */
async function getAirQuality(lat, lng) {
  const key = `aq:${lat.toFixed(3)},${lng.toFixed(3)}`;
  const cached = cacheGet(key);
  if (cached) return { ...cached, cached: true };

  const url = `${ENDPOINTS.openMeteoAirQuality}?${query({
    latitude: lat,
    longitude: lng,
    current: 'pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone,dust,uv_index',
    hourly: 'pm2_5,pm10',
    timezone: 'auto',
    forecast_days: 2,
  })}`;

  const result = await fetchJson(url);
  if (!result.ok) {
    logger.warn(`Air-quality lookup failed: ${result.reason}`);
    return { ok: false, reason: result.reason, source: 'open-meteo' };
  }

  const c = result.data.current || {};

  const concentrations = {
    pm25: c.pm2_5,
    pm10: c.pm10,
    no2: c.nitrogen_dioxide,
    so2: c.sulphur_dioxide,
    o3: c.ozone,
    // µg/m³ → mg/m³, which is the unit the CPCB CO breakpoints use.
    co: c.carbon_monoxide != null ? c.carbon_monoxide / 1000 : undefined,
  };

  const { aqi, dominant, subIndices } = computeAqi(concentrations);

  const payload = {
    ok: true,
    source: 'Open-Meteo Air Quality (CAMS)',
    attribution: 'Air quality data by Open-Meteo.com, derived from CAMS European/Global forecasts',
    observedAt: c.time,
    concentrations: {
      pm25: c.pm2_5,
      pm10: c.pm10,
      no2: c.nitrogen_dioxide,
      so2: c.sulphur_dioxide,
      o3: c.ozone,
      coMgM3: concentrations.co,
      dust: c.dust,
      uvIndex: c.uv_index,
    },
    /** Per-pollutant CPCB sub-indices, computed by this project. */
    subIndices,
    dominantPollutant: dominant,
    ...describeAqi(aqi),
    /** 24 hours of PM2.5 history, for the sparkline. */
    pm25Series: (result.data.hourly?.time || [])
      .map((time, i) => ({ time, pm25: result.data.hourly.pm2_5?.[i], pm10: result.data.hourly.pm10?.[i] }))
      .slice(0, 24),
  };

  cacheSet(key, payload, TTL.airQuality);
  return payload;
}

// ---------------------------------------------------------------------------
// GBIF — global species occurrence
// ---------------------------------------------------------------------------

/**
 * Occurrence records for a scientific name near a coordinate.
 *
 * This is the "is what we recorded plausible here" check: if the local
 * catalogue claims a species that GBIF has never recorded within 50 km, the
 * identification is worth reviewing.
 *
 * @param {string} scientificName
 * @param {object} [options]
 * @param {number} [options.lat]
 * @param {number} [options.lng]
 * @param {number} [options.radiusKm=50]
 * @param {number} [options.limit=20]
 */
async function getGbifOccurrences(scientificName, { lat, lng, radiusKm = 50, limit = 20 } = {}) {
  const key = `gbif:${scientificName}:${lat?.toFixed(2)},${lng?.toFixed(2)}:${radiusKm}`;
  const cached = cacheGet(key);
  if (cached) return { ...cached, cached: true };

  const params = {
    scientificName,
    limit,
    hasCoordinate: true,
    hasGeospatialIssue: false,
  };

  // GBIF takes a WKT geometry; approximate the radius as a bounding box, which
  // is enough for a plausibility check and far cheaper to build than a circle.
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    const dLat = radiusKm / 111;
    const dLng = radiusKm / (111 * Math.cos((lat * Math.PI) / 180) || 1);
    const [w, e, s, n] = [lng - dLng, lng + dLng, lat - dLat, lat + dLat];
    params.geometry = `POLYGON((${w} ${s},${e} ${s},${e} ${n},${w} ${n},${w} ${s}))`;
  }

  const result = await fetchJson(`${ENDPOINTS.gbifOccurrence}?${query(params)}`);
  if (!result.ok) return { ok: false, reason: result.reason, source: 'gbif' };

  const payload = {
    ok: true,
    source: 'GBIF',
    attribution: 'Occurrence data from the Global Biodiversity Information Facility (gbif.org)',
    scientificName,
    total: result.data.count ?? 0,
    /** True when GBIF has records nearby — the plausibility signal. */
    recordedNearby: (result.data.count ?? 0) > 0,
    radiusKm,
    occurrences: (result.data.results || []).map((r) => ({
      key: r.key,
      scientificName: r.scientificName,
      country: r.country,
      locality: r.locality,
      year: r.year,
      month: r.month,
      basisOfRecord: r.basisOfRecord,
      recordedBy: r.recordedBy,
      lat: r.decimalLatitude,
      lng: r.decimalLongitude,
      datasetName: r.datasetName,
    })),
  };

  cacheSet(key, payload, TTL.gbif);
  return payload;
}

/** Resolve a name against the GBIF backbone taxonomy — the authoritative spelling. */
async function matchGbifSpecies(name) {
  const key = `gbif-match:${name}`;
  const cached = cacheGet(key);
  if (cached) return { ...cached, cached: true };

  const result = await fetchJson(`${ENDPOINTS.gbifSpeciesMatch}?${query({ name, verbose: false })}`);
  if (!result.ok) return { ok: false, reason: result.reason, source: 'gbif' };

  const d = result.data;
  const payload = {
    ok: true,
    source: 'GBIF Backbone Taxonomy',
    matchType: d.matchType,
    confidence: d.confidence,
    accepted: d.matchType !== 'NONE',
    usageKey: d.usageKey,
    scientificName: d.scientificName,
    canonicalName: d.canonicalName,
    rank: d.rank,
    kingdom: d.kingdom,
    phylum: d.phylum,
    class: d.class,
    order: d.order,
    family: d.family,
    genus: d.genus,
  };

  cacheSet(key, payload, TTL.gbif);
  return payload;
}

// ---------------------------------------------------------------------------
// eBird — recent bird observations (requires a key)
// ---------------------------------------------------------------------------

/**
 * Recent bird records near a coordinate.
 * Needs `EBIRD_API_KEY`; the key is free but requires registration, so this
 * integration is optional by design.
 */
async function getEbirdNearby(lat, lng, { radiusKm = 25, days = 14 } = {}) {
  const apiKey = process.env.EBIRD_API_KEY;
  if (!apiKey) return { ok: false, reason: 'EBIRD_API_KEY is not configured', source: 'ebird' };

  const key = `ebird:${lat.toFixed(2)},${lng.toFixed(2)}:${radiusKm}:${days}`;
  const cached = cacheGet(key);
  if (cached) return { ...cached, cached: true };

  const url = `${ENDPOINTS.ebirdRecentNearby}?${query({ lat, lng, dist: Math.min(50, radiusKm), back: Math.min(30, days) })}`;
  const result = await fetchJson(url, { 'X-eBirdApiToken': apiKey });
  if (!result.ok) return { ok: false, reason: result.reason, source: 'ebird' };

  const payload = {
    ok: true,
    source: 'eBird',
    attribution: 'Bird observation data from eBird (Cornell Lab of Ornithology)',
    observations: (result.data || []).map((o) => ({
      speciesCode: o.speciesCode,
      commonName: o.comName,
      scientificName: o.sciName,
      count: o.howMany ?? 1,
      observedAt: o.obsDt,
      locationName: o.locName,
      lat: o.lat,
      lng: o.lng,
    })),
  };

  cacheSet(key, payload, TTL.ebird);
  return payload;
}

// ---------------------------------------------------------------------------
// Nominatim — reverse geocoding
// ---------------------------------------------------------------------------

/**
 * Turn a coordinate into a street address, so a citizen report dropped on the
 * map carries a human-readable location.
 *
 * Nominatim allows at most one request per second and requires attribution;
 * the aggressive cache TTL here exists to honour that.
 */
async function reverseGeocode(lat, lng) {
  const key = `geocode:${lat.toFixed(4)},${lng.toFixed(4)}`;
  const cached = cacheGet(key);
  if (cached) return { ...cached, cached: true };

  const url = `${ENDPOINTS.nominatimReverse}?${query({ lat, lon: lng, format: 'jsonv2', zoom: 17, addressdetails: 1 })}`;
  const result = await fetchJson(url);
  if (!result.ok) return { ok: false, reason: result.reason, source: 'nominatim' };

  const d = result.data;
  const payload = {
    ok: true,
    source: 'OpenStreetMap Nominatim',
    attribution: '© OpenStreetMap contributors',
    displayName: d.display_name,
    address: {
      road: d.address?.road,
      suburb: d.address?.suburb || d.address?.neighbourhood,
      city: d.address?.city || d.address?.town || d.address?.village,
      state: d.address?.state,
      postcode: d.address?.postcode,
      country: d.address?.country,
    },
  };

  cacheSet(key, payload, TTL.geocode);
  return payload;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * Which integrations are configured, and whether the keyless ones actually
 * respond right now. Surfaced in the admin module so a failing integration is
 * diagnosable rather than mysterious.
 */
async function getIntegrationStatus() {
  const probe = await fetchJson(
    `${ENDPOINTS.openMeteoForecast}?${query({ latitude: 12.97, longitude: 77.59, current: 'temperature_2m' })}`
  );

  return {
    reachable: probe.ok,
    probeReason: probe.ok ? null : probe.reason,
    cacheEntries: cache.size,
    integrations: [
      { id: 'open-meteo-weather',  name: 'Open-Meteo Forecast',     purpose: 'Current weather and 7-day forecast', requiresKey: false, configured: true, live: probe.ok },
      { id: 'open-meteo-air',      name: 'Open-Meteo Air Quality',  purpose: 'Pollutant concentrations scored with CPCB breakpoints', requiresKey: false, configured: true, live: probe.ok },
      { id: 'gbif',                name: 'GBIF Occurrence',         purpose: 'Species occurrence records and taxonomy validation', requiresKey: false, configured: true, live: null },
      { id: 'nominatim',           name: 'OpenStreetMap Nominatim', purpose: 'Reverse geocoding for report locations', requiresKey: false, configured: true, live: null },
      { id: 'openweathermap',      name: 'OpenWeatherMap',          purpose: 'Alternative weather source', requiresKey: true, configured: Boolean(process.env.OPENWEATHER_API_KEY), live: null },
      { id: 'ebird',               name: 'eBird',                   purpose: 'Recent bird observations near a park', requiresKey: true, configured: Boolean(process.env.EBIRD_API_KEY), live: null },
    ],
  };
}

module.exports = {
  getWeather,
  getWeatherOpenWeatherMap,
  getAirQuality,
  getGbifOccurrences,
  matchGbifSpecies,
  getEbirdNearby,
  reverseGeocode,
  getIntegrationStatus,
  clearCache,
  WMO_CODES,
  ENDPOINTS,
};

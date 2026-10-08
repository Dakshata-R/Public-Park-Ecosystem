'use strict';

/**
 * Build the real-world reference dataset from open data.
 *
 *   OpenStreetMap (Overpass API)  park boundaries, and the trees, benches,
 *                                 lamps, paths, water bodies and amenities
 *                                 mapped inside them
 *   GBIF occurrence API           every species recorded inside each park
 *                                 boundary, counted per month
 *   GBIF species API              taxonomy, English names, IUCN Red List
 *                                 category, a CC-licensed photograph
 *   GRIIS India checklist (GBIF)  which of those species are introduced or
 *                                 invasive in India
 *
 * The result is written to `src/seed/data/open-data/` and committed, so the
 * seeder runs offline and produces the same database every time. Re-run this
 * to refresh the snapshot:
 *
 *   npm run data:refresh
 *
 * It makes a few thousand polite, rate-limited requests and takes ~10 minutes.
 */

const fs = require('fs/promises');
const path = require('path');

const OUT_DIR = path.resolve(__dirname, '../src/seed/data/open-data');
const USER_AGENT = 'GreenPulse/1.0 (academic park-ecology project; https://github.com/Dakshata-R/Public-Park-Ecosystem)';
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const GBIF = 'https://api.gbif.org/v1';
const GRIIS_INDIA = 'b09c3987-af9a-4658-9bfd-19cf712ac3d1';

/** GBIF records from this date onward are counted. */
const WINDOW_START = '2023-01-01';

/**
 * The monitored parks. Everything except `description`, `establishedYear`
 * and `manager` comes from OpenStreetMap; those three are stated only where
 * they are well documented, and left empty otherwise.
 */
const PARKS = [
  {
    slug: 'cubbon-park',
    osm: { type: 'way', id: 22895320 },
    description: 'Historic public park in central Bengaluru, laid out in 1870, with one of the city\'s largest stands of mature trees.',
    establishedYear: 1870,
    manager: 'Department of Horticulture, Government of Karnataka',
  },
  {
    slug: 'lalbagh-botanical-garden',
    osm: { type: 'way', id: 15802464 },
    description: 'Botanical garden in south Bengaluru commissioned by Hyder Ali in 1760, with a glasshouse and a lake.',
    establishedYear: 1760,
    manager: 'Department of Horticulture, Government of Karnataka',
  },
  {
    slug: 'sankey-tank-park',
    osm: { type: 'relation', id: 6030714 },
    description: 'Lakeside park around Sankey Tank, a reservoir built in 1882, between Malleswaram and Sadashivanagar.',
    establishedYear: null,
    manager: 'Bruhat Bengaluru Mahanagara Palike (BBMP)',
  },
  {
    slug: 'jp-park',
    osm: { type: 'way', id: 37107047 },
    description: 'Jayaprakash Narayan Park in Mathikere, north-west Bengaluru — a large neighbourhood park built around a lake.',
    establishedYear: null,
    manager: 'Bruhat Bengaluru Mahanagara Palike (BBMP)',
  },
  {
    slug: 'freedom-park',
    osm: { type: 'way', id: 36884560 },
    description: 'Public park in Gandhi Nagar on the site of the former Bangalore Central Jail.',
    establishedYear: null,
    manager: 'Bruhat Bengaluru Mahanagara Palike (BBMP)',
  },
  {
    slug: 'coles-park',
    osm: { type: 'way', id: 133182891 },
    description: 'Neighbourhood park in Fraser Town, east Bengaluru.',
    establishedYear: null,
    manager: 'Bruhat Bengaluru Mahanagara Palike (BBMP)',
  },
  // Major lake parks and city parks, spread across the city's zones.
  {
    slug: 'yelahanka-lake-park',
    osm: { type: 'relation', id: 15989436 },
    description: 'Park around Yelahanka Lake, one of the largest lakes in north Bengaluru.',
    establishedYear: null,
    manager: 'Bruhat Bengaluru Mahanagara Palike (BBMP)',
  },
  {
    slug: 'jakkur-lake-park',
    osm: { type: 'relation', id: 19063725 },
    description: 'Lake park in north Bengaluru, fed by treated wastewater and known for its wetland birdlife.',
    establishedYear: null,
    manager: 'Bruhat Bengaluru Mahanagara Palike (BBMP)',
  },
  {
    slug: 'rachenahalli-lake-park',
    osm: { type: 'relation', id: 19063726 },
    description: 'Lake park in north-east Bengaluru near Thanisandra, with a walking trail around the shoreline.',
    establishedYear: null,
    manager: 'Bruhat Bengaluru Mahanagara Palike (BBMP)',
  },
  {
    slug: 'kalkere-lake-park',
    osm: { type: 'relation', id: 19522877 },
    description: 'Lake park in east Bengaluru, adjoining the Kalkere wetland and its reed beds.',
    establishedYear: null,
    manager: 'Bruhat Bengaluru Mahanagara Palike (BBMP)',
  },
  {
    slug: 'lumbini-gardens',
    osm: { type: 'way', id: 232780058 },
    description: 'Lakefront park on the shore of Nagawara Lake in north Bengaluru.',
    establishedYear: null,
    manager: '',
  },
  {
    slug: 'malathhalli-lake-park',
    osm: { type: 'way', id: 1241556749 },
    description: 'Lake park in west Bengaluru near Nagarbhavi.',
    establishedYear: null,
    manager: 'Bruhat Bengaluru Mahanagara Palike (BBMP)',
  },
  {
    slug: 'doddanekundi-lake-park',
    osm: { type: 'relation', id: 20742796 },
    description: 'Lake park in east Bengaluru, between Marathahalli and the Outer Ring Road.',
    establishedYear: null,
    manager: 'Bruhat Bengaluru Mahanagara Palike (BBMP)',
  },
  {
    slug: 'agara-lake-park',
    osm: { type: 'way', id: 610111576 },
    description: 'Lake park between HSR Layout and Koramangala in south-east Bengaluru.',
    establishedYear: null,
    manager: 'Bruhat Bengaluru Mahanagara Palike (BBMP)',
  },
  {
    slug: 'madiwala-lake-park',
    osm: { type: 'way', id: 1265835948 },
    description: 'Park around Madiwala Lake in BTM Layout, one of the larger lakes in south Bengaluru.',
    establishedYear: null,
    manager: 'Bruhat Bengaluru Mahanagara Palike (BBMP)',
  },
  {
    slug: 'kaikondrahalli-lake-park',
    osm: { type: 'way', id: 610094122 },
    description: 'Restored lake park off Sarjapur Road in south-east Bengaluru.',
    establishedYear: null,
    manager: 'Bruhat Bengaluru Mahanagara Palike (BBMP)',
  },
  {
    slug: 'begur-lake-park',
    osm: { type: 'relation', id: 19509696 },
    description: 'Lake park in Begur, south Bengaluru.',
    establishedYear: null,
    manager: 'Bruhat Bengaluru Mahanagara Palike (BBMP)',
  },
  {
    slug: 'jp-nagar-mini-forest',
    osm: { type: 'relation', id: 17205860 },
    description: 'Urban woodland in JP Nagar, south Bengaluru, with a walking trail through dense tree cover.',
    establishedYear: null,
    manager: 'Bruhat Bengaluru Mahanagara Palike (BBMP)',
  },
  {
    slug: 'mn-krishna-rao-park',
    osm: { type: 'way', id: 15802611 },
    description: 'Neighbourhood park in Basavanagudi, south Bengaluru.',
    establishedYear: null,
    manager: 'Bruhat Bengaluru Mahanagara Palike (BBMP)',
  },
  {
    slug: 'dr-rajkumar-park',
    osm: { type: 'way', id: 55684220 },
    description: 'Neighbourhood park in south-west Bengaluru.',
    establishedYear: null,
    manager: 'Bruhat Bengaluru Mahanagara Palike (BBMP)',
  },
  {
    slug: 'panathur-tree-park',
    osm: { type: 'way', id: 1135950153 },
    description: 'Tree park in Panathur, east Bengaluru.',
    establishedYear: null,
    manager: 'Karnataka Forest Department',
  },
];

/** Families whose Lepidoptera are butterflies rather than moths. */
const BUTTERFLY_FAMILIES = new Set(['Papilionidae', 'Pieridae', 'Nymphalidae', 'Lycaenidae', 'Hesperiidae', 'Riodinidae']);

/**
 * GBIF IUCN codes → the catalogue's status vocabulary. "Not Evaluated" is
 * kept distinct from "Least Concern": most insects and plants have never
 * been assessed, and calling them Least Concern would be a false claim.
 */
const IUCN = {
  NE: 'Not Evaluated',
  DD: 'Data Deficient',
  LC: 'Least Concern',
  NT: 'Near Threatened',
  VU: 'Vulnerable',
  EN: 'Endangered',
  CR: 'Critically Endangered',
  EW: 'Extinct in the Wild',
};

/** Vernacular-name sources whose English names are curated, most trusted first. */
const NAME_SOURCES = [/ebird|clements/i, /iucn/i, /catalogue of life/i, /integrated taxonomic/i, /inaturalist/i];

/**
 * Pick one English common name. GBIF aggregates names from many checklists,
 * some mislabelled (Hawaiian names tagged English, bare "Ant"), so candidates
 * are scored by how many sources agree, whether a trusted checklist supplies
 * them, and whether they look like a real species name.
 */
function chooseCommonName(names) {
  const scores = new Map();
  for (const n of names) {
    if (!['eng', 'en'].includes(n.language)) continue;
    const name = String(n.vernacularName || '').trim();
    if (name.length < 4 || /^['ʻ]/.test(name) || /\d/.test(name)) continue;
    const key = name.toLowerCase();
    const trusted = NAME_SOURCES.findIndex((re) => re.test(n.source || ''));
    const entry = scores.get(key) || { name, score: 0 };
    entry.score += 1 + (n.preferred ? 3 : 0) + (trusted >= 0 ? 5 - trusted : 0) + (name.includes(' ') ? 1 : 0);
    scores.set(key, entry);
  }
  const best = [...scores.values()].sort((a, b) => b.score - a.score)[0];
  // Capitalise words, but not the letter after an apostrophe ("Devil's", not "Devil'S").
  return best ? best.name.replace(/(^|[\s-])([a-z])/g, (_, lead, c) => lead + c.toUpperCase()) : '';
}

const IMAGE_LICENSES = ['CC0_1_0', 'CC_BY_4_0', 'CC_BY_NC_4_0'];

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Successful responses are cached on disk for the length of a refresh, so a
 * run interrupted by a flaky upstream resumes where it stopped instead of
 * re-sending thousands of requests. Delete `.cache/open-data-http` to force a
 * completely fresh pull.
 */
const HTTP_CACHE = path.resolve(__dirname, '../.cache/open-data-http');
const HTTP_CACHE_TTL_MS = 24 * 3_600_000;

async function request(url, { method = 'GET', body, attempts = 6 } = {}) {
  const key = require('crypto').createHash('sha1').update(`${method} ${url} ${body || ''}`).digest('hex');
  const cacheFile = path.join(HTTP_CACHE, `${key}.json`);
  try {
    const stat = await fs.stat(cacheFile);
    if (Date.now() - stat.mtimeMs < HTTP_CACHE_TTL_MS) return JSON.parse(await fs.readFile(cacheFile, 'utf8'));
  } catch {
    // not cached
  }

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(url, {
        method,
        body,
        headers: {
          'User-Agent': USER_AGENT,
          ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        },
        signal: AbortSignal.timeout(180_000),
      });
      if (res.ok) {
        const data = await res.json();
        await fs.mkdir(HTTP_CACHE, { recursive: true });
        await fs.writeFile(cacheFile, JSON.stringify(data));
        return data;
      }
      if (![429, 500, 502, 503, 504].includes(res.status)) {
        throw Object.assign(new Error(`${res.status} from ${url.slice(0, 120)}`), { fatal: true });
      }
    } catch (err) {
      if (err.fatal || attempt === attempts) throw err;
    }
    await sleep(5000 * 2 ** (attempt - 1)); // 5 s, 10 s, 20 s, 40 s, 80 s
  }
  throw new Error('unreachable');
}

/** Run `task` over `items` with bounded concurrency. */
async function pool(items, concurrency, task) {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        results[index] = await task(items[index], index);
        done += 1;
        if (done % 50 === 0) process.stdout.write(`    ${done}/${items.length}\n`);
      }
    })
  );
  return results;
}

/** Public Overpass instances, tried in order — the main one throttles aggressively. */
const OVERPASS_MIRRORS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  OVERPASS,
  'https://overpass.private.coffee/api/interpreter',
];

async function overpass(query) {
  const body = `data=${encodeURIComponent(query)}`;
  let lastError;
  for (const endpoint of OVERPASS_MIRRORS) {
    try {
      return await request(endpoint, { method: 'POST', body, attempts: 2 });
    } catch (err) {
      lastError = err;
      console.warn(`    Overpass ${new URL(endpoint).host} failed (${err.message}); trying the next mirror`);
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

const EARTH_RADIUS_M = 6371008.8;
const toRad = (d) => (d * Math.PI) / 180;

/** Geodesic area of a lng/lat ring, m² (spherical excess approximation). */
function ringArea(ring) {
  let total = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[i + 1];
    total += toRad(lng2 - lng1) * (2 + Math.sin(toRad(lat1)) + Math.sin(toRad(lat2)));
  }
  return Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
}

/** Signed shoelace sum; positive means counter-clockwise in lng/lat. */
const signedArea = (ring) =>
  ring.slice(0, -1).reduce((sum, [x1, y1], i) => sum + (x1 * ring[i + 1][1] - ring[i + 1][0] * y1), 0) / 2;

const centroidOf = (ring) => {
  const pts = ring.slice(0, -1);
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
};

/** Ray-casting point-in-polygon. */
function contains(ring, [lng, lat]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Perpendicular distance from a point to a segment, in degrees (fine at park scale). */
function segmentDistance([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Ramer–Douglas–Peucker simplification, used to keep GBIF WKT queries short. */
function simplify(points, tolerance) {
  if (points.length < 3) return points;
  let maxDistance = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const d = segmentDistance(points[i], points[0], points[points.length - 1]);
    if (d > maxDistance) {
      maxDistance = d;
      index = i;
    }
  }
  if (maxDistance <= tolerance) return [points[0], points[points.length - 1]];
  return [...simplify(points.slice(0, index + 1), tolerance).slice(0, -1), ...simplify(points.slice(index), tolerance)];
}

/** Stitch relation member ways into closed rings. */
function stitchRings(ways) {
  const segments = ways.map((w) => w.map((p) => [p.lon, p.lat]));
  const rings = [];
  while (segments.length) {
    let ring = segments.shift();
    let extended = true;
    while (extended && !(ring.length > 3 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1])) {
      extended = false;
      const end = ring[ring.length - 1];
      for (let i = 0; i < segments.length; i += 1) {
        const s = segments[i];
        const same = (a, b) => a[0] === b[0] && a[1] === b[1];
        if (same(s[0], end)) ring = ring.concat(s.slice(1));
        else if (same(s[s.length - 1], end)) ring = ring.concat(s.slice(0, -1).reverse());
        else continue;
        segments.splice(i, 1);
        extended = true;
        break;
      }
    }
    if (ring.length > 3) rings.push(ring);
  }
  return rings;
}

const round6 = (x) => Math.round(x * 1e6) / 1e6;
const roundCoords = (coords) => coords.map(([lng, lat]) => [round6(lng), round6(lat)]);

// ---------------------------------------------------------------------------
// OpenStreetMap
// ---------------------------------------------------------------------------

async function fetchParkGeometry(park) {
  const { type, id } = park.osm;
  const data = await overpass(`[out:json][timeout:120];${type}(${id});out geom;`);
  const element = data.elements[0];
  if (!element) throw new Error(`OSM ${type}/${id} not found`);

  let ring;
  if (type === 'way') {
    ring = element.geometry.map((p) => [p.lon, p.lat]);
  } else {
    const outer = element.members.filter((m) => m.type === 'way' && m.role !== 'inner').map((m) => m.geometry);
    ring = stitchRings(outer).sort((a, b) => ringArea(b) - ringArea(a))[0];
  }
  if (!ring) throw new Error(`OSM ${type}/${id} has no usable boundary`);
  if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) ring.push(ring[0]);
  // GeoJSON and GBIF both want the exterior ring counter-clockwise.
  if (signedArea(ring) < 0) ring.reverse();

  return { tags: element.tags || {}, ring: roundCoords(ring) };
}

/** Everything mapped inside a park that the asset register can use. */
async function fetchParkFeatures(park) {
  // Query the bounding box, then keep only what lies inside the real boundary
  // (point-in-polygon below). Overpass area lookups are not reliably
  // available on the public instance, and a box query always is.
  const lngs = park.ring.map((p) => p[0]);
  const lats = park.ring.map((p) => p[1]);
  const bbox = `${Math.min(...lats)},${Math.min(...lngs)},${Math.max(...lats)},${Math.max(...lngs)}`;
  const data = await overpass(`[out:json][timeout:180][bbox:${bbox}];
(
  node["natural"="tree"];
  node["amenity"="bench"];
  node["highway"="street_lamp"];
  way["highway"~"^(footway|path|pedestrian|track|cycleway)$"];
  way["natural"="water"];
  relation["natural"="water"];
  nwr["amenity"~"^(toilets|drinking_water|cafe|parking|shelter|library)$"];
  nwr["leisure"~"^(playground|fitness_station|sports_centre|pitch)$"];
  nwr["tourism"~"^(attraction|museum|artwork|information)$"];
  nwr["historic"];
  way["building"]["name"];
);
out tags center geom;`);

  const inside = (coords) => contains(park.ring, coords);

  /** Vertices of a way or relation, however Overpass shaped the output. */
  const verticesOf = (e) => {
    if (e.geometry) return e.geometry.filter(Boolean).map((p) => [p.lon, p.lat]);
    if (e.members) return e.members.flatMap((m) => (m.geometry || []).filter(Boolean).map((p) => [p.lon, p.lat]));
    return [];
  };

  /** A representative point: the node itself, Overpass's centre, or the vertex mean. */
  const pointOf = (e) => {
    if (e.type === 'node') return [e.lon, e.lat];
    if (e.center) return [e.center.lon, e.center.lat];
    const vertices = verticesOf(e);
    if (!vertices.length) return null;
    return [vertices.reduce((s, p) => s + p[0], 0) / vertices.length, vertices.reduce((s, p) => s + p[1], 0) / vertices.length];
  };

  const features = { trees: [], benches: [], lamps: [], paths: [], water: [], structures: [], amenities: new Set() };

  for (const e of data.elements) {
    const t = e.tags || {};
    const at = pointOf(e);

    if (t.natural === 'tree' && at && inside(at)) {
      features.trees.push({ osmId: e.id, coordinates: roundCoords([at])[0], species: t.species || t['species:en'] || '', genus: t.genus || '', name: t.name || '' });
    } else if (t.amenity === 'bench' && at && inside(at)) {
      features.benches.push({ osmId: e.id, coordinates: roundCoords([at])[0], material: t.material || '', backrest: t.backrest || '' });
      features.amenities.add('Benches');
    } else if (t.highway === 'street_lamp' && at && inside(at)) {
      features.lamps.push({ osmId: e.id, coordinates: roundCoords([at])[0], lampType: t['lamp_type'] || t['light:method'] || '' });
    } else if (t.highway && e.type === 'way' && e.geometry) {
      const line = e.geometry.map((p) => [p.lon, p.lat]).filter(inside);
      if (line.length >= 2) {
        const length = line.slice(1).reduce((sum, p, i) => {
          const [lng1, lat1] = line[i];
          const dx = toRad(p[0] - lng1) * Math.cos(toRad((lat1 + p[1]) / 2));
          return sum + Math.hypot(dx, toRad(p[1] - lat1)) * EARTH_RADIUS_M;
        }, 0);
        features.paths.push({ osmId: e.id, name: t.name || '', surface: t.surface || '', lengthM: Math.round(length), coordinates: roundCoords(simplify(line, 0.00003)) });
        features.amenities.add('Walking paths');
      }
    } else if (t.natural === 'water' && at) {
      const vertices = verticesOf(e);
      const areaM2 = e.type === 'way' && vertices.length > 3 ? Math.round(ringArea([...vertices, vertices[0]])) : null;
      // A lake counts when it sits in the park or its shoreline runs through it.
      if (inside(at) || vertices.some(inside)) {
        features.water.push({ osmId: e.id, name: t.name || '', waterType: t.water || '', coordinates: roundCoords([at])[0], areaM2 });
        features.amenities.add('Lake or water body');
      }
    } else if (at && inside(at)) {
      const label =
        t.amenity === 'toilets' ? 'Public toilets'
        : t.amenity === 'drinking_water' ? 'Drinking water'
        : t.amenity === 'cafe' ? 'Café'
        : t.amenity === 'parking' ? 'Parking'
        : t.amenity === 'library' ? 'Library'
        : t.leisure === 'playground' ? "Children's play area"
        : t.leisure === 'fitness_station' ? 'Open-air gym'
        : t.leisure === 'pitch' || t.leisure === 'sports_centre' ? 'Sports facilities'
        : t.tourism === 'museum' ? 'Museum'
        : null;
      if (label) features.amenities.add(label);

      const structureName = t.name || (t.amenity === 'toilets' ? 'Public toilets' : t.amenity === 'shelter' ? 'Shelter' : '');
      if (structureName && (t.building || t.amenity || t.historic || t.tourism)) {
        features.structures.push({ osmId: e.id, name: structureName, kind: t.historic ? 'historic' : t.tourism || t.amenity || 'building', coordinates: roundCoords([at])[0] });
      }
    }
  }

  return { ...features, amenities: [...features.amenities].sort() };
}

// ---------------------------------------------------------------------------
// GBIF
// ---------------------------------------------------------------------------

const wktOf = (ring) => `POLYGON((${simplify(ring, 0.00015).map(([x, y]) => `${x} ${y}`).join(',')}))`;

const gbifQuery = (params) =>
  `${GBIF}/occurrence/search?${Object.entries(params)
    .flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : [[k, v]]))
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&')}`;

/** Months from WINDOW_START through the current month, as [year, month]. */
function monthsInWindow() {
  const months = [];
  const start = new Date(`${WINDOW_START}T00:00:00Z`);
  const now = new Date();
  for (let d = start; d <= now; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    months.push([d.getUTCFullYear(), d.getUTCMonth() + 1]);
  }
  return months;
}

/**
 * Record counts per species per month inside a park, via GBIF facets — exact
 * counts over every record, without paging through them.
 */
async function fetchParkOccurrences(park) {
  const wkt = wktOf(park.ring);
  const counts = []; // { speciesKey, year, month, records }

  await pool(monthsInWindow(), 4, async ([year, month]) => {
    const data = await request(gbifQuery({
      geometry: wkt,
      year,
      month,
      occurrenceStatus: 'PRESENT',
      hasGeospatialIssue: false,
      limit: 0,
      facet: 'speciesKey',
      facetLimit: 2000,
    }));
    for (const { name, count } of data.facets?.[0]?.counts || []) {
      counts.push({ speciesKey: Number(name), year, month, records: count });
    }
  });

  // A sample of real records gives each species a real coordinate inside the
  // park rather than the park centre.
  const locations = new Map();
  for (let offset = 0; offset < 1500; offset += 300) {
    const page = await request(gbifQuery({
      geometry: wkt,
      occurrenceStatus: 'PRESENT',
      hasGeospatialIssue: false,
      eventDate: `${WINDOW_START},${new Date().toISOString().slice(0, 10)}`,
      limit: 300,
      offset,
    }));
    for (const r of page.results) {
      if (r.speciesKey && Number.isFinite(r.decimalLongitude) && !locations.has(r.speciesKey)) {
        locations.set(r.speciesKey, [round6(r.decimalLongitude), round6(r.decimalLatitude)]);
      }
    }
    if (page.endOfRecords) break;
  }

  return { counts, locations };
}

function classify(taxon) {
  const { kingdom, class: cls, order, family } = taxon;
  if (cls === 'Aves') return 'bird';
  if (cls === 'Mammalia') return 'mammal';
  if (cls === 'Amphibia') return 'amphibian';
  if (['Reptilia', 'Squamata', 'Testudines', 'Crocodylia'].includes(cls)) return 'reptile';
  if (cls === 'Insecta') return order === 'Lepidoptera' && BUTTERFLY_FAMILIES.has(family) ? 'butterfly' : 'insect';
  if (kingdom === 'Plantae' && ['Magnoliopsida', 'Liliopsida', 'Pinopsida', 'Cycadopsida', 'Polypodiopsida', 'Gnetopsida'].includes(cls)) return 'plant';
  return null;
}

async function fetchSpecies(speciesKey) {
  const taxon = await request(`${GBIF}/species/${speciesKey}`);
  const speciesClass = classify(taxon);
  if (!speciesClass || taxon.rank !== 'SPECIES') return null;

  const [names, iucn, media] = await Promise.all([
    request(`${GBIF}/species/${speciesKey}/vernacularNames?limit=200`),
    request(`${GBIF}/species/${speciesKey}/iucnRedListCategory`).catch(() => null),
    request(gbifQuery({ speciesKey, mediaType: 'StillImage', license: IMAGE_LICENSES, country: 'IN', limit: 1 })),
  ]);

  const commonName = chooseCommonName(names.results || []);

  const record = media.results?.[0];
  const still = record?.media?.find((m) => m.type === 'StillImage' && m.identifier);

  return {
    gbifKey: speciesKey,
    scientificName: taxon.canonicalName || taxon.scientificName,
    commonName,
    class: speciesClass,
    order: taxon.order || '',
    family: taxon.family || '',
    iucnCode: iucn?.code || null,
    conservationStatus: IUCN[iucn?.code] || 'Not Evaluated',
    image: still
      ? {
          url: still.identifier,
          credit: still.rightsHolder || still.creator || record.recordedBy || 'Unknown',
          license: still.license || record.license || '',
          source: still.references || `https://www.gbif.org/occurrence/${record.key}`,
        }
      : null,
  };
}

/**
 * Read every file out of a ZIP archive held in memory. Only "stored" and
 * "deflate" entries are supported — which is all a Darwin Core archive uses —
 * so no unzip dependency is needed.
 *
 * @returns {Map<string, Buffer>}
 */
function unzip(buffer) {
  const zlib = require('zlib');
  const files = new Map();
  // The end-of-central-directory record sits in the last 64 KB.
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('not a ZIP archive');
  let offset = buffer.readUInt32LE(eocd + 16);
  const count = buffer.readUInt16LE(eocd + 10);

  for (let i = 0; i < count; i += 1) {
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeader = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);

    const dataStart = localHeader + 30 + buffer.readUInt16LE(localHeader + 26) + buffer.readUInt16LE(localHeader + 28);
    const data = buffer.subarray(dataStart, dataStart + compressedSize);
    files.set(name, method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data));

    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

/** Rows of a tab-separated Darwin Core file, keyed by header. */
function parseTsv(text) {
  const [header, ...lines] = text.split(/\r?\n/).filter(Boolean);
  const columns = header.split('\t');
  return lines.map((line) => Object.fromEntries(line.split('\t').map((v, i) => [columns[i], v])));
}

/** "Lantana camara L." → "lantana camara" — genus and epithet only. */
const binomial = (name) => String(name).trim().split(/\s+/).slice(0, 2).join(' ').toLowerCase();

/**
 * The GRIIS India checklist, read from its Darwin Core archive. The GBIF
 * species API exposes that a taxon is on the checklist but drops the
 * `isInvasive` flag, which only the archive carries.
 *
 * @returns {Promise<Map<string, {invasive: boolean}>>} binomial → status
 */
async function fetchGriisIndia() {
  const endpoints = await request(`${GBIF}/dataset/${GRIIS_INDIA}/endpoint`);
  const archive = endpoints.find((e) => e.type === 'DWC_ARCHIVE');
  if (!archive) throw new Error('GRIIS India has no Darwin Core archive endpoint');

  const res = await fetch(archive.url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`GRIIS archive responded ${res.status}`);
  const files = unzip(Buffer.from(await res.arrayBuffer()));

  const invasiveIds = new Set(
    parseTsv(files.get('speciesprofile.txt').toString('utf8')).filter((r) => r.isInvasive === 'Invasive').map((r) => r.id)
  );
  const entries = new Map();
  for (const taxon of parseTsv(files.get('taxon.txt').toString('utf8'))) {
    if (taxon.taxonRank !== 'SPECIES') continue;
    entries.set(binomial(taxon.scientificName), { invasive: invasiveIds.has(taxon.id) });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const fetchedAt = new Date().toISOString();

  console.log('OpenStreetMap: park boundaries and mapped features');
  const parks = [];
  for (const config of PARKS) {
    const { tags, ring } = await fetchParkGeometry(config);
    const park = { ...config, ring };
    const features = await fetchParkFeatures(park);
    await sleep(2000);

    const [lng, lat] = centroidOf(ring);
    parks.push({
      slug: config.slug,
      name: tags['name:en'] || tags.name,
      osm: `${config.osm.type}/${config.osm.id}`,
      wikidata: tags.wikidata || null,
      description: config.description,
      establishedYear: config.establishedYear,
      manager: config.manager,
      openingHours: tags.opening_hours || '',
      website: tags.website || '',
      location: [round6(lng), round6(lat)],
      boundary: ring,
      areaAcres: Math.round((ringArea(ring) / 4046.8564224) * 10) / 10,
      facilities: features.amenities,
      features,
    });
    console.log(
      `  ${tags.name}: ${parks.at(-1).areaAcres} acres, ${features.trees.length} trees, ${features.benches.length} benches, ` +
        `${features.lamps.length} lamps, ${features.paths.length} paths, ${features.water.length} water, ${features.structures.length} structures`
    );
  }

  console.log('\nGBIF: species recorded inside each boundary since', WINDOW_START);
  const perPark = [];
  for (const park of parks) {
    const occurrences = await fetchParkOccurrences({ ring: park.boundary });
    perPark.push({ park, ...occurrences });
    const species = new Set(occurrences.counts.map((c) => c.speciesKey));
    console.log(`  ${park.name}: ${occurrences.counts.reduce((s, c) => s + c.records, 0)} records, ${species.size} species`);
  }

  const speciesKeys = [...new Set(perPark.flatMap((p) => p.counts.map((c) => c.speciesKey)))];
  console.log(`\nGBIF: taxonomy, names, IUCN status and photos for ${speciesKeys.length} species`);
  const described = (await pool(speciesKeys, 6, (key) => fetchSpecies(key).catch((err) => {
    console.warn(`    species ${key} skipped: ${err.message}`);
    return null;
  }))).filter(Boolean);

  console.log('\nGRIIS India: introduced and invasive species');
  const griis = await fetchGriisIndia();
  const introduced = described.filter((s) => griis.has(binomial(s.scientificName)));
  for (const s of introduced) {
    s.isIntroduced = true;
    s.isInvasive = griis.get(binomial(s.scientificName)).invasive;
  }
  console.log(`  ${griis.size} checklist species; ${introduced.length} recorded in the parks, ${introduced.filter((s) => s.isInvasive).length} flagged invasive`);

  const bySpecies = new Map(described.map((s) => [s.gbifKey, s]));
  const observations = [];
  for (const { park, counts, locations } of perPark) {
    for (const c of counts) {
      if (!bySpecies.has(c.speciesKey)) continue;
      observations.push({
        park: park.slug,
        gbifKey: c.speciesKey,
        month: `${c.year}-${String(c.month).padStart(2, '0')}`,
        records: c.records,
        coordinates: locations.get(c.speciesKey) || null,
      });
    }
  }

  // Seasonality: the calendar months in which a species was recorded anywhere.
  for (const s of described) {
    const months = new Set(observations.filter((o) => o.gbifKey === s.gbifKey).map((o) => Number(o.month.slice(5))));
    s.seasonality = [...months].sort((a, b) => a - b);
    s.records = observations.filter((o) => o.gbifKey === s.gbifKey).reduce((sum, o) => sum + o.records, 0);
    s.isIntroduced ||= false;
    s.isInvasive ||= false;
  }

  const meta = {
    fetchedAt,
    window: { from: WINDOW_START, to: fetchedAt.slice(0, 10) },
    parks: parks.length,
    species: described.length,
    observationRows: observations.length,
    gbifRecords: observations.reduce((sum, o) => sum + o.records, 0),
  };

  const write = (name, data) => fs.writeFile(path.join(OUT_DIR, name), `${JSON.stringify(data)}\n`);
  await write('parks.json', parks);
  await write('species.json', described.sort((a, b) => b.records - a.records));
  await write('observations.json', observations);
  await fs.writeFile(path.join(OUT_DIR, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);

  console.log(`\nWrote ${path.relative(process.cwd(), OUT_DIR)}:`, meta);
}

main().catch((err) => {
  console.error(`\nOpen-data refresh failed: ${err.stack || err.message}`);
  process.exit(1);
});

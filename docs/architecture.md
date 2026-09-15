# System Architecture

---

## 1. Overview

Three tiers, deployed as two independently runnable applications, fed by a
committed open-data snapshot and a small set of live public APIs.

```
┌───────────────────────────────────────────────────────────────┐
│  PRESENTATION            frontend/  ·  Next.js 13 · TypeScript │
│                                                                 │
│  16 page routes · TanStack Query cache · Leaflet · Recharts    │
│  Role-gated navigation · Zod-validated forms · provenance tags │
└───────────────────────────────┬───────────────────────────────┘
                                │  REST/JSON over HTTP
                                │  Bearer JWT
┌───────────────────────────────▼───────────────────────────────┐
│  APPLICATION             backend/  ·  Node.js · Express        │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ Routes    18 routers under /api                          │ │
│  │ Middleware  auth → validate → handler → error            │ │
│  │ Controllers CRUD factory + module-specific handlers      │ │
│  │ Services  ← the domain logic lives here                  │ │
│  │   aqi · biodiversity · ecosystem-score · anomaly         │ │
│  │   priority · vision · ai-inference · assistant · sensor  │ │
│  │   report · alert · audit · external                      │ │
│  │ Background  sensor refresh · overdue sweep · model warm-up│ │
│  └──────────────────────────────────────────────────────────┘ │
└──────────┬──────────────────────┬─────────────────┬───────────┘
           │ Mongoose             │ TensorFlow.js   │ HTTPS, cached
┌──────────▼──────────────┐ ┌─────▼─────────────┐ ┌─▼──────────────────────┐
│  DATA                    │ │  VISION MODEL      │ │  EXTERNAL APIs         │
│  MongoDB · 18 collections│ │  MobileNetV2 1.0   │ │  Open-Meteo (weather,  │
│  GeoJSON + 2dsphere      │ │  224 (ImageNet)    │ │  CAMS air quality)     │
│  seeded from open-data   │ │  WASM backend      │ │  GBIF · Nominatim      │
│  snapshot                │ │  .cache/mobilenet-v2│ │  (eBird, OWM optional) │
└──────────────────────────┘ └────────────────────┘ └────────────────────────┘
```

**Why the services layer matters.** Controllers translate HTTP; services own the
domain. `computeEcosystemHealth()` is called by the dashboard, park, analytics
and report code, by the assistant, and — through `refreshAllParkScores()` — by
the admin recompute action, the seeder and every sensor refresh. One
implementation, many callers, no chance of the number disagreeing with itself.

---

## 2. Request lifecycle

```
POST /api/incidents
  │
  ├─ helmet, compression, cors, rate limiter (/api: 2000 req/min, 300 in production)
  ├─ express.json (8 MB — AI data-URL uploads)
  ├─ requireAuth        verify JWT → load user → reject if deactivated → req.user
  ├─ requireRole        officer or above, else 403
  ├─ validate           Zod parses body; 422 with per-field detail on failure
  ├─ controller         beforeCreate (reference code from the Counter collection,
  │                     opening timeline entry) → model.create → afterCreate
  │    └─ services      priority.scoreIncident() → alert.raise() if high/critical
  ├─ audit.record       append-only entry with the changed fields
  └─ response           { success: true, data, meta? }
```

Failures anywhere land in one error middleware that normalises `ApiError`,
Mongoose validation errors (422), cast errors (400), duplicate keys (409), JWT
errors (401), unparseable JSON (400) and oversized bodies (413) into a single
failure envelope. Anything else is treated as a bug and collapsed to a generic
500; the internal message is attached as `debug` only outside production.

---

## 3. Database schema

18 collections. `→` denotes a reference.

```
Park ─────────────┬──→ referenced by nearly everything
                  │    OSM boundary (Polygon), areaAcres, facilities, source, cached scores
  Asset ──────────┤    type, condition 0–100, GeoJSON Point (+ LineString for paths),
                  │    source {provider:'OpenStreetMap', id}, demo
  Sensor ─────────┤    source: open-meteo | simulated | device, thresholds, cached currentValue
    └─ SensorReading   time series · value · source · isAnomaly · zScore
  Observation ────┤    → Species · count · source (gbif | officer-survey | citizen-report | …) · verified
  Incident ───────┤    priorityScore · upvotes · timeline[] · → assignedTo (User) · demo
  WorkOrder ──────┤    → Asset · → Incident · progress · demo
  CitizenReport ──┤    → Incident (when accepted) · → Species (sightings) · upvotedBy[] · demo
  AiDetection ────┤    probabilities[] · imagenet[] · evidence · → AiImage · → Incident (fire only)
  Alert ──────────┤    dedupeKey · occurrences · demo
  EcoReport ──────┘    frozen metric snapshot · findings · recommendations · draft/published

Species              catalogue only — abundance is derived from Observation; gbifKey,
                     IUCN category, isInvasive / isIntroduced (GRIIS India), image credit
AiImage              ≤640 px JPEG bytes, unique sha256, credit
User                 bcrypt hash, role, contributions, demo
AuditLog             append-only
Setting              singleton — index weights, anomaly threshold, AI confidence floor, switches
ChatMessage          assistant history with citations
Counter              { _id: prefix, seq } — atomic reference-code sequences
```

### 3.1 Design decisions

**Assets share one collection.** Trees, benches, lakes, paths, lights and
structures live together with type-specific fields in a free-form `attributes`
map, rather than in near-identical collections. Inventory queries, the asset
table and the map layer then stay generic — no branching on type.

**Species carries no population count.** Abundance is aggregated from
`Observation` on every read. A stored count would drift out of date, and the
diversity indices would then be computing over fiction.

**Sensor readings are their own collection.** The highest-volume collection is
deliberately narrow — sensor, timestamp, value, source, anomaly verdict — with a
compound index on `(sensor, recordedAt)` serving both the chart query and the
rolling statistics the detector needs.

**Maintenance history is embedded in Asset.** Records are always read with their
asset, are append-only, and are bounded in practice.

**Images are stored once, by content hash.** An analysed photo is re-encoded as
a JPEG no larger than 640 px on its longest side and written to `AiImage` keyed
by the SHA-256 of those bytes. Detections, and any incident opened from one,
reference `/api/ai/images/:id` instead of embedding a data URL or depending on a
third-party URL that can disappear.

**Reference codes come from a counter, not a count.** `utils/sequence.js`
(`nextCode`) increments a `Counter` document atomically with `$inc`. The first
call for a prefix seeds the counter from the highest code already stored. A
deleted incident therefore never causes the next `INC-YYYY-NNNN` to repeat an
existing one — which `countDocuments() + 1` would.

**Missing is `null`, never 0.** A park with no reporting water sensor has
`waterQuality: null`; a park with no tree assets has `treeHealth: null`; the EHI
is `null` when no indicator has data; a day without readings is a gap in the
trend series. A zero would read as "catastrophic" rather than "not measured".

**The GIS module has no collection.** Every map layer is a projection of data
another module owns. A tree pin *is* the asset register's record of that tree, a
pollution circle *is* an open incident. The map therefore cannot go stale
relative to the modules it draws.

### 3.2 Geospatial storage

All geometry is GeoJSON with `2dsphere` indexes:

```js
location: { type: 'Point', coordinates: [longitude, latitude] }
```

This enables `$near` — the "what is within 1 km of me" query behind
`/gis/within` and `/parks/near` — and hands Leaflet a payload it consumes almost
directly. Park boundaries are the real OpenStreetMap polygons.

> **The one real hazard.** GeoJSON is `[lng, lat]`; Leaflet is `[lat, lng]`.
> Getting it backwards puts a Bengaluru park in the Indian Ocean, and the mistake
> is invisible until the map renders. Conversion happens **only** through
> `frontend/lib/api/geo.ts`, never inline in a component. The API also rejects
> `[0, 0]`, which in practice only means a form was submitted without a location.

---

## 4. Data provenance

Every record is either real open data, a real live observation, a computation
over those, or a demonstration record that says so.

| Data | Source | How it enters the database |
|---|---|---|
| 6 Bengaluru parks: boundary, area, facilities, opening hours | OpenStreetMap (Overpass API) | Committed snapshot `parks.json` |
| Assets: trees, benches, street lamps, paths, water bodies, structures | OpenStreetMap features inside each boundary | Snapshot; seeder caps per park (60 trees, 25 benches, 20 lamps, 12 paths, 10 water bodies, 12 structures). **Condition scores and maintenance history are demo values** (`demo: true`) |
| Species: taxonomy, English name, IUCN category, photo | GBIF species API | Snapshot `species.json` (587 species) |
| Introduced / invasive flags | GRIIS India checklist, Darwin Core archive | Joined into `species.json` |
| Observations | GBIF occurrence records inside each park boundary since 2023-01-01, one row per species × park × month, `count` = number of records | Snapshot `observations.json` (4 175 rows, 37 182 records), `source: 'gbif'`, `verified: true` |
| AQI, temperature, humidity | Open-Meteo forecast model and CAMS air quality for each park's coordinates | Live, `Sensor.source = 'open-meteo'`; seed backfills 48 h of real hourly history |
| Noise, soil moisture, water quality | Generated | `Sensor.source = 'simulated'` |
| AI detections | Real MobileNetV2 inference over 13 openly licensed Wikimedia Commons photos | Seeded without a park, so none opens an incident |
| Users, citizen reports, incidents, work orders, alerts derived from them | Seeder (mulberry32-seeded) | `demo: true` |
| Ecological reports | `report.service` over all of the above | Generated, then published by the seeder |

The snapshot (`backend/src/seed/data/open-data/`, with `meta.json` and
`ATTRIBUTION.md`) is rebuilt by `npm run data:refresh`
(`scripts/fetch-open-data.js`), so seeding works offline and reproducibly. The
frontend's `components/shared/data-source.tsx` renders the matching provenance
badge (Live · Open-Meteo, Simulated, GBIF records, OSM, Demo, Model) wherever a
value is shown.

### 4.1 The open-data pipeline (`npm run data:refresh`)

```
For each park (OSM way/relation id configured in the script):
  1. Overpass: boundary geometry → closed CCW ring (relations stitched from outer ways)
     area = spherical-excess ring area / 4046.856 m² per acre
  2. Overpass: bbox query for trees, benches, lamps, footpaths, water, amenities,
     historic/tourism features, named buildings → keep only points inside the ring
     (ray casting); facilities list derived from amenity tags
  3. GBIF occurrence search per calendar month since 2023-01-01, geometry = the
     ring simplified with Ramer–Douglas–Peucker, occurrenceStatus=PRESENT,
     no geospatial issue, faceted by speciesKey → exact record counts per month
  4. Up to 1 500 sampled records give each species a real coordinate in the park
Then, for every species key:
  5. GBIF species: keep rank SPECIES in birds, mammals, reptiles, amphibians,
     insects (butterflies split out by family) and vascular plants
  6. English vernacular name chosen by source agreement and trusted checklists;
     IUCN code mapped to a category — "Not Evaluated" kept distinct from
     "Least Concern"; one CC0 / CC BY / CC BY-NC photo recorded in India
  7. GRIIS India archive (downloaded and unzipped in-process) → isIntroduced,
     isInvasive by binomial name match
```

Requests are retried with exponential back-off, Overpass mirrors are tried in
turn, and successful responses are cached on disk for 24 h so an interrupted run
resumes.

---

## 5. Vision pipeline (Module 5)

```
POST /api/ai/analyze  { task, imageUrl: https://… | data:image/…;base64,… }
  │
  ├─ requireAuth, per-user rate limit (20 analyses / minute)
  ├─ vision.loadImageBytes
  │    URL  → DNS lookup; reject loopback, private, link-local, CGNAT, multicast;
  │           manual redirects (≤3), each hop re-validated; 15 s timeout; ≤8 MB
  │    data → base64 decode; ≤8 MB
  ├─ decode by magic number (JPEG or PNG only; ≥16×16)
  ├─ describePixels   vegetation indices, HSV foliage bands, flame & smoke chromaticity
  ├─ MobileNetV2      bilinear resize to 224×224, /255, 1001 logits → softmax → drop "background"
  ├─ ai-inference.interpret(task)   pool ImageNet class groups + pixel stats → task probabilities
  ├─ storeImage       ≤640 px JPEG, deduplicated by SHA-256 → AiImage
  ├─ recordDetection  AiDetection with probabilities, top-5 ImageNet classes, evidence, notes
  └─ escalation rule  incident only for a fire/smoke finding ≥ confidence floor with a park
```

The model is the Google MobileNetV2 1.0 / 224 ImageNet classification checkpoint
from TensorFlow Hub, run by TensorFlow.js on its WebAssembly backend (~30–80 ms
per image on a laptop CPU; falls back to the pure-JavaScript CPU backend if WASM
cannot initialise). It is downloaded once (~14 MB) into
`backend/.cache/mobilenet-v2/` and loaded from disk thereafter; `warmUp()` loads
it in the background at boot, and `npm run model:download` does it at build
time. If it cannot be loaded, `/ai/analyze` returns 503.

The task mapping and its measured accuracy are documented in
[algorithms.md §6](algorithms.md#6-ai-inference).

---

## 6. Authorisation

A strict hierarchy, enforced server-side in `middleware/auth.js`:

```
  citizen (1)  →  ecologist (2)  →  officer (3)  →  admin (4)
```

`requireRole('officer')` admits officers *and* admins, so routes need not
enumerate every superior role.

| Capability | Minimum role |
|---|---|
| Browse dashboard, map, parks, assets, biodiversity, sensors, alerts, maintenance, citizen reports, published reports, analytics aggregates | *(public)* |
| Submit reports, upvote, log sightings, run AI image analysis, read own reports and upvotes | citizen (any signed-in account) |
| Verify, edit and delete observations, curate species, review AI detections, generate and edit reports, see draft reports | ecologist |
| Incidents (including reading them), work orders, asset writes, sensor edits and refresh, citizen-report review, row-level CSV/JSON export, staff directory | officer |
| Users, settings, other deletions, sensor and park creation, reseed, cache clear | admin |

The frontend hides what a role cannot use (`RequireRole` in
`components/providers/auth-provider.tsx`), but that is a courtesy — the API
enforces the same rule independently.

**Public self-registration always creates a citizen.** The role is never read
from the request body, so a caller cannot promote themselves by adding
`role: "admin"` to the signup payload. A token is re-checked against the stored
user on every request, so a deactivated account stops working immediately and a
tampered role claim in the payload grants nothing.

---

## 7. Frontend architecture

```
frontend/
├── app/
│   ├── (app)/          13 module pages inside the dashboard shell
│   │                   dashboard · map · assets · biodiversity · ai · sensors · citizen
│   │                   incidents · maintenance · analytics · assistant · admin · settings
│   ├── (auth)/         login, register
│   ├── page.tsx        landing route
│   └── layout.tsx      Theme → Query → Auth providers
├── components/
│   ├── layout/         dashboard shell, sidebar (role-gated), navbar
│   ├── map/            Leaflet map, layer config, layer toggle
│   ├── shared/         QueryState, ParkFilter, ConditionsPanel, DataSource (provenance),
│   │                   KpiCard, HealthGauge, DataTable, ScoreBadge …
│   ├── providers/      auth (incl. RequireRole), query, theme
│   └── ui/             shadcn/ui primitives
└── lib/
    ├── api/
    │   ├── client.ts     fetch wrapper, envelope unwrapping, token store
    │   ├── endpoints.ts  every API call, one place
    │   └── geo.ts        GeoJSON ↔ Leaflet conversion
    ├── hooks/use-api.ts  TanStack hooks + query-key factory + mutations
    └── types.ts          mirrors the API's response shapes
```

### 7.1 Data flow

```
component → hook (use-api.ts) → endpoint (endpoints.ts) → client.ts → API
                ↑                                                      │
                └──────────── TanStack Query cache ────────────────────┘
```

Components never build URLs and never call `fetch`. A route change is a one-line
edit in `endpoints.ts`.

### 7.2 Query keys and invalidation

Keys come from one `qk` factory. Because every key starts with its module name,
`invalidateQueries({ queryKey: qk.incidents.all })` clears list, detail, triage
*and* stats in one call — invalidation cannot miss an entry because a key was
spelled differently in two files.

Mutations declare what they invalidate. Verifying an observation, for example,
invalidates biodiversity, dashboard and analytics, because verification is what
admits a record into the indices and therefore moves every score derived from
them.

### 7.3 Three states, once

`QueryState` renders loading, error and empty so page bodies only ever handle
the success case. A network-level failure (status 0) gets its own message
telling the reader to start the backend — overwhelmingly the most common problem
in development.

---

## 8. External integrations

| Service | Key? | Purpose | Cache TTL |
|---|---|---|---|
| Open-Meteo Forecast | No | Current weather, 7-day outlook, hourly history for virtual sensors | 10 min |
| Open-Meteo Air Quality (CAMS) | No | Hourly pollutant concentrations → CPCB AQI computed here | 15 min |
| GBIF | No | Occurrence plausibility check, backbone taxonomy (live); snapshot build | 24 h |
| Nominatim | No | Reverse geocoding | 7 days |
| TensorFlow Hub | No | MobileNetV2 checkpoint, downloaded once | disk cache |
| OpenWeatherMap | Yes | Alternative weather (`?source=openweathermap`) | none |
| eBird | Yes | Recent bird records | 30 min |

**Why proxy through the server** rather than calling from the browser:

- keys stay server-side, never in a bundle;
- one shared cache serves every visitor instead of one per browser — which is
  what keeps the project inside Nominatim's and eBird's rate limits;
- responses are reshaped into the project's vocabulary, so changing provider
  does not ripple into the frontend;
- air-quality concentrations are scored through the project's own CPCB code,
  with the CPCB averaging periods, before they leave the server.

**Failure is expected, not exceptional.** Every call has an 8-second timeout and
returns `{ ok: false, reason }` rather than throwing. An Open-Meteo response too
thin to average is reported as `ok: false`, never as "AQI 0 — Good". When
upstream is unreachable the virtual sensors ingest **nothing** — they go stale
and, after 3 hours without data, offline — rather than being filled with
invented values.

---

## 9. Background jobs

Started by `server.js` after the database connects:

| Job | Interval | What it does |
|---|---|---|
| Sensor refresh (`startSensorRefresh`) | `SENSOR_SIMULATION_INTERVAL_MS`, default 60 s (0 disables) | Open-Meteo sensors ingest only when the upstream observation time has advanced; simulated sensors emit one reading each if simulation is enabled; park scores are recomputed when anything was ingested |
| Overdue sweep (`markOverdueOrders`) | every 10 min, and before every work-order list, calendar and stats read | `scheduled` orders whose date has passed become `overdue` |
| Vision warm-up | once at boot | loads the model in the background; a failure is logged and retried on the first request |

With `AUTO_SEED=true` an empty database (no parks) is seeded on boot; the
in-memory development database is therefore seeded on every start.

---

## 10. Deployment shape

```
frontend  →  Netlify / Vercel         (netlify.toml builds from frontend/)
backend   →  Render (render.yaml)     (Node 20; build runs npm run model:download)
database  →  MongoDB Atlas
```

Set `NEXT_PUBLIC_API_URL` on the frontend (baked in at build time) and
`MONGODB_URI`, `JWT_SECRET`, `CORS_ORIGIN` on the backend.

**Production guards.** With `NODE_ENV=production` the server refuses to start
unless `JWT_SECRET` is set, is not the development default and is at least 32
characters; `MONGODB_URI` is set (the in-memory database is development-only);
and `CORS_ORIGIN` is set. `POST /admin/reseed` is refused in production.

For a local review none of this is needed: a blank `MONGODB_URI` boots an
in-memory MongoDB and seeds it from the committed snapshot.

---

## 11. Known limitations

Stated plainly, and documented at the point in the code where each matters:

| Limitation | Where |
|---|---|
| No physical sensors. AQI/temperature/humidity are model values for the park's coordinates (coarse CAMS/forecast grid — nearby parks can share a cell); noise, soil and water are simulated | `sensor.service.js`, `external.service.js` |
| General ImageNet network, not trained on park categories: species at ImageNet granularity, litter detection 0/3 on the evaluation photos, foliage health is a colour measurement | `ai-inference.service.js`, `scripts/evaluate-vision.js` |
| Vision constants were calibrated on the same 22 photos the evaluation reports, so the accuracy is optimistic | `ai-inference.service.js` header |
| GBIF `count` is a number of occurrence records, not individuals; effort is dominated by eBird/iNaturalist activity and differs hugely between parks | `fetch-open-data.js`, `biodiversity.service.js` |
| Pooled diversity index mixes survey effort across taxa | `biodiversity.service.js` |
| Asset condition, users, reports, incidents and work orders are demonstration records | `seed/seed.js` (`demo: true`) |
| Assistant retrieves genuinely, generates from templates | `assistant.service.js` |
| JWT in `localStorage`; production should use httpOnly cookies | `lib/api/client.ts` |
| In-memory API cache and rate limiters — single process only | `external.service.js`, `app.js`, `ai.routes.js` |

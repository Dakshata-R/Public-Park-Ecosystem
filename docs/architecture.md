# System Architecture

---

## 1. Overview

Three tiers, deployed as two independently runnable applications.

```
┌───────────────────────────────────────────────────────────────┐
│  PRESENTATION            frontend/  ·  Next.js 13 · TypeScript │
│                                                                 │
│  17 routes · TanStack Query cache · Leaflet · Recharts         │
│  Role-gated navigation · Zod-validated forms                    │
└───────────────────────────────┬───────────────────────────────┘
                                │  REST/JSON over HTTP
                                │  Bearer JWT
┌───────────────────────────────▼───────────────────────────────┐
│  APPLICATION             backend/  ·  Node.js · Express        │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ Routes    15 routers, one per module                     │ │
│  │ Middleware  auth → validate → handler → error            │ │
│  │ Controllers CRUD factory + module-specific handlers      │ │
│  │ Services  ← the domain logic lives here                  │ │
│  │   aqi · biodiversity · ecosystem-score · anomaly         │ │
│  │   priority · ai-inference · assistant · sensor           │ │
│  │   alert · audit · external                               │ │
│  └──────────────────────────────────────────────────────────┘ │
└──────────┬────────────────────────────────────┬───────────────┘
           │ Mongoose                           │ HTTPS, cached
┌──────────▼──────────────┐        ┌────────────▼───────────────┐
│  DATA                    │        │  EXTERNAL APIs             │
│  MongoDB · 16 collections│        │  Open-Meteo (weather, air) │
│  GeoJSON + 2dsphere      │        │  GBIF · Nominatim          │
└──────────────────────────┘        └────────────────────────────┘
```

**Why the services layer matters.** Controllers translate HTTP; services own the
domain. `computeEcosystemHealth()` is called by the dashboard controller, the
park controller, the analytics controller, the assistant and the admin recompute
action — one implementation, five callers, no chance of the number disagreeing
with itself.

---

## 2. Request lifecycle

```
POST /api/incidents
  │
  ├─ helmet, cors, compression, rate limiter
  ├─ express.json (8 MB — AI data-URL uploads)
  ├─ requireAuth        verify JWT → load user → attach req.user
  ├─ requireRole        officer or above, else 403
  ├─ validate           Zod parses body; 422 with per-field detail on failure
  ├─ controller         beforeCreate hook → model.create → afterCreate hook
  │    └─ services      priority.scoreIncident() → alert.raise()
  ├─ audit.record       append-only entry with the changed fields
  └─ response           { success: true, data, meta? }
```

Failures anywhere land in one error middleware that normalises `ApiError`,
Mongoose validation errors, cast errors, duplicate keys and JWT errors into a
single failure envelope. Anything else is treated as a bug and collapsed to a
generic 500 — internal messages never leak in production.

---

## 3. Database schema

16 collections. `→` denotes a reference.

```
Park ─────────────┬──→ referenced by nearly everything
                  │
  Asset ──────────┤    type, condition 0–100, GeoJSON Point (+ LineString for trails)
  Sensor ─────────┤    calibration, thresholds, cached currentValue
    └─ SensorReading   time series · value · isAnomaly · zScore
  Observation ────┤    → Species · count · verified
  Incident ───────┤    priorityScore · timeline[] · → assignedTo (User)
  WorkOrder ──────┤    → Asset · → Incident · progress
  CitizenReport ──┤    → Incident (when accepted) · → Species (sightings)
  AiDetection ────┤    probabilities[] · → Incident (when escalated)
  Alert ──────────┤    dedupeKey · occurrences
  EcoReport ──────┘    frozen metric snapshot

Species              catalogue only — abundance is derived from Observation
User                 bcrypt hash, role, contributions
AuditLog             append-only
Setting              singleton — index weights, thresholds
ChatMessage          assistant history with citations
```

### 3.1 Design decisions

**Assets share one collection.** Trees, benches, lakes and lights live together
with type-specific fields in a free-form `attributes` map, rather than in six
near-identical collections. Inventory queries, the asset table and the map layer
then stay generic — no branching on type.

**Species carries no population count.** Abundance is aggregated from
`Observation` on every read. A stored count would drift out of date the moment
someone forgot to update it, and the diversity indices would then be computing
over fiction.

**Sensor readings are their own collection.** The highest-volume collection is
deliberately narrow — sensor, timestamp, value, anomaly verdict — with a compound
index on `(sensor, recordedAt)` serving both the chart query and the rolling
statistics the detector needs.

**Maintenance history is embedded in Asset.** Records are always read with their
asset, are append-only, and are bounded in practice.

**The GIS module has no collection.** Every map layer is a projection of data
another module owns. A tree pin *is* the asset register's record of that tree, a
pollution circle *is* an open incident. The map therefore cannot go stale
relative to the modules it draws.

### 3.2 Geospatial storage

All geometry is GeoJSON with `2dsphere` indexes:

```js
location: { type: 'Point', coordinates: [longitude, latitude] }
```

This enables `$near` and `$geoWithin` — the "what is within 500 m of me" query
the citizen portal makes — and hands Leaflet a payload it consumes almost
directly.

> **The one real hazard.** GeoJSON is `[lng, lat]`; Leaflet is `[lat, lng]`.
> Getting it backwards puts a Bengaluru park in the Indian Ocean, and the mistake
> is invisible until the map renders. Conversion happens **only** through
> `frontend/lib/api/geo.ts`, never inline in a component.

---

## 4. Authorisation

A strict hierarchy, enforced server-side in `middleware/auth.js`:

```
  citizen (1)  →  ecologist (2)  →  officer (3)  →  admin (4)
```

`requireRole('officer')` admits officers *and* admins, so routes need not
enumerate every superior role.

| Capability | Minimum role |
|---|---|
| Browse dashboard, map, biodiversity, sensors | *(public)* |
| Submit reports, log sightings | citizen |
| Verify observations, curate species, review AI | ecologist |
| Incidents, work orders, assets, sensor writes | officer |
| Users, settings, deletions, reseed | admin |

The frontend hides what a role cannot use, but that is a courtesy — the API
enforces the same rule independently. `RequireRole` in the UI and
`requireRole()` on the server are two expressions of one policy.

**Public self-registration always creates a citizen.** The role is never read
from the request body, so a caller cannot promote themselves by adding
`role: "admin"` to the signup payload.

---

## 5. Frontend architecture

```
frontend/
├── app/
│   ├── (app)/          12 module pages inside the dashboard shell
│   ├── (auth)/         login, register — split-panel layout
│   └── layout.tsx      Theme → Query → Auth providers
├── components/
│   ├── layout/         shell, sidebar (role-gated), navbar (live alerts, search)
│   ├── map/            Leaflet map + layer config
│   ├── shared/         QueryState, ParkFilter, ScoreBar, ConditionsPanel …
│   ├── providers/      auth, query, theme
│   └── ui/             shadcn/ui primitives
└── lib/
    ├── api/
    │   ├── client.ts   fetch wrapper, envelope unwrapping, token store
    │   ├── endpoints.ts  every API call, one place
    │   └── geo.ts      GeoJSON ↔ Leaflet conversion
    ├── hooks/use-api.ts  TanStack hooks + query-key factory + mutations
    └── types.ts        mirrors the API's response shapes
```

### 5.1 Data flow

```
component → hook (use-api.ts) → endpoint (endpoints.ts) → client.ts → API
                ↑                                                      │
                └──────────── TanStack Query cache ────────────────────┘
```

Components never build URLs and never call `fetch`. A route change is a one-line
edit in `endpoints.ts`.

### 5.2 Query keys and invalidation

Keys come from one `qk` factory. Because every key starts with its module name,
`invalidateQueries({ queryKey: qk.incidents.all })` clears list, detail, triage
*and* stats in one call — invalidation cannot miss an entry because a key was
spelled differently in two files.

Mutations declare what they invalidate. Verifying an observation, for example,
invalidates biodiversity, dashboard and analytics, because verification is what
admits a record into the indices and therefore moves every score derived from
them.

### 5.3 Three states, once

`QueryState` renders loading, error and empty so page bodies only ever handle
the success case. A network-level failure (status 0) gets its own message
telling the reader to start the backend — overwhelmingly the most common problem
in development, and a generic "something went wrong" helps nobody.

---

## 6. External integrations

| Service | Key? | Purpose | Cache TTL |
|---|---|---|---|
| Open-Meteo Forecast | No | Weather + 7-day outlook | 10 min |
| Open-Meteo Air Quality | No | Pollutant concentrations → CPCB AQI | 15 min |
| GBIF | No | Occurrence records, taxonomy | 24 h |
| Nominatim | No | Reverse geocoding | 7 days |
| OpenWeatherMap | Yes | Alternative weather | 10 min |
| eBird | Yes | Recent bird records | 30 min |

**Why proxy through the server** rather than calling from the browser:

- Keys stay server-side, never in a bundle;
- one shared cache serves every visitor instead of one per browser — which is
  what keeps the project inside Nominatim's and eBird's rate limits;
- responses are reshaped into the project's vocabulary, so changing provider
  does not ripple into the frontend;
- air-quality concentrations are scored through the project's own CPCB code
  before they leave the server.

**Failure is expected, not exceptional.** Every call has an 8-second timeout and
returns `{ ok: false, reason }` rather than throwing. Every caller has a local
fallback. Nothing in the system stops working because an upstream is down.

---

## 7. Deployment shape

```
frontend  →  Vercel / Netlify        (static + client rendering)
backend   →  Render / Railway / VM   (Node process)
database  →  MongoDB Atlas
```

Set `NEXT_PUBLIC_API_URL` on the frontend and `MONGODB_URI`, `JWT_SECRET`,
`CORS_ORIGIN` on the backend.

For the review, neither is needed: the backend boots an in-memory MongoDB and
seeds it on first run.

---

## 8. Known limitations

Stated plainly, and documented at the point in the code where each matters:

| Limitation | Where |
|---|---|
| No physical sensors — ingestion path is real, readings are generated | `sensor.service.js` |
| No trained vision models — contract is real, weights are a surrogate | `ai-inference.service.js` |
| Assistant retrieves genuinely, generates from templates | `assistant.service.js` |
| JWT in `localStorage`; production should use httpOnly cookies | `lib/api/client.ts` |
| Pooled diversity index mixes survey effort across taxa | `biodiversity.service.js` |
| In-memory cache and rate limiter — single process only | `external.service.js`, `app.js` |

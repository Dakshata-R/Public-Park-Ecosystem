# API Reference

Base URL: `http://localhost:5000/api`

---

## Conventions

**Every response uses one envelope.**

```jsonc
// success
{ "success": true, "data": { ... }, "meta": { ... } }   // meta on lists only

// failure
{ "success": false, "error": { "message": "…", "details": { "field": "…" } } }
```

**Authentication.** `Authorization: Bearer <jwt>` — obtained from
`POST /auth/login`.

**Roles** form a hierarchy: `citizen (1) → ecologist (2) → officer (3) → admin (4)`.
A route marked *officer* also admits admins. Routes marked *public* need no token.

**List parameters**, accepted by every collection endpoint:

| Parameter | Meaning |
|---|---|
| `page` | 1-based page number (default 1) |
| `limit` | Rows per page (default 20, max 200) |
| `sort` | e.g. `-createdAt`, `name,-condition` |
| `q` | Free-text search across that module's searchable fields |
| `park` | Restrict to one park |

Pagination metadata:

```jsonc
"meta": { "total": 231, "page": 1, "limit": 15, "totalPages": 16,
          "hasNextPage": true, "hasPrevPage": false }
```

**Status codes:** `200` ok · `201` created · `204` deleted · `400` bad request ·
`401` unauthenticated · `403` wrong role · `404` not found · `409` conflict ·
`422` validation failed · `429` rate limited · `500` server error.

---

## Authentication

| Method | Path | Role | Notes |
|---|---|---|---|
| `POST` | `/auth/register` | public | Always creates a **citizen**; `role` in the body is ignored |
| `POST` | `/auth/login` | public | Returns `{ token, user }`. Rate limited to 20 attempts / 15 min |
| `GET` | `/auth/me` | any | Current user |
| `PATCH` | `/auth/me` | any | Name, phone, avatar, home park — **not** role |
| `POST` | `/auth/change-password` | any | Requires the current password |

```bash
curl -X POST localhost:5000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"officer@greenpulse.gov","password":"greenpulse123"}'
```

---

## Module 1 — Dashboard

| Method | Path | Role |
|---|---|---|
| `GET` | `/dashboard/overview?park=` | public |
| `GET` | `/dashboard/trend?days=30&park=` | public |
| `GET` | `/dashboard/activity?limit=15` | public |

`overview` returns the whole landing page in one round trip: health score with
sub-indices, weights and per-component contributions; live AQI description;
biodiversity indices; eight KPI tiles; queue counts; recent alerts; priority
incidents; recent reports; and the park ranking.

---

## Module 2 — GIS

| Method | Path | Role | Notes |
|---|---|---|---|
| `GET` | `/gis/layers?layers=&park=` | public | One GeoJSON FeatureCollection per layer |
| `GET` | `/gis/heatmap?metric=&park=` | public | `[lat, lng, intensity]` tuples |
| `GET` | `/gis/within?lng=&lat=&radius=` | public | 2dsphere `$near` across four collections |

Layers: `parks`, `trees`, `water`, `wildlife`, `pollution`, `trails`, `sensors`,
`reports`. Heatmap metrics: `pollution`, `incidents`, `wildlife`.

---

## Module 3 — Parks & Assets

### Parks

| Method | Path | Role |
|---|---|---|
| `GET` | `/parks` | public |
| `GET` | `/parks/:id` | public |
| `GET` | `/parks/:id/health` | public |
| `GET` | `/parks/:id/summary` | public |
| `GET` | `/parks/:id/trend?days=` | public |
| `GET` | `/parks/near?lng=&lat=&radius=` | public |
| `POST` `PATCH` `DELETE` | `/parks[/:id]` | admin |

### Assets

| Method | Path | Role |
|---|---|---|
| `GET` | `/assets` | public |
| `GET` | `/assets/stats?park=` | public |
| `GET` | `/assets/:id` · `/assets/:id/history` | public |
| `POST` `PATCH` | `/assets[/:id]` | officer |
| `POST` | `/assets/:id/maintenance` | officer |
| `DELETE` | `/assets/:id` | admin *(soft delete)* |

Filters: `type`, `status`, `park`, `active`.
Asset types: `tree`, `plant`, `bench`, `lake`, `path`, `light`, `structure`.

`status` is derived from `condition` and cannot be set directly:
≥85 excellent · ≥70 good · ≥50 fair · ≥30 poor · else critical.

---

## Module 4 — Biodiversity

| Method | Path | Role | Notes |
|---|---|---|---|
| `GET` | `/biodiversity/indices?park=&days=` | public | All indices + abundance vector + per-taxocene breakdown |
| `POST` | `/biodiversity/indices/preview` | public | Computes over an arbitrary `abundances` array |
| `GET` | `/biodiversity/compare` | public | Every park side by side |
| `GET` | `/biodiversity/seasonality?species=&park=` | public | Monthly counts |
| `GET` | `/biodiversity/species` | public | Catalogue |
| `GET` | `/biodiversity/species/:id/observations` | public | |
| `POST` `PATCH` | `/biodiversity/species[/:id]` | ecologist | |
| `GET` | `/biodiversity/observations` | public | |
| `POST` | `/biodiversity/observations` | any signed-in | Officers' records are auto-verified |
| `POST` | `/biodiversity/observations/:id/verify` | ecologist | **Admits the record into the indices** |

```bash
curl -X POST localhost:5000/api/biodiversity/indices/preview \
  -H 'Content-Type: application/json' \
  -d '{"abundances":[25,25,25,25]}'
# → richness 4, shannon 1.3863, evenness 1, simpsonDiversity 0.75
```

---

## Module 5 — AI

| Method | Path | Role | Notes |
|---|---|---|---|
| `GET` | `/ai/tasks` | public | Model cards + class vocabularies |
| `GET` | `/ai/stats` · `/ai/gallery?task=` | public | |
| `GET` | `/ai/detections` | public | |
| `POST` | `/ai/analyze` | optional auth | Attributed when signed in |
| `POST` | `/ai/:id/review` | ecologist | `confirmed` / `rejected` + optional corrected label |
| `DELETE` | `/ai/detections/:id` | admin | |

Tasks: `tree-disease`, `plant-id`, `wildlife`, `waste`, `fire`.

`analyze` returns the detection, the full inference (including every class
probability), any auto-created incident, and an `escalationRule` block explaining
why escalation did or did not happen.

---

## Module 6 — Sensors

| Method | Path | Role |
|---|---|---|
| `GET` | `/sensors` · `/sensors/live?park=` | public |
| `GET` | `/sensors/:id/readings?hours=24` | public |
| `GET` | `/sensors/:id/anomalies?limit=` | public |
| `POST` | `/sensors/:id/readings` | officer |
| `POST` | `/sensors/simulate` | officer |
| `POST` `PATCH` `DELETE` | `/sensors[/:id]` | officer / admin |

`POST /sensors/:id/readings` is the **real ingestion door** — a physical gateway
would POST here. It persists the reading, runs anomaly detection, updates the
cached value, and raises or clears threshold alerts.

Types: `aqi`, `temperature`, `humidity`, `noise`, `water`, `soil`.

---

## Module 7 — Citizen Portal

| Method | Path | Role |
|---|---|---|
| `GET` | `/citizen/reports` · `/citizen/stats` | public |
| `GET` | `/citizen/my-reports` | any signed-in |
| `POST` | `/citizen/reports` | any signed-in |
| `POST` | `/citizen/reports/:id/upvote` | any signed-in |
| `POST` | `/citizen/reports/:id/review` | officer |

`review` is the acceptance gate. Accepting an `issue` creates an **Incident**;
accepting a `wildlife-sighting` creates a **verified Observation**. Both are
returned in the response.

```jsonc
POST /citizen/reports/:id/review
{ "decision": "accepted", "incidentType": "tree-fall",
  "severity": 4, "affectedPeople": 200,
  "officialResponse": "Crew scheduled for Thursday." }
```

---

## Module 8 — Incidents & Alerts

| Method | Path | Role |
|---|---|---|
| `GET` | `/incidents` · `/incidents/triage?park=` · `/incidents/stats` | public |
| `POST` `PATCH` | `/incidents[/:id]` | officer |
| `POST` | `/incidents/:id/assign` · `/resolve` · `/work-order` | officer |
| `DELETE` | `/incidents/:id` | admin |
| `GET` | `/alerts` | public |
| `POST` | `/alerts/:id/acknowledge` · `/resolve` · `/alerts/acknowledge-all` | officer |

**`priority` and `priorityScore` are computed and ignored if sent.** `/triage`
returns each incident with a `triage` block containing the score, band, age,
overdue flag, the five factor values, and a plain-English explanation.

---

## Module 9 — Maintenance

| Method | Path | Role |
|---|---|---|
| `GET` | `/maintenance` · `/maintenance/calendar?month=YYYY-MM` · `/stats` | public |
| `POST` `PATCH` | `/maintenance[/:id]` | officer |
| `PATCH` | `/maintenance/:id/progress` | officer |
| `DELETE` | `/maintenance/:id` | admin |

Setting `progress: 100` completes the order, appends a maintenance record to the
linked asset, and raises that asset's condition by 15.

---

## Module 10 — Analytics

| Method | Path | Role |
|---|---|---|
| `GET` | `/analytics/summary?park=&days=` | public |
| `GET` | `/analytics/environmental-trend?interval=day\|week\|month` | public |
| `GET` | `/analytics/biodiversity-trend` | public |
| `GET` | `/analytics/incident-trend` | public |
| `GET` | `/analytics/engagement` | public |
| `GET` | `/analytics/park-comparison` | public |
| `GET` | `/analytics/export?dataset=&format=json\|csv` | public |
| `GET` `POST` `PATCH` | `/analytics/reports[/:id]` | public / ecologist |

Export datasets: `incidents`, `assets`, `observations`, `citizen-reports`,
`work-orders`.

`biodiversity-trend` recomputes Shannon per month from that month's
observations — it is not a rolling average of a single figure.

---

## Module 11 — Assistant

| Method | Path | Role |
|---|---|---|
| `POST` | `/assistant/ask` | optional auth |
| `POST` | `/assistant/search` | optional auth |
| `GET` | `/assistant/suggestions` · `/history/:sessionId` | public |
| `POST` | `/assistant/reindex` | admin |

`ask` returns the answer, the matched intent with confidence, cited source
documents with similarity scores, and latency.

---

## Module 12 — Administration

All routes require **admin**.

| Method | Path | Notes |
|---|---|---|
| `GET` `POST` `PATCH` `DELETE` | `/admin/users[/:id]` | Cannot change or delete your own account |
| `GET` `PATCH` | `/admin/settings` | Weights must sum to 1.00 ± 0.01 |
| `GET` | `/admin/audit-log` | Append-only |
| `GET` | `/admin/stats` | Collection sizes, DB state, runtime |
| `POST` | `/admin/recompute-scores` | Re-derives every park's cached indices |
| `POST` | `/admin/reindex-assistant` | Rebuilds the TF-IDF corpus |
| `POST` | `/admin/reseed` | Destructive; refused in production |

Saving `healthIndexWeights` triggers a full recompute automatically — a partial
update would leave parks scored under two different formulas.

---

## External Integrations

| Method | Path | Role | Notes |
|---|---|---|---|
| `GET` | `/integrations/status` | public | Which upstreams are configured and reachable |
| `GET` | `/integrations/weather?park=` | public | Open-Meteo |
| `GET` | `/integrations/air-quality?park=` | public | Concentrations → **our** CPCB AQI, plus local-sensor divergence |
| `GET` | `/integrations/park-conditions?park=` | public | Weather + air + advisory, one round trip |
| `GET` | `/integrations/gbif/:speciesId` | public | Cross-checks a catalogued species against GBIF |
| `GET` | `/integrations/gbif/search?name=` | public | |
| `GET` | `/integrations/geocode?lat=&lng=` | public | Nominatim |
| `GET` | `/integrations/ebird?park=` | public | Requires `EBIRD_API_KEY` |
| `POST` | `/integrations/clear-cache` | admin | |

Every response carries `ok`. On failure it is `{ ok: false, reason }` — never a
thrown error — and callers degrade gracefully.

---

## Utility

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api` | Index of every module mount point |
| `GET` | `/api/health` | Liveness probe; `503` when the database is down |

---

## Rate limits

| Scope | Limit |
|---|---|
| `/api/*` | 2000 req/min (300 in production) |
| `/api/auth/login` | 20 attempts / 15 min, successful ones not counted |

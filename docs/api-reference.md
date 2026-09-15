# API Reference

Base URL: `http://localhost:5000/api`

Every route below is taken from `backend/src/routes/*.js`; request bodies are
the Zod schemas in `backend/src/validators/schemas.js`.

---

## Conventions

**Every response uses one envelope.**

```jsonc
// success
{ "success": true, "data": { ... }, "meta": { ... } }   // meta on lists and some aggregates

// failure
{ "success": false, "error": { "message": "…", "details": { "field.path": "…" } } }
```

`DELETE` routes answer `204 No Content` with no body. `GET /ai/images/:id`
returns raw JPEG bytes and CSV export returns `text/csv`; everything else is
JSON in the envelope.

**Authentication.** `Authorization: Bearer <jwt>` — obtained from
`POST /auth/login` or `POST /auth/register`. Tokens expire after
`JWT_EXPIRES_IN` (default `7d`). The user is reloaded on every request, so a
deactivated account is refused immediately.

**Roles** form a hierarchy: `citizen (1) → ecologist (2) → officer (3) → admin (4)`.
A route marked *officer* also admits admins. *public* needs no token; *signed-in*
means any active account; *optional* personalises the response when a token is
present but never rejects.

**Ids** are 24-hex MongoDB ObjectIds, returned as `id` (never `_id`). A malformed
id is a `422` (route validation) or `400`; a well-formed unknown id is `404`.

**Geometry** is GeoJSON `{ "type": "Point", "coordinates": [lng, lat] }`.
`[0, 0]` is rejected as "no location picked".

**List parameters**, accepted by every paginated collection endpoint (marked
**list** below):

| Parameter | Meaning |
|---|---|
| `page` | 1-based page number (default 1) |
| `limit` | Rows per page (default 20, max 200) |
| `sort` | e.g. `-createdAt`, `name,-condition` |
| `q` | Case-insensitive search across that module's searchable fields |
| *field* | Exact-match filter on the module's filterable fields; `a,b` means "either" |
| `includeArchived=true` | On soft-deleting modules, include archived (`active: false`) rows |

Pagination metadata:

```jsonc
"meta": { "total": 231, "page": 1, "limit": 15, "totalPages": 16,
          "hasNextPage": true, "hasPrevPage": false }
```

**Missing data is `null`.** A sub-index, KPI value or trend point without input
data is `null`, not `0`.

**Status codes:** `200` ok · `201` created · `204` deleted · `400` bad request ·
`401` unauthenticated · `403` wrong role / forbidden · `404` not found ·
`409` conflict · `413` body too large · `422` validation failed ·
`429` rate limited · `500` server error · `503` database down (health) or vision
model unavailable.

---

## Authentication

| Method | Path | Role | Body → Response |
|---|---|---|---|
| `POST` | `/auth/register` | public | `{ name, email, password (≥8), park? }` → `201 { token, user }`. Always creates a **citizen**; `role` in the body is ignored. `409` if the email exists (case-insensitive) |
| `POST` | `/auth/login` | public | `{ email, password }` → `{ token, user }`. `401` wrong credentials (same message for unknown email), `403` deactivated. Rate limited to 20 failed attempts / 15 min |
| `GET` | `/auth/me` | signed-in | → user with `park { id, name, slug }` |
| `PATCH` | `/auth/me` | signed-in | `{ name?, phone?, avatar?, park? }` → user. **Not** role |
| `POST` | `/auth/change-password` | signed-in | `{ currentPassword, newPassword (≥8) }` → `{ message }`; `400` if the current password is wrong |

```bash
curl -X POST localhost:5000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"officer@greenpulse.gov","password":"greenpulse123"}'
```

(The seeded accounts are demonstration records, `demo: true`.)

---

## Module 1 — Dashboard

| Method | Path | Role | Response |
|---|---|---|---|
| `GET` | `/dashboard/overview?park=` | public | See below |
| `GET` | `/dashboard/trend?days=30&park=` | public | `[{ date, air, water, soil, noise, temperature, humidity }]` — daily normalised 0–100 scores, `null` where a type had no readings; `meta { days, points }`. `days` 1–365 |
| `GET` | `/dashboard/activity?limit=15&park=` | public | `[{ type, id, title, subtitle, park, at, icon }]` merged across incidents, citizen reports, work orders, AI detections and portal-logged observations (bulk GBIF rows excluded). `limit` 5–50 |

`overview` returns the landing page in one round trip:

```jsonc
{
  "scope": "citywide" | "park",
  "health": { "score", "grade", "subIndices": { airQuality, waterQuality, soilHealth, treeHealth, biodiversity },
              "weights", "contributions": [{ key, score, weight, contribution }], "computedAt" },
  "airQuality": { aqi, score, label, advice } | null,      // mean of reporting AQI sensors
  "biodiversity": { score, richness, shannon, evenness, simpsonDiversity, threatenedSpecies, byClass },
  "kpis": [{ key, label, value | null, unit, score | null, icon, source? }],   // 8 tiles
  "counts": { activeAlerts, openIncidents, pendingReports, dueWorkOrders, assets, species,
              sensorsOnline, sensorsWarning, sensorsOffline },
  "recentAlerts": [...], "priorityIncidents": [...], "recentReports": [...],
  "parkRanking": [{ id, name, slug, score | null, grade | null, biodiversity, areaAcres, weeklyVisitors }]
}
```

---

## Module 2 — GIS

| Method | Path | Role | Response |
|---|---|---|---|
| `GET` | `/gis/layers?layers=&park=` | public | `{ <layer>: FeatureCollection }`, `meta { layers, counts }`. Default: all layers |
| `GET` | `/gis/heatmap?metric=pollution&park=` | public | `[[lat, lng, intensity]]`, `meta { metric, points }` |
| `GET` | `/gis/within?lng=&lat=&radius=1000` | public | `{ centre: [lng, lat], radiusMetres, parks, assets, wildlife, incidents }` via 2dsphere `$near`; radius 50–20 000 m; `400` for missing or out-of-range coordinates |

Layers: `parks` (point + boundary, cached scores), `trees` (tree/plant assets),
`water` (lake assets), `trails` (path assets as LineStrings), `wildlife`
(latest 500 verified observations), `pollution` (open water-pollution,
air-pollution and illegal-dumping incidents), `sensors`, `reports` (latest 300
non-rejected citizen reports). Heatmap metrics: `pollution`, `incidents`
(weight = priority score / 100), `wildlife` (weight = count / max count).

---

## Module 3 — Parks & Assets

### Parks

| Method | Path | Role | Notes |
|---|---|---|---|
| `GET` | `/parks` | public | **list** · filters `active`, `city` · search name, description, address · default sort `name` |
| `GET` | `/parks/near?lng=&lat=&radius=2000` | public | Parks by distance; radius ≤ 50 000 m; `meta { centre, radiusMetres }` |
| `GET` | `/parks/:id` | public | Park with OSM `boundary`, `areaAcres`, `facilities`, `openingHours`, `source`, cached `scores` |
| `GET` | `/parks/:id/health` | public | `{ park: { id, name }, ecosystemHealth, grade, subIndices, sensorScores, weights, contributions, biodiversityDetail, computedAt }` — recomputed, and written back to the park's cached scores |
| `GET` | `/parks/:id/summary` | public | `{ park, counts: { assets, sensors, openIncidents, observations, species }, biodiversity: { score, richness, shannon, evenness } }` |
| `GET` | `/parks/:id/trend?days=30` | public | As `/dashboard/trend` for one park |
| `POST` | `/parks` | admin | `{ name, location, slug?, description?, boundary?, areaAcres?, weeklyVisitors?, establishedYear?, address?, city?, manager?, facilities?, images?, active? }` → `201`. Slug derived from the name if omitted |
| `PATCH` | `/parks/:id` | admin | Any subset of the create fields |
| `DELETE` | `/parks/:id` | admin | Soft delete (`active: false`) |

### Assets

| Method | Path | Role | Notes |
|---|---|---|---|
| `GET` | `/assets` | public | **list** · filters `type`, `status`, `park`, `active` · search name, assetCode, notes |
| `GET` | `/assets/stats?park=` | public | `{ byType: [{ type, count, avgCondition }], byStatus, total, avgCondition, maintenanceSpend, needsAttention }` (condition < 50) |
| `GET` | `/assets/:id` | public | Asset with `source` (e.g. `OpenStreetMap node/…`) and `demo` |
| `GET` | `/assets/:id/history` | public | `{ asset, maintenance: [...newest first], workOrders, totalSpend }` |
| `POST` | `/assets` | officer | `{ type, name, park, location, path?, condition?, installedAt?, nextMaintenanceDue?, attributes?, notes?, images?, active?, assetCode? }` → `201`. Code generated from the counter as `TRE-0001`, `BNC-…`, `LGT-…` etc. if omitted |
| `PATCH` | `/assets/:id` | officer | Any subset; `status` is re-derived from `condition` |
| `POST` | `/assets/:id/maintenance` | officer | `{ type, date?, description?, cost?, technician?, conditionAfter? }` → `201` asset. Condition becomes `conditionAfter`, or rises by 10 (max 100) |
| `DELETE` | `/assets/:id` | admin | Soft delete |

Asset types: `tree`, `plant`, `bench`, `lake`, `path`, `light`, `structure`.
`status` is derived from `condition` and cannot be set directly:
≥85 excellent · ≥70 good · ≥50 fair · ≥30 poor · else critical.

---

## Module 4 — Biodiversity

| Method | Path | Role | Notes |
|---|---|---|---|
| `GET` | `/biodiversity/indices?park=&days=` | public | `{ scope, park, windowDays, indices: { richness, totalIndividuals, shannon, shannonMax, evenness, simpson, simpsonDiversity, margalef, dominance }, score, conservationComponent, threatenedSpecies, invasiveIndividuals, byClass, byClassIndices, byConservation, abundance: [{ speciesId, count, sightings, commonName, scientificName, class, conservationStatus, isInvasive }] }`. For GBIF rows "individuals" are occurrence **records** |
| `POST` | `/biodiversity/indices/preview` | public | `{ abundances: [positive numbers] }` → `{ richness, total, shannon, shannonMax, evenness, simpson, simpsonDiversity, margalef, dominance }` without touching the database |
| `GET` | `/biodiversity/compare` | public | `[{ park, parkId, score, richness, shannon, evenness, simpsonDiversity, threatenedSpecies, totalIndividuals }]`, highest score first |
| `GET` | `/biodiversity/seasonality?species=&park=` | public | 12 rows `{ month: 'Jan', individuals, sightings, richness }` over verified observations |
| `GET` | `/biodiversity/species` | public | **list** · filters `class`, `conservationStatus`, `isInvasive`, `isIntroduced`, `isIndicator`, `parks` · search commonName, scientificName, habitat, family · default sort `commonName` |
| `GET` | `/biodiversity/species/:id` | public | Species with `gbifKey`, `order`, `images`, `imageCredit`, `parks` |
| `GET` | `/biodiversity/species/:id/observations` | public | Paginated `{ species, observations, verifiedIndividuals }` |
| `POST` | `/biodiversity/species` | ecologist | `{ commonName, scientificName, class, family?, conservationStatus?, habitat?, description?, isInvasive?, isIndicator?, seasonality?, images? }` → `201` |
| `PATCH` | `/biodiversity/species/:id` | ecologist | Any subset |
| `DELETE` | `/biodiversity/species/:id` | admin | Hard delete |
| `GET` | `/biodiversity/observations` | public | **list** · filters `species`, `park`, `source`, `verified` · search notes, locationName, observerName · default sort `-observedAt` |
| `GET` | `/biodiversity/observations/:id` | public | |
| `POST` | `/biodiversity/observations` | signed-in | `{ species, park, location, observedAt?, count? (default 1), locationName?, observerName?, source?, notes?, images? }` → `201`. Records by ecologists, officers and admins are `verified: true`; citizens' are not |
| `PATCH` | `/biodiversity/observations/:id` | ecologist | Any subset |
| `DELETE` | `/biodiversity/observations/:id` | ecologist | Hard delete |
| `POST` | `/biodiversity/observations/:id/verify` | ecologist | `{ verified?: boolean }` (default true) — **admits the record into the indices** |

Classes: `bird`, `mammal`, `butterfly`, `reptile`, `amphibian`, `tree`, `plant`,
`insect`. Conservation statuses: `Not Evaluated`, `Data Deficient`,
`Least Concern`, `Near Threatened`, `Vulnerable`, `Endangered`,
`Critically Endangered`, `Extinct in the Wild`. Observation sources:
`officer-survey`, `citizen-report`, `camera-trap`, `ai-detection`, `gbif`
(`gbif` rows come only from the seeded snapshot; the create schema does not
accept it).

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
| `GET` | `/ai/tasks` | public | `[{ task, title, method, model, classes: [{ label, severity }] }]` |
| `GET` | `/ai/stats` | public | `{ byTask: [{ task, count, avgConfidence }], bySeverity, confidenceDistribution: [5 bands <50 · 50–70 · 70–85 · 85–95 · 95–100], review: { pending, confirmed, rejected, precision }, total }`. `precision` = 100 · confirmed / (confirmed + rejected), `null` until a review exists |
| `GET` | `/ai/gallery?task=` | public | 24 most recent detections, park and linked incident populated |
| `GET` | `/ai/images/:id` | public | The stored JPEG (`Content-Type: image/jpeg`, immutable cache, `ETag` = SHA-256, `X-Image-Credit` for sample photos) |
| `GET` | `/ai/detections` | public | **list** · filters `task`, `severity`, `reviewStatus`, `park` · search prediction, imageName |
| `GET` | `/ai/detections/:id` | public | |
| `POST` | `/ai/analyze` | signed-in | Run one image through a task — see below. Rate limited to 20 per account per minute |
| `POST` | `/ai/:id/review` | ecologist | `{ verdict: 'confirmed' \| 'rejected', correctedLabel? }` → detection. A `correctedLabel` must be one of the task's class labels and must differ from the prediction (`400` otherwise) |
| `DELETE` | `/ai/detections/:id` | admin | |

Tasks: `tree-disease`, `plant-id`, `wildlife`, `waste`, `fire`.

**`POST /ai/analyze`**

```jsonc
// request
{ "task": "fire",
  "imageUrl": "https://… (public http/https URL)" | "data:image/jpeg;base64,…",
  "imageName": "optional.jpg",
  "park": "<parkId, optional — required for auto-escalation>",
  "location": { "type": "Point", "coordinates": [lng, lat] } }

// 201 response
{
  "detection": { id, task, imageUrl: "/api/ai/images/<id>", image, imageName, park, prediction, detail,
                 confidence, probabilities: [{ label, probability }], imagenet, evidence, notes,
                 severity, recommendedAction, modelName, modelVersion, inferenceMs,
                 submittedBy, reviewStatus: "pending", linkedIncident, createdAt },
  "inference": { title, method, prediction, detail, confidence, probabilities, severity,
                 recommendedAction, evidence, notes, imagenet: [top 5], stats, image: { width, height, format, bytes },
                 model: { name, version, inputSize, source, backend }, timings: { fetchMs, decodeMs, statsMs, inferenceMs },
                 inferenceMs },
  "escalated": { id, referenceCode, priority } | null,
  "escalationRule": { escalatable, confident, confidenceFloor, applied, reason }
}
```

Input rules: JPEG or PNG only (detected from the bytes), at least 16×16, at most
8 MB. A URL must resolve only to public addresses — loopback, private (10/8,
172.16/12, 192.168/16), link-local (169.254/16, `fe80`), CGNAT (100.64/10),
unique-local (`fc`/`fd`), multicast/reserved and unspecified addresses are
refused; redirects are followed manually (at most 3) and each hop is re-checked;
the download times out after 15 s. Failures are `400` with a reason; an unknown
`task` is `422`; a model that cannot be loaded is `503`.

Every analysed image is re-encoded as a ≤640 px JPEG and stored once per
SHA-256 in `AiImage`. Only a **"Flames visible"** or **"Smoke visible"** result
at or above `Setting.aiAutoIncidentConfidence` (default 85 %) with a `park`
opens an incident; everything else is queued for review.

---

## Module 6 — Sensors

| Method | Path | Role | Notes |
|---|---|---|---|
| `GET` | `/sensors` | public | **list** · filters `type`, `status`, `park`, `active`, `source` · search name, sensorCode · default sort `name` |
| `GET` | `/sensors/live?park=` | public | `{ sensors: [{ ...sensor, currentValue \| null, score \| null, breached, stale }], summary: { total, online, warning, offline, maintenance, bySource, averageScoreByType } }`. A sensor that has never reported has `currentValue: null` |
| `GET` | `/sensors/:id` | public | |
| `GET` | `/sensors/:id/readings?hours=24` | public | `{ sensor, readings: [{ time, value, score, isAnomaly, zScore }] (oldest first), stats: { min, max, mean, stdDev, median, anomalies } \| null }`, `meta { hours, points }`. `hours` 1–720 |
| `GET` | `/sensors/:id/anomalies?limit=200` | public | `{ sensor, anomalies: [{ recordedAt, value, zScore, reason }] }`, `meta { scanned, found }`. `limit` 20–1000 |
| `POST` | `/sensors/:id/readings` | officer | `{ value, recordedAt? }` → `201 { reading, anomaly, alertsRaised, sensor: { id, status, currentValue } }`. **Only `source: 'device'` sensors**; others answer `409` |
| `POST` | `/sensors/refresh` | officer | Run one refresh now → `{ live, simulated, anomalies, stale, simulationEnabled, errors: [...] }` |
| `POST` | `/sensors` | admin | `{ sensorCode, name, type, park, location, unit?, minValue?, maxValue?, warnAbove?, warnBelow?, status?, source?, batteryLevel?, firmware?, active? }` → `201`. `source` defaults to `device`; unit and thresholds default from the type profile |
| `PATCH` | `/sensors/:id` | officer | Any subset |
| `DELETE` | `/sensors/:id` | admin | Soft delete |

Types: `aqi`, `temperature`, `humidity`, `noise`, `water`, `soil`.
Statuses: `online`, `warning`, `offline`, `maintenance`.

Sources:

| `source` | Types seeded | Readings |
|---|---|---|
| `open-meteo` | aqi, temperature, humidity (one each per park) | Real observations for the park's coordinates; ingested by the refresh job only when the upstream observation time advances; nothing when offline; `offline` after 3 h with no data |
| `simulated` | noise, soil (every park), water (parks with a mapped water body) | Generated (AR(1) + daily cycle + noise + rare spikes) |
| `device` | none seeded | Posted by hardware to `POST /sensors/:id/readings` |

Every path runs the same ingestion: anomaly detection against the last 50
readings, persistence, cached value and status, and threshold alerts raised or
auto-resolved.

---

## Module 7 — Citizen Portal

| Method | Path | Role | Notes |
|---|---|---|---|
| `GET` | `/citizen/stats` | public | `{ byCategory, byStatus, byPark: [{ park, reports, upvotes }], topContributors, total, acceptanceRate }` |
| `GET` | `/citizen/reports` | public | **list** · filters `category`, `status`, `park`, `submittedBy` · search title, description, referenceCode |
| `GET` | `/citizen/reports/:id` | public | |
| `GET` | `/citizen/my-reports` | signed-in | `{ reports, summary: { total, byStatus, totalUpvotes, contributions } }` — only the caller's |
| `GET` | `/citizen/my-upvotes` | signed-in | `["<reportId>", …]` the caller has upvoted |
| `POST` | `/citizen/reports` | signed-in | `{ category, title (4–200), description (10–2000), park, location, images? (≤6), species?, submittedByName? }` → `201` with `referenceCode` `CR-YYYY-NNNN`, `status: 'submitted'`. `403` for citizens when the admin has switched public reporting off |
| `POST` | `/citizen/reports/:id/upvote` | signed-in | → `{ id, upvotes, upvoted: true }`. One per account; repeating is a no-op |
| `DELETE` | `/citizen/reports/:id/upvote` | signed-in | → `{ id, upvotes, upvoted: false }`. Withdraws the caller's upvote |
| `POST` | `/citizen/reports/:id/review` | officer | See below → `{ report, createdIncident \| null, createdObservation \| null }` |
| `PATCH` | `/citizen/reports/:id` | officer | `{ title?, description?, images?, status?, officialResponse? }` |
| `DELETE` | `/citizen/reports/:id` | admin | |

Categories: `issue`, `wildlife-sighting`, `feedback`, `suggestion`.
`upvotedBy` is never returned. An upvote change is mirrored to the linked
incident's `upvotes` and its priority is recomputed.

`review` is the acceptance gate. Accepting an `issue` creates an **Incident**
(once); accepting a `wildlife-sighting` creates a **verified Observation** and
requires a species (`400` otherwise).

```jsonc
POST /citizen/reports/:id/review
{ "decision": "accepted" | "rejected" | "in-review",
  "officialResponse": "Crew scheduled for Thursday.",
  "incidentType": "tree-fall",      // issue; default infrastructure-damage
  "severity": 4, "affectedPeople": 200,
  "species": "<speciesId>", "count": 3 }   // sighting
```

---

## Module 8 — Incidents & Alerts

Incident records carry reporter identities and exact hazard locations, so
**every incident route requires an officer**, including reads. Public pages use
the dashboard and analytics aggregates instead.

| Method | Path | Role | Notes |
|---|---|---|---|
| `GET` | `/incidents` | officer | **list** · filters `type`, `status`, `priority`, `park`, `assignedTo`, `source` · search title, description, referenceCode · default sort `-priorityScore,-reportedAt` |
| `GET` | `/incidents/triage?park=` | officer | Open incidents, each with `triage: { score, priority, ageHours, responseTargetHours, isOverdue, factors: { hazard, severity, exposure, urgency, community }, explanation }`, highest score first; `meta { total, overdue, critical }` |
| `GET` | `/incidents/stats?park=` | officer | `{ byType: [{ type, label, count }], byStatus, byPriority, meanResolution: [{ type, hours, targetHours, resolved }], total, open, activeAlerts }` |
| `GET` | `/incidents/:id` | officer | With `timeline` |
| `POST` | `/incidents` | officer | `{ type, title, park, location, description?, severity? (1–5), affectedPeople?, source?, images?, reportedAt? }` → `201`. Reference code `INC-YYYY-NNNN`; high/critical raises an alert |
| `PATCH` | `/incidents/:id` | officer | `{ title?, description?, type?, severity?, affectedPeople?, status?, statusNote?, resolutionNotes?, assignedTo? }`. A status change appends a timeline entry; reopening a resolved incident clears `resolvedAt` and `resolutionMinutes` |
| `POST` | `/incidents/:id/assign` | officer | `{ assignedTo }` — must be an officer, ecologist or admin; `reported` → `assigned` |
| `POST` | `/incidents/:id/resolve` | officer | `{ resolutionNotes? }` → incident; stamps `resolvedAt`, `resolutionMinutes`, resolves its alert |
| `POST` | `/incidents/:id/work-order` | officer | `{ type?, title?, description?, scheduledDate?, assignedTo?, assignedTeam?, estimatedCost? }` → `201` work order carrying the incident's priority. `409` if an open work order already exists for the incident |
| `DELETE` | `/incidents/:id` | admin | |
| `GET` | `/alerts` | public | **list** · filters `status`, `severity`, `source`, `park`, `module` · search title, message · `meta` adds `activeBySeverity` |
| `GET` | `/alerts/:id` | public | |
| `POST` | `/alerts/acknowledge-all` | officer | `{ park?, severity? }` → `{ acknowledged }` |
| `POST` | `/alerts/:id/acknowledge` | officer | `400` if already resolved |
| `POST` | `/alerts/:id/resolve` | officer | |

Types: `tree-fall`, `illegal-dumping`, `fire`, `water-pollution`, `dead-animal`,
`vandalism`, `infrastructure-damage`, `air-pollution`. Statuses: `reported`,
`assigned`, `in-progress`, `resolved`, `closed`.

**`priority` and `priorityScore` are computed on every write and ignored if
sent.** Alerts are raised only by services (no create endpoint) and are
deduplicated by condition.

---

## Module 9 — Maintenance

| Method | Path | Role | Notes |
|---|---|---|---|
| `GET` | `/maintenance` | public | **list** · filters `type`, `status`, `priority`, `park`, `assignedTo` · search title, description, orderCode, assetName · default sort `scheduledDate` |
| `GET` | `/maintenance/calendar?month=YYYY-MM&park=` | public | `{ month, days: { "YYYY-MM-DD": [orders] } }`, `meta { total }` |
| `GET` | `/maintenance/stats?park=` | public | `{ byStatus, byType: [{ type, count, cost }], workload: [{ name, role, open }], totals: { total, completed, overdue, inProgress, completionRate, estimatedCost, actualCost } }` |
| `GET` | `/maintenance/:id` | public | |
| `POST` | `/maintenance` | officer | `{ type, title, park, scheduledDate, description?, asset?, assetName?, assignedTo?, assignedTeam?, priority?, status?, progress?, estimatedCost?, actualCost?, estimatedHours?, recurrence?, completionNotes? }` → `201`, code `WO-YYYY-NNNN` |
| `PATCH` | `/maintenance/:id` | officer | Any subset |
| `PATCH` | `/maintenance/:id/progress` | officer | `{ progress (0–100), completionNotes?, actualCost? }` → work order |
| `DELETE` | `/maintenance/:id` | admin | |

Work-order types: `cleaning`, `tree-trimming`, `repair`, `lake-cleaning`,
`inspection`, `planting`, `irrigation`. Statuses: `scheduled`, `in-progress`,
`completed`, `overdue`, `cancelled`.

The list, calendar and stats reads first mark every `scheduled` order whose date
has passed as `overdue` (the server also sweeps every 10 minutes). Reaching
`progress: 100` completes the order; completing an order linked to an asset
appends a maintenance record to that asset and raises its condition by 15.

---

## Module 10 — Analytics

The trend endpoints accept `park=` and a window: `from=&to=` (ISO dates) or
`days=` (default 90).

| Method | Path | Role | Response |
|---|---|---|---|
| `GET` | `/analytics/summary` | public | `{ window, ecosystemHealth, healthGrade, subIndices, biodiversity: { score, richness, shannon, evenness, threatenedSpecies }, incidents: { total, resolved, resolutionRate, avgResolutionHours, avgPriorityScore }, citizenReports, maintenance: { total, completed, completionRate, cost }, aiDetections, assets: { count, avgCondition } }` |
| `GET` | `/analytics/environmental-trend?interval=day\|week\|month` | public | `[{ date, <type>: score, <type>Raw: mean, anomalies }]` per bucket for each sensor type with readings |
| `GET` | `/analytics/biodiversity-trend` | public | `[{ month, richness, individuals, shannon, evenness, simpsonDiversity }]` |
| `GET` | `/analytics/incident-trend` | public | `[{ month, reported, resolved, critical, backlog, avgResolutionHours }]` (monthly aggregates only) |
| `GET` | `/analytics/engagement` | public | `[{ month, total, upvotes, issue?, wildlife-sighting?, feedback?, suggestion? }]` |
| `GET` | `/analytics/park-comparison` | public | `[{ parkId, park, areaAcres, weeklyVisitors, ecosystemHealth, grade, airQuality, waterQuality, soilHealth, treeHealth, biodiversity, speciesRichness, shannon, openIncidents, assetCount, avgAssetCondition }]` |
| `GET` | `/analytics/export?dataset=&format=json\|csv&park=` | officer | Row-level export, up to 5 000 rows. JSON: rows with `meta { dataset, rows }`; CSV: attachment with a header row |
| `GET` | `/analytics/reports` | optional | **list** · filters `type`, `status`, `park` · search title, summary. Below ecologist, only `published` reports are listed |
| `GET` | `/analytics/reports/:id` | optional | Below ecologist, a non-published report is `404` |
| `POST` | `/analytics/reports/generate` | ecologist | `{ type, park?, days? (7–730, default 90) }` → `201` **draft** report whose `metrics`, `findings` and `recommendations` are computed from the data |
| `POST` | `/analytics/reports` | ecologist | `{ title, type, summary?, park?, periodStart?, periodEnd?, metrics?, findings?, recommendations?, status?, authorName? }` → `201` |
| `PATCH` | `/analytics/reports/:id` | ecologist | Any subset — e.g. `{ "status": "published" }` (stamps `publishedAt`) |
| `DELETE` | `/analytics/reports/:id` | admin | |

Export datasets: `incidents`, `assets`, `observations`, `citizen-reports`,
`work-orders`. Report types: `ecosystem`, `biodiversity`, `water`, `air`,
`soil`, `maintenance`, `engagement`.

`biodiversity-trend` recomputes Shannon per month from that month's
observations — it is not a rolling average of a single figure.

---

## Module 11 — Assistant

| Method | Path | Role | Body → Response |
|---|---|---|---|
| `POST` | `/assistant/ask` | optional | `{ question (2–1000), sessionId? }` → `201 { sessionId, message, intent, intentConfidence, citations: [{ label, entity, entityId, score }], latencyMs }`. Both turns are stored in `ChatMessage`. New sessions get an unguessable `session-<uuid>`; passing the id of a conversation owned by another account starts a new session instead |
| `POST` | `/assistant/search` | optional | `{ query (2–200), entities?, k? (1–25, default 8) }` → `[{ entity, id, label, score }]`, `meta { query, tokens, results }` |
| `GET` | `/assistant/suggestions` | public | `{ suggestions, capabilities }` |
| `GET` | `/assistant/history/:sessionId` | optional | Up to 200 messages, oldest first; `meta { sessionId, count }`. A conversation started while signed in is readable only by that account or an admin (`404` otherwise); an anonymous one by whoever holds its id |
| `POST` | `/assistant/reindex` | admin | `{ documents, vocabulary, rebuiltAt }` |

Intents: `health`, `airQuality`, `biodiversity`, `incidents`, `maintenance`,
`assets`, `sensors`, `parks`, `tips`, or `general`. Phrases ("air quality",
"water quality", "soil health", "work order") and park names in the question are
handled — a park name sets the scope without overriding the specific intent.

---

## Module 12 — Administration

All `/admin` routes require **admin**.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/admin/users` | **list** · filters `role`, `active`, `park` · search name, email |
| `GET` | `/admin/users/:id` | |
| `POST` | `/admin/users` | `{ name, email, password (≥8), role, park?, phone?, active? }` → `201` |
| `PATCH` | `/admin/users/:id` | Any subset. `400` when changing your own role |
| `DELETE` | `/admin/users/:id` | Soft delete (deactivates). `400` for your own account |
| `GET` | `/admin/settings` | The settings singleton |
| `PATCH` | `/admin/settings` | `{ organisationName?, city?, contactEmail?, healthIndexWeights?: { air, water, soil, tree, biodiversity }, anomalyZThreshold? (1–6), aiAutoIncidentConfidence? (0–100), enableSensorSimulation?, enablePublicReporting?, mapDefaultZoom? }`. Weights must sum to 1.00 ± 0.01; saving them recomputes every park's scores |
| `GET` | `/admin/audit-log` | **list** · filters `action`, `entity`, `actor`, `actorRole` · search entityLabel, actorName |
| `GET` | `/admin/stats` | `{ counts, usersByRole, database: { name, state, collections }, runtime: { node, uptimeSeconds, memoryMb, environment } }` |
| `POST` | `/admin/recompute-scores` | `{ parks, results: [{ park, ecosystemHealth }] }` |
| `POST` | `/admin/reindex-assistant` | `{ documents, vocabulary }` |
| `POST` | `/admin/reseed` | Drops and rebuilds the database from the open-data snapshot plus demo records; returns the seed summary. `403` in production |

---

## Staff directory and public settings

| Method | Path | Role | Response |
|---|---|---|---|
| `GET` | `/users/staff` | officer | `[{ id, name, role, park: { id, name } \| null }]` — active officers, ecologists and admins, for assignment pickers |
| `GET` | `/settings/public` | public | `{ organisationName, city, contactEmail, enablePublicReporting, enableSensorSimulation, mapDefaultZoom }` |

---

## External Integrations

Location for the first five routes: `lat=&lng=`, or `park=<id>`, or neither —
the mean position of all active parks.

| Method | Path | Role | Response |
|---|---|---|---|
| `GET` | `/integrations/status` | public | `{ reachable, probeReason, cacheEntries, integrations: [{ id, name, purpose, requiresKey, configured, live }] }` |
| `GET` | `/integrations/weather?park=` | public | `{ location, ok, source, attribution, current: { temperature, feelsLike, humidity, precipitation, pressure, windSpeed, windDirection, cloudCover, isDay, code, condition, icon, observedAt, uvIndexMax, sunrise, sunset }, forecast: [7 days] }`. `source=openweathermap` uses OpenWeatherMap when `OPENWEATHER_API_KEY` is set |
| `GET` | `/integrations/air-quality?park=` | public | `{ location, live: { ok, source, method, observedAt, concentrations, averages, subIndices, dominantPollutant, aqi, score, label, advice, pm25Series }, localSensor: { name, value, unit, status, lastReadingAt } \| null, divergence }` — CAMS concentrations scored by **our** CPCB code with 24 h / 8 h averaging |
| `GET` | `/integrations/park-conditions?park=` | public | `{ location, weather, airQuality, advisory }` in one round trip |
| `GET` | `/integrations/ebird?park=&radiusKm=25&days=14` | public | Recent bird records; requires `EBIRD_API_KEY` |
| `GET` | `/integrations/gbif/search?name=&lat=&lng=&radiusKm=50&limit=20` | public | GBIF occurrences of a scientific name near the location |
| `GET` | `/integrations/gbif/:speciesId` | public | `{ species, taxonomy, occurrences, verdict: 'corroborated' \| 'not-recorded-nearby' \| 'unknown', note }` |
| `GET` | `/integrations/geocode?lat=&lng=` | public | Nominatim reverse geocode `{ displayName, address }` |
| `POST` | `/integrations/clear-cache` | admin | `{ cleared }` |

Upstream failure is not an HTTP error: the payload (or its `live` / `weather` /
`airQuality` part) is `{ ok: false, reason }`, and callers degrade gracefully.

---

## Utility

| Method | Path | Notes |
|---|---|---|
| `GET` | `/` (host root) | Banner pointing at `/api` |
| `GET` | `/api` | Index of every module mount point |
| `GET` | `/api/health` | `{ status, database, uptimeSeconds, timestamp }`; `503` when the database is not connected |

---

## Rate limits

In-memory, per process.

| Scope | Limit |
|---|---|
| `/api/*` | 2000 req/min per IP (300 in production) |
| `/api/auth/login` | 20 attempts / 15 min per IP, successful ones not counted |
| `POST /api/ai/analyze` | 20 analyses / min per account |

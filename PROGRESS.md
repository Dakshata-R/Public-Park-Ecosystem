# Build status — complete

Last updated 2026-08-28. The project is finished and verified running end to end.

For how to run it, see [README.md](README.md). For the review walkthrough, see
[docs/demo-script.md](docs/demo-script.md).

---

## Verification

A 52-check end-to-end suite runs against both live servers and passes fully:

```
16 frontend routes            all HTTP 200
 4 auth / role checks         login, bad password, 403 on wrong role, 401 anonymous
17 module endpoints           all 12 modules + integrations
11 write flows                incident → work order → resolve; AI inference;
                              assistant; index calculator
 2 validation                 422 on bad payload, CSV export
 2 live public APIs           real weather, real CPCB AQI
─────────────────────────────────────────────────────────
52 passed, 0 failed
```

Additional checks:

- `npx tsc --noEmit` — clean across the whole frontend
- `npm run build` — 17 routes, no warnings
- 12 assistant intent-routing cases — all correct

---

## What was built

| | Files | Lines |
|---|---|---|
| Backend (`backend/src`) | 83 | ~10,900 |
| Frontend (`frontend/app`, `components`, `lib`, `hooks`) | 96 | ~18,500 |
| Documentation (`docs/`, README) | 6 | ~1,900 |

134 route handlers · 16 MongoDB collections · 12 modules · 17 pages.

### Backend

Express + Mongoose, JWT with a four-role hierarchy, Zod validation on every
write, append-only audit log, generic CRUD factory plus module-specific
handlers, and a seeded generator producing 6 parks, 30 species, 231 assets,
32 sensors, ~3,000 readings, 420 observations, 34 incidents, 38 work orders,
41 citizen reports and 30 AI detections.

### The mathematics

| Service | Implements |
|---|---|
| `aqi.service.js` | CPCB piecewise-linear sub-indices; AQI = max; inversion to 0–100 |
| `biodiversity.service.js` | Shannon H′, Pielou J′, Simpson, Margalef, Berger–Parker, composite score, per-taxocene breakdown |
| `ecosystem-score.service.js` | Weighted composite EHI, three normalisation shapes, missing-data handling |
| `anomaly.service.js` | Z-score + modified z-score (MAD) + Tukey IQR, majority vote |
| `priority.service.js` | Triage score with bounded exponential ageing |
| `ai-inference.service.js` | Softmax with temperature, deterministic surrogate, escalation rule |
| `assistant.service.js` | TF-IDF + cosine retrieval, weighted intent routing, cited answers |
| `sensor.service.js` | AR(1) + diurnal + Box–Muller, anchored to live public data |

### Public APIs (verified live)

Open-Meteo Forecast, Open-Meteo Air Quality (CAMS), GBIF, and OpenStreetMap
Nominatim — **none require a key**. OpenWeatherMap and eBird activate if a key is
supplied. Every call has a timeout and a local fallback; the system works fully
offline.

### Frontend

All 17 routes consume the API. Typed client, endpoint registry, TanStack Query
hooks with a query-key factory, auth provider with role gating, shared
loading/error/empty states, GeoJSON↔Leaflet conversion isolated to one file.

---

## Bugs found and fixed during the build

Worth recording, because each was caught by testing rather than review:

1. **Stale fires topping the triage queue** — a critical fire sat unresolved for
   a week in the seed, which contradicted the very ordering the queue exists to
   demonstrate. Fires now resolve within their response window.
2. **Stored priority disagreeing with recomputed priority** — the seed scored
   incidents using phantom upvotes that were never persisted, so the cached value
   was irreproducible. Upvotes now come only from a linked citizen report.
3. **The simulator reviving offline sensors** — generating a reading for an
   offline device silently brought it back online, erasing the fault the
   sensor-health panel exists to surface.
4. **Invasive species at 46 % of all individuals** — implausible; weights
   rebalanced to ~15 %.
5. **TypeScript 5.2 too old for TanStack Query 5.101** — the library uses
   `NoInfer<>`, which needs TS ≥ 5.4, so generic inference was silently
   collapsing to `any` across every page. Upgraded to 5.6.
6. **`/login` deopting out of static rendering** — `useSearchParams()` needs a
   Suspense boundary. Split the form into its own component.
7. **Assistant misrouting "biodiversity score" to the health intent** — a
   one-hit tie resolved by object declaration order. Intent-naming words now
   count double, and `quality` was removed from the health lexicon because it
   collided with "air quality".

---

## Documented limitations

Each is stated in the code at the point where it matters, and in
[docs/architecture.md §8](docs/architecture.md):

- No physical sensors — the ingestion path is real, readings are generated
  (anchored to live weather where the network allows).
- No trained vision models — the inference contract is real, the weights are a
  deterministic surrogate.
- The assistant retrieves genuinely but composes answers from templates.
- JWT in `localStorage`; production should use httpOnly cookies.
- The pooled diversity index mixes survey effort across taxa — which is why
  per-taxocene indices are reported alongside it.

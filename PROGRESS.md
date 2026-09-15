# Build status

Last updated 2026-09-09. The project runs end to end and is covered by a
committed, repeatable test suite.

For how to run it, see [README.md](README.md). For the review walkthrough, see
[docs/demo-script.md](docs/demo-script.md).

---

## Verification

Everything below is reproducible on a clean checkout.

### Automated tests — `npm test`

```
 62 unit tests          AQI · biodiversity indices · anomaly detection ·
                        triage scoring · wire serialisation
 50 integration tests   auth, all twelve modules, the incident workflow,
                        RBAC, pagination, soft delete
──────────────────────────────────────────────────────────────────────
113 passed, 0 failed          ~13 s
```

Each suite boots its own in-memory MongoDB and binds the app to a free port,
so the tests are hermetic and never touch a development database.

### Manual verification against both live servers

| Check | Result |
|---|---|
| 105 API calls across every endpoint, all four roles | 105 passed |
| 28 security and edge-case probes | 28 passed |
| 61 endpoints scanned for serialisation leaks | 61 clean |
| Frontend routes (dev and production build) | all render |
| `npx tsc --noEmit` | clean |
| `npm run build` | 18 routes, no warnings |
| Browser console (production build) | no errors |
| Browser journey: sign in → report an incident → stored | verified |

The browser journey was driven for real: the incident submitted through the
form reached MongoDB as `INC-2026-0038` with a triage score of 46.2, matching
the score the form projected before submission.

---

## Bugs found and fixed

Each was found by testing, not by reading the code.

1. **A deleted record was not actually deleted.** `DELETE` soft-deleted by
   setting `active: false`, but neither the list query nor the by-id query
   filtered on it. The record stayed readable at its own URL, stayed in
   listings and search, and the reported total never moved — so delete looked
   like it worked while doing nothing visible. The read paths now exclude
   archived rows, with `?includeArchived=true` to opt back in. Affected parks,
   assets, sensors and users.

2. **ObjectIds reached the client as raw byte buffers.** An un-populated
   reference is a non-array object with no `_id`, so the `.lean()` normaliser
   walked straight past it and `JSON.stringify` emitted
   `{ buffer: { data: [...] } }` instead of an id string. Fixed at the
   normaliser, with Dates and Buffers explicitly preserved.

3. **Embedded sub-documents leaked `_id`.** Incident timeline entries and asset
   maintenance records exposed `_id` while every other object used `id`. The
   two sub-schemas now carry the same `toJSON` plugin, and the one handler that
   returned them unnormalised was corrected.

4. **The incident module was readable by anyone.** `/incidents`,
   `/incidents/:id`, `/incidents/triage` and `/incidents/stats` had no
   authentication at all, despite the navigation hiding the module below
   `officer` and the role hierarchy documenting incidents as an officer duty.
   All four now require it; the public dashboard and analytics pages were
   already served by their own aggregates and are unaffected.

5. **Out-of-range coordinates returned 500.** `?lat=999&lng=999` passed the
   finiteness check and then made MongoDB's `$near` throw. A shared
   `parseCoordinates` helper now range-checks both values and returns 400.

6. **A malformed JSON body returned 500.** `body-parser`'s `SyntaxError` was
   not recognised by the error normaliser and fell through to the bug branch.
   It is now a 400, and an oversized body a 413.

7. **`shannon` could be negative zero.** A one-species community evaluates
   `−(1 · ln 1)` to `-0`. Harmless once serialised, but a negative diversity
   index is meaningless.

8. **Deactivated accounts became unreachable.** Fixing (1) had a side effect:
   the administration screen exists to *show* and *reverse* deactivation, and
   its own dialog says an account is "marked inactive rather than erased" — but
   the new default hid those rows, so an account could be switched off and
   never back on. That screen now opts in with `?includeArchived=true`, while
   assignee pickers keep the default and correctly omit deactivated staff.
   Caught by re-reading the admin UI after the change, and now covered by a
   regression test.

9. **No committed tests.** `package.json` declared a `test` script pointing at
   `test/**/*.test.js`, but no test files existed, so `npm test` failed. The
   script also depended on the shell expanding the glob, which broke when run
   from the repository root; it is now plain `node --test`. The suite described
   above now exists.

10. **No favicon**, so every page load logged a 404 in the browser console.

---

## What was built

| | Files | Lines |
|---|---|---|
| Backend (`backend/src`) | 83 | ~10,900 |
| Tests (`backend/test`) | 7 | ~1,300 |
| Frontend (`frontend/app`, `components`, `lib`, `hooks`) | 96 | ~18,500 |
| Documentation (`docs/`, README) | 6 | ~1,900 |

134 route handlers · 16 MongoDB collections · 12 modules · 18 routes.

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
Nominatim — **none require a key**. OpenWeatherMap and eBird activate if a key
is supplied. Every call has a timeout and a local fallback; the system works
fully offline.

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

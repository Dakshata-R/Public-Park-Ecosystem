# GreenPulse

**Public Park Ecosystem Health Monitoring System & Urban Biodiversity Mapping Portal**

A full-stack platform for monitoring the ecological health of urban parks: live
environmental sensing, computed biodiversity indices, GIS mapping, AI image
analysis, citizen reporting, and priority-based incident response.

```
GreenPulse---Escosystem/
├── frontend/     Next.js 13 · TypeScript · Tailwind · shadcn/ui · Leaflet · Recharts
├── backend/      Node.js · Express · MongoDB (Mongoose) · JWT
└── docs/         Architecture, API reference, algorithms, viva preparation
```

---

## Running it

Two terminals. **No MongoDB installation is required** — the backend boots an
in-memory instance and seeds it automatically.

### Terminal 1 — backend

```bash
cd backend
npm install
npm run dev
```

→ API on **http://localhost:5000/api**

### Terminal 2 — frontend

```bash
cd frontend
npm install
npm run dev
```

→ Web on **http://localhost:3000**

### Sign-in accounts

All four use the password **`greenpulse123`**. The sign-in page lists them and
signs you in with one click.

| Role | Email | Can do |
|---|---|---|
| Administrator | `admin@greenpulse.gov` | Everything, including users and system settings |
| Ecologist | `ecologist@greenpulse.gov` | Curate species records, verify sightings |
| Park Officer | `officer@greenpulse.gov` | Incidents, work orders, assets, sensors |
| Citizen | `citizen@greenpulse.gov` | Report issues, log wildlife sightings |

The dashboard, map and biodiversity catalogue are public — no sign-in needed.

### Using a persistent database (optional)

Copy `backend/.env.example` to `backend/.env` and set `MONGODB_URI` to a local
`mongod` or an Atlas cluster. Then `npm run seed` once to populate it.

---

## What is in the seeded dataset

| | |
|---|---|
| Parks | 6 |
| Species catalogue | 30 (Indian urban biodiversity, incl. 3 invasives) |
| Park assets | 231 trees, plants, benches, lakes, paths, lights |
| Sensors | 32 across six measurement types |
| Sensor readings | ~3,000 (48 h of history per device) |
| Species observations | 420, spanning 14 months |
| Incidents | 34 with full status timelines |
| Work orders | 38 |
| Citizen reports | 41 |
| AI detections | 30 |

The generator is seeded, so the same dataset comes back on every reseed — a
figure quoted in a presentation will still be there afterwards.

---

## The twelve modules

| # | Module | Where |
|---|---|---|
| 1 | Ecosystem Monitoring Dashboard | `/dashboard` |
| 2 | GIS & Urban Biodiversity Mapping | `/map` |
| 3 | Park Asset Management | `/assets` |
| 4 | Biodiversity Management | `/biodiversity` |
| 5 | AI Ecosystem Monitoring | `/ai` |
| 6 | Environmental Sensor Monitoring | `/sensors` |
| 7 | Citizen Engagement Portal | `/citizen` |
| 8 | Incident & Alert Management | `/incidents` |
| 9 | Maintenance Management | `/maintenance` |
| 10 | Analytics & Reports | `/analytics` |
| 11 | AI Environmental Assistant | `/assistant` |
| 12 | Administration | `/admin` |

---

## What makes this more than CRUD

**Real ecological mathematics.** Biodiversity is not a stored number — it is
computed from field observations using Shannon–Wiener, Pielou's evenness,
Simpson, Margalef and Berger–Parker, with per-taxocene breakdowns. The
Biodiversity page includes a calculator so the formulas can be exercised with
arbitrary input.

**Live public data, scored by our own code.** Open-Meteo returns raw pollutant
*concentrations*; the CPCB breakpoint mathematics that turns them into an AQI is
implemented in this project (`backend/src/services/aqi.service.js`). The sensor
simulator anchors itself to live weather every 15 minutes, so a simulated probe
tracks genuine conditions at that coordinate.

**Computed priority, not typed-in priority.** Incident ranking comes from a
weighted formula over hazard type, severity, log-scaled exposure, exponential
ageing against a per-type response target, and community signal. The triage
queue shows the factor breakdown, so the ordering is arguable rather than
asserted.

**A three-detector anomaly ensemble.** Z-score, modified z-score (median
absolute deviation), and Tukey's IQR fence vote; two of three flags a reading.

**Retrieval that cites its sources.** The assistant ranks database documents by
TF-IDF cosine similarity and shows which records each answer drew on, with
scores.

**Honest about the AI.** The vision pipeline's contract is real — class
vocabulary, softmax vector, argmax, severity mapping, auto-escalation rule — but
the logits come from a deterministic surrogate rather than trained weights, and
the interface says so. Setting `AI_MODEL_ENDPOINT` swaps in a served model
through the same code path.

---

## Public API integrations

Four work with **no API key at all**:

| Service | Used for |
|---|---|
| Open-Meteo Forecast | Current weather and 7-day outlook |
| Open-Meteo Air Quality (CAMS) | Pollutant concentrations → CPCB AQI |
| GBIF | Species occurrence records, taxonomy validation |
| OpenStreetMap Nominatim | Reverse geocoding for report locations |

Two more activate if you supply a key in `backend/.env`: OpenWeatherMap
(`OPENWEATHER_API_KEY`) and eBird (`EBIRD_API_KEY`).

Every upstream call has a timeout and a local fallback. **The system works fully
offline** — readings simply stop being anchored to live data.

---

## Tests

```bash
npm test                         # from the repository root
```

**113 automated tests, all passing, in about thirteen seconds.** No server needs to
be running: each suite starts its own in-memory MongoDB
(`mongodb-memory-server`) and binds the Express app to a free port, so the
tests never touch your development database and can run in parallel.

| Suite | Tests | Covers |
|---|---|---|
| `test/unit/aqi.test.js` | 13 | CPCB sub-indices, band edges, AQI→score inversion, monotonicity |
| `test/unit/biodiversity.test.js` | 12 | Shannon, Pielou, Simpson, Margalef, dominance, composite score |
| `test/unit/anomaly.test.js` | 11 | Three-detector majority vote, constant history, zero IQR, short history |
| `test/unit/priority.test.js` | 14 | Triage weighting, ageing, clamping, queue ordering |
| `test/unit/serialisation.test.js` | 12 | ObjectId/Date wire normalisation (regression) |
| `test/integration/auth.test.js` | 13 | Registration, sign-in, JWT tampering, role escalation, password rotation |
| `test/integration/modules.test.js` | 37 | All twelve modules, the full incident workflow, RBAC, pagination, soft delete |

Expected values in the unit suites are derived from the published formulae
rather than captured from the implementation, so a regression cannot pass by
agreeing with itself. The integration suites seed the real dataset and drive
the API over HTTP — nothing is stubbed.

---

## Documentation

| Document | Contents |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | System design, layers, data flow, schema |
| [`docs/algorithms.md`](docs/algorithms.md) | Every formula, with derivations and worked examples |
| [`docs/api-reference.md`](docs/api-reference.md) | All endpoints, roles, request and response shapes |
| [`docs/demo-script.md`](docs/demo-script.md) | A 10-minute walkthrough for the review |
| [`docs/viva-questions.md`](docs/viva-questions.md) | Anticipated questions with answers |

---

## Technology

**Frontend** — Next.js 13 (App Router), TypeScript, Tailwind CSS, shadcn/ui,
TanStack Query, React Hook Form + Zod, Leaflet, Recharts, Framer Motion, jsPDF.

**Backend** — Node.js, Express, MongoDB with Mongoose, JWT, bcrypt, Zod, Helmet,
rate limiting.

---

## Honest scope

This is a semester prototype, and it is worth being clear about the boundaries:

- **No physical sensors.** The ingestion path is real; the readings are
  generated (anchored to live weather where the network allows).
- **No trained vision models.** The inference contract is real; the weights are
  a deterministic surrogate.
- **The assistant retrieves but does not generate.** TF-IDF ranking is genuine;
  answers are composed from templates over retrieved records.
- **JWT in `localStorage`.** Appropriate for a cross-origin prototype; a
  production deployment should move to httpOnly cookies.

Each of these is documented at the point in the code where it matters.

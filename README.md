# GreenPulse

**Public Park Ecosystem Health Monitoring System & Urban Biodiversity Mapping Portal**

GreenPulse monitors the ecological health of six public parks in Bengaluru. It
combines live air-quality and weather observations, biodiversity records
published through GBIF, park boundaries and assets mapped in OpenStreetMap, and
image analysis with a trained neural network. On top of that data it provides
incident triage, maintenance planning, citizen reporting, analytics and a
retrieval-based assistant.

```
GreenPulse---Escosystem/
├── backend/    Node.js · Express · MongoDB (Mongoose) · TensorFlow.js · JWT
├── frontend/   Next.js 13 · TypeScript · Tailwind · shadcn/ui · TanStack Query · Leaflet · Recharts
└── docs/       Architecture, algorithms, API reference, demo script, viva preparation
```

---

## What is real, and what is not

The interface labels the origin of every value. In short:

| Data | Source | Status |
|---|---|---|
| Parks — boundaries, areas, facilities | OpenStreetMap (Overpass API) | **Real**, committed snapshot |
| Park assets — trees, benches, lamps, paths, water, structures | OpenStreetMap | **Real positions**; condition scores and maintenance history are demo values |
| Species, IUCN status, photographs | GBIF species API | **Real**, committed snapshot |
| Species observations | GBIF occurrence records inside each park boundary since Jan 2023, counted per month | **Real** (counts are records, not individuals) |
| Invasive / introduced species | GRIIS India checklist (Darwin Core archive) | **Real** |
| Air quality (CPCB AQI), temperature, humidity | Open-Meteo forecast model and CAMS air quality, fetched live | **Real** "virtual sensors" |
| Noise, soil moisture, water quality sensors | Generated (AR(1) + daily cycle + noise) | **Simulated**, labelled as such |
| AI image analysis | MobileNetV2 (ImageNet) run on the server with TensorFlow.js, plus pixel colour analysis | **Real inference** — see accuracy below |
| User accounts, citizen reports, incidents, work orders | Seeder | **Demo records**, flagged `demo: true` and badged in the UI |
| Ecological reports | Generated from the data above | **Computed** |

The open-data snapshot lives in `backend/src/seed/data/open-data/` with its
attribution in `ATTRIBUTION.md`, so the app starts and seeds **offline**. Run
`npm run data:refresh` in `backend/` to rebuild it from the live APIs.

---

## Requirements

- **Node.js 18.17 or newer** (20 recommended — see `.nvmrc`)
- **npm**
- **MongoDB** — optional for development (an in-memory database starts
  automatically), required for production (e.g. MongoDB Atlas free tier)
- Internet access on first run, to download the vision model once (~14 MB).
  Live Open-Meteo data, map tiles, species photographs, the GBIF cross-check
  and address lookup always need a connection; everything else works offline.
  If the model is not available when the database is seeded, the seeded AI
  detections are skipped — run `npm run model:download` in `backend/`, then
  restart (the in-memory database reseeds) or run `npm run seed`.

No API keys are required. Adding an `ANTHROPIC_API_KEY` upgrades the Eco Assistant to Claude.

---

## Setup and run (development)

```bash
git clone <repository-url>
cd GreenPulse---Escosystem

# 1. Install both halves
npm run setup                     # = npm install in backend/ and frontend/

# 2. Environment files
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

The defaults work as they are: a blank `MONGODB_URI` starts an in-memory
MongoDB, seeded on every boot.

```bash
# 3. Terminal 1 — API on http://localhost:5000/api
npm run backend:dev

# 4. Terminal 2 — web app on http://localhost:3000
npm run frontend:dev
```

On first start the backend seeds the database (about 10 seconds) and loads the
vision model in the background — downloading it once if it is not cached. You
can pre-download it with `npm --prefix backend run model:download`.

### Sign-in accounts (demo)

All use the password **`greenpulse123`**. The login page lists them when
`NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS=true` (the default in `.env.example`).

| Role | Email | Can do |
|---|---|---|
| Administrator | `admin@greenpulse.gov` | Everything, including users and system settings |
| Ecologist | `ecologist@greenpulse.gov` | Species records, sighting verification, AI reviews, reports |
| Park Officer | `officer@greenpulse.gov` | Incidents, work orders, assets, sensors, exports |
| Citizen | `citizen@greenpulse.gov` | Report issues, log sightings, upvote, analyse images |

The dashboard, map and biodiversity catalogue are public.

### Using a persistent local database

Set `MONGODB_URI=mongodb://127.0.0.1:27017/greenpulse` in `backend/.env`, then
seed it once (this **replaces** everything in that database):

```bash
npm run seed
```

---

## Environment variables

### `backend/.env`

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PORT` | no | `5000` | HTTP port |
| `NODE_ENV` | no | `development` | `production` enables the safety checks below |
| `MONGODB_URI` | **production** | blank → in-memory | MongoDB connection string |
| `JWT_SECRET` | **production** | dev placeholder | Token signing secret, ≥ 32 random characters |
| `JWT_EXPIRES_IN` | no | `7d` | Token lifetime |
| `CORS_ORIGIN` | **production** | `http://localhost:3000` | Comma-separated frontend origin(s) |
| `AUTO_SEED` | no | `true` | Seed when the database has no parks |
| `SENSOR_SIMULATION_INTERVAL_MS` | no | `60000` | Sensor refresh interval; `0` disables |
| `LOG_LEVEL` | no | `info` | `debug` · `info` · `warn` · `error` · `silent` |
| `OPENWEATHER_API_KEY` | no | — | Optional alternative weather source |
| `EBIRD_API_KEY` | no | — | Optional recent bird sightings near a park |
| `ANTHROPIC_API_KEY` | no | — | Eco Assistant answers with Claude (`claude-opus-5-5`), using tools that read the live park data; blank → built-in retrieval engine |

In production the server **refuses to start** without `MONGODB_URI`, a strong
`JWT_SECRET` and `CORS_ORIGIN`, and prints what is missing.

### `frontend/.env.local`

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | **production build** | `http://localhost:5000/api` in development | Base URL of the API, including `/api`. Baked in at build time. |
| `NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS` | no | `false` | Show the demo sign-in accounts on the login page |

---

## Tests and checks

```bash
npm test                       # backend: unit + integration suites (in-memory MongoDB, real vision model)
npm run typecheck              # frontend: tsc --noEmit
npm --prefix frontend run build
npm --prefix backend run eval:vision   # AI accuracy report on 22 labelled photographs
```

The integration suites seed the real snapshot into their own in-memory MongoDB
and drive the API over HTTP; live Open-Meteo history is skipped under test so
the suite does not depend on the network (the vision model must be cached or
downloadable).

### AI accuracy (`npm run eval:vision`)

Measured on 22 openly licensed Wikimedia Commons photographs with known labels.
These are the same photographs the task thresholds were calibrated on, so the
figures are optimistic — there is no separate held-out test set:

| Task | Correct |
|---|---|
| Fire & smoke | 9 / 11 (no false alarms on sunsets or autumn leaves) |
| Tree & foliage health | 3 / 3 |
| Wildlife | 3 / 3 |
| Plant & fungus | 1 / 2 |
| Litter | **0 / 3** |
| **Overall** | **16 / 22 (73 %)** |

MobileNetV2 is a general ImageNet classifier: it names animals at ImageNet
granularity (an Indian pond heron is its closest class, "bittern"), foliage
health is a colour measurement rather than a diagnosis, and it does not
recognise litter scenes. Every detection therefore enters a human review
queue, and only fire findings may open an incident automatically.

---

## Deployment

The backend needs a long-running Node process (it refreshes sensors on a timer
and holds the vision model in memory), so it is not suited to serverless
functions. A free-tier setup:

**1. Database — MongoDB Atlas.** Create a free cluster, a database user, and
allow network access from your host. Copy the `mongodb+srv://…` string.

**2. Backend — Render.** New → Blueprint → select this repository.
`render.yaml` defines the service (`backend/` root, `npm ci --omit=dev && npm
run model:download` build, `/api/health` health check) and generates
`JWT_SECRET`. Enter `MONGODB_URI` and `CORS_ORIGIN` (your frontend URL) when
prompted. The first boot seeds the database.

**3. Frontend — Vercel** (or Netlify). Import the repository, set the root
directory to `frontend`, and set `NEXT_PUBLIC_API_URL` to
`https://<your-render-service>.onrender.com/api`. For Netlify, `netlify.toml`
at the repository root already sets the base directory.

**4.** Put the frontend URL into the backend's `CORS_ORIGIN` and redeploy it.

Any Node host works the same way: `cd backend && npm ci --omit=dev && npm run
model:download && npm start` with the environment variables above.

---

## The twelve modules

| # | Module | Route |
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

## How it works

**Ecological mathematics on real records.** Shannon–Wiener, Pielou, Simpson,
Margalef and Berger–Parker indices are computed from GBIF occurrence records
for each park, with per-taxon breakdowns.

**CPCB AQI computed here.** Open-Meteo returns pollutant concentrations; this
project applies the CPCB breakpoints with the official averaging periods
(24-hour means for PM2.5, PM10, NO₂, SO₂; 8-hour means for CO and O₃).

**Composite Ecosystem Health Index.** A weighted mean over the sub-indices that
have data. A missing indicator is reported as "no data", never as zero.

**Real image inference.** MobileNetV2 runs on the server (TensorFlow.js,
WebAssembly backend, ~30–80 ms per image). Each task turns ImageNet class
evidence and pixel colour statistics into its own labels, and returns the
evidence with the result.

**Computed priority.** Incident ranking comes from hazard type, severity,
exposure, ageing against a response target, and community upvotes (one per
account).

**Anomaly ensemble.** Z-score, modified z-score (MAD) and Tukey's IQR fence
vote on each reading.

**Retrieval that cites its sources.** The assistant ranks database records by
TF-IDF cosine similarity and composes its answers from templates over those
records; it is not a large language model.

Full derivations are in [`docs/algorithms.md`](docs/algorithms.md).

---

## Limitations

- **No physical sensors.** Air quality, temperature and humidity are real
  observations from gridded models (nearby parks can share a grid cell); noise,
  soil and water readings are simulated.
- **General-purpose vision model.** See the accuracy table above; litter
  detection does not work reliably.
- **GBIF record counts are not population counts**, and recent months are
  incomplete because publication lags observation.
- **Operational records are demonstration data** until the portal is used.
- **JWT in `localStorage`.** A hardened deployment should use httpOnly cookies.
- **Image URLs are fetched server-side.** Private and link-local addresses are
  refused and redirects re-checked, but the DNS lookup and the fetch are
  separate, so a DNS-rebinding race remains possible.

---

## Documentation

| Document | Contents |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | System design, layers, data flow, schema |
| [`docs/algorithms.md`](docs/algorithms.md) | Every formula, with derivations |
| [`docs/api-reference.md`](docs/api-reference.md) | All endpoints, roles, request and response shapes |
| [`docs/demo-script.md`](docs/demo-script.md) | A 10-minute walkthrough |
| [`docs/viva-questions.md`](docs/viva-questions.md) | Anticipated questions with answers |
| [`backend/src/seed/data/open-data/ATTRIBUTION.md`](backend/src/seed/data/open-data/ATTRIBUTION.md) | Data sources and licences |

---

## Data attribution

© OpenStreetMap contributors (ODbL) · GBIF.org and the publishing datasets ·
GRIIS India · Open-Meteo.com (CC BY 4.0) with Copernicus CAMS data · sample
photographs from Wikimedia Commons (credits in
`backend/src/seed/data/sample-images/attribution.json`) · MobileNetV2 by
Google via TensorFlow Hub.

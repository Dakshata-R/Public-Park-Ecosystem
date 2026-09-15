# Build status

Last updated 2026-09-15, branch `submission-ready`.

The prototype has been taken to a submission-ready system: placeholder and
simulated data replaced with real sources wherever one exists, the AI module
running real inference, every audit finding fixed, and the project verified
from a fresh clone. See [README.md](README.md) for setup and deployment and
[docs/demo-script.md](docs/demo-script.md) for the walkthrough.

---

## Verification (all run, not assumed)

| Check | Result |
|---|---|
| Fresh `git clone` → `npm ci` (backend + frontend) → copy `.env.example` files | succeeded, no manual steps |
| `npm run model:download` from a clean clone | MobileNetV2 downloaded from TensorFlow Hub (~16 s), WASM backend |
| `npm test` (backend unit + integration, in-memory MongoDB) | **151 passed, 0 failed** |
| `npm run typecheck` (frontend) | clean |
| `npm run build` (frontend) | 20 routes generated |
| `npm run eval:vision` | 16/22 (73 %), reproduced from the clean clone |
| Production start with an unsafe config | refused, listing what is missing |
| Browser end-to-end on the production build (Playwright) | see below — no console errors on any page tested |

### End-to-end flows driven in a real browser

1. **Public dashboard** — live Open-Meteo AQI and weather for Bengaluru, GBIF
   biodiversity indices, provenance and demo labels.
2. **Citizen** — signed in, filed an issue at Lalbagh: the park centre and a
   live Nominatim address filled in, stored as `CR-2026-0037` (not demo).
3. **AI** — uploaded a bonfire photograph for *Fire & smoke*: MobileNetV2
   returned *Flames visible* at 99.2 %, the stored image, evidence and model
   card were shown, and incident `INC-2026-0031` opened automatically.
4. **Officer** — assigned that incident through the staff picker, raised
   `WO-2026-0037` (duplicate raise prevented), resolved it; the database shows
   the full timeline.
5. **Sensors** — *Refresh readings* reported new Open-Meteo observations and
   simulated readings separately.
6. **Ecologist** — generated an ecosystem report from data, published it, and
   confirmed it became publicly visible.
7. **Assistant** — the air-quality question routed to the air-quality intent;
   the conversation survived a reload.
8. **Map, biodiversity catalogue, admin** — real OSM parks and GBIF species
   with licensed photographs; demo accounts labelled.
9. **Fresh clone** — the same servers started with `npm run backend` /
   `npm run frontend`; all 13 stored AI images and every API call loaded.

Browser testing found one more defect, now fixed with a regression test: the
alert raised by an AI-opened incident stayed active after the incident was
resolved.

---

## What changed

### Real data instead of placeholders
- **Parks & assets:** six real Bengaluru parks with OpenStreetMap boundaries,
  areas and facilities; assets are the trees, benches, lamps, paths, water
  bodies and structures mapped inside them (condition scores remain demo).
- **Biodiversity:** 587 GBIF species and 37,182 occurrence records inside the
  park boundaries since January 2023; IUCN status (Not Evaluated kept
  distinct); invasive flags from the GRIIS India archive; CC photographs.
- **Sensors:** AQI, temperature and humidity are virtual sensors fed by live
  Open-Meteo observations, with 48 h of real history at seed; noise, soil and
  water remain simulated and are labelled.
- **Reports:** generated from recorded data instead of invented findings.
- **Demo records** (users, citizen reports, incidents, work orders) flagged
  `demo: true` and badged in the UI.

### AI module
Hash-based fake predictions replaced by MobileNetV2 inference (TensorFlow.js
WASM, ~30–80 ms) plus pixel colour statistics; uploads and URLs supported,
images stored and served by the API, SSRF guard, auth and rate limit, evidence
and caveats returned with every result, reproducible accuracy evaluation.

### Defects fixed
Reference-code collisions after deletes · unlimited upvotes · public-reporting
switch ignored · officers unable to assign · park filters returning zeros in
aggregations · overdue work orders never marked · missing data shown as 0 ·
eBird key never sent · CPCB AQI reading 500 for values between breakpoint
bands, and hourly values used instead of 24 h/8 h averages · assistant routing
park-named questions to the wrong intent · readable private assistant
conversations · public row-level export · reopened incidents keeping their
resolution time · CORS rejection returning 500 · client without timeouts,
401/429 handling or cache clearing on logout · open redirect via `?next=` ·
errors rendered as empty states across pages · stale detail panels · 0,0
default locations · demo credentials shown in every build.

### Cleanup and deployment
Removed the fictional parks seed, 27 unused UI wrappers and 26 unused
packages; Leaflet CSS bundled instead of loaded from a CDN; `render.yaml`,
root `netlify.toml`, `.nvmrc`, documented `.env.example` files, production
start-up guards; README and all docs rewritten to match the code.

---

## Documented limitations

- Vision accuracy is measured on the calibration photographs (optimistic);
  litter detection does not work reliably (0/3).
- GBIF counts are records, not individuals; recent months are incomplete.
- Open-Meteo values are gridded model output; neighbouring parks can share a
  cell. Noise, soil and water sensors are simulated.
- Operational records are demonstration data until the portal is used.
- JWT in `localStorage`; the image-URL fetch has a DNS-rebinding race.

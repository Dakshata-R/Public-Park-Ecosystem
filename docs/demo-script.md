# Demo Script — 10 minutes

A walkthrough of the running system for a review. It follows the order an
assessor is most likely to care about: what is real, how it is computed, and
what the operational workflow looks like. Timings add up to a little under ten
minutes; the "If asked" notes are for questions, not for reading aloud.

Figures that come from live data (AQI, temperature, sensor counts, health
scores) change from hour to hour. Where this script quotes one, it is marked
"at the time of writing" — read the screen, not the script.

---

## Before you start

### 1. Environment files (first time only)

```bash
npm run setup                               # npm install in backend/ and frontend/
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

The defaults are right for a demo: a blank `MONGODB_URI` starts an in-memory
MongoDB that is seeded on every boot, and `NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS=true`
puts one-click sign-in buttons on the login page.

### 2. Two terminals, from the repository root

```bash
# Terminal 1 — API on http://localhost:5000/api
npm run backend:dev
# wait for "GreenPulse API listening on port 5000"
# and "Vision model ready in … ms (disk cache | downloaded from TensorFlow Hub …)"

# Terminal 2 — web app on http://localhost:3000
npm run frontend:dev
```

On the very first start the backend downloads MobileNetV2 (~14 MB, once) into
`backend/.cache/mobilenet-v2/`. To do that ahead of time — for example the night
before, on good Wi-Fi — run `npm run model:download`.

**Tip for the review itself:** development mode compiles each page the first
time it is opened, which can look like a hang. Either click through every page
once before the assessor arrives, or run the production build instead of
Terminal 2: `npm run build`, then `npm run frontend`.

### 3. Pre-flight check (one minute)

- `http://localhost:5000/api/health` answers `"status":"ok"`.
- `/dashboard` shows a health score and **Live Conditions** shows a real
  temperature and an AQI. If it says **Live data unavailable**, you are offline
  — see [Offline](#offline) below.
- `/ai` → **Detections** shows the 13 sample photographs. If none are there,
  the model was not available when the database was seeded (see Fallbacks).
- The login page lists four **Demonstration accounts**. All use `greenpulse123`.

**Do not edit code while presenting.** `backend:dev` restarts on file changes,
and a restart re-seeds the in-memory database, wiping whatever you created in
the demo.

---

## 1 · The problem, and the honesty statement (20 s)

> "Parks are still managed by periodic walk-throughs, so tree loss, pollution
> and hazards are noticed late, biodiversity isn't recorded systematically, and
> the public has no channel to report problems. GreenPulse monitors six real
> Bengaluru parks. Before I show it: the park boundaries, species records, air
> quality and weather are real open data; the incidents, work orders and
> citizen reports are demonstration records; three sensor types are simulated.
> The interface labels which is which everywhere."

---

## 2 · Dashboard — real data, labelled (75 s)

Open `/dashboard` (no sign-in needed).

Point at the grey **data notice** under the title, then at the badges.

> "Every value says where it comes from. 'Live · Open-Meteo' is a real
> observation, 'GBIF records' is published occurrence data, 'Simulated' is
> generated, 'Demo record' is a demonstration."

Point at the **Ecosystem Health Index** gauge and **Weighted contributions**.

> "The index is a weighted mean of five sub-indices — air, water, soil, tree
> health and biodiversity — over the ones that have data. The bars show each
> one's share, so you can see which indicator is pulling the score down. A
> missing indicator is left out, never counted as zero."

Point at **Live Conditions**.

> "This is live. Open-Meteo returns raw CAMS pollutant concentrations; our code
> averages them over the CPCB periods — 24 hours for particulates, 8 hours for
> ozone and CO — applies the CPCB breakpoint tables, and takes the **maximum**
> sub-index. These bars are the per-pollutant sub-indices we computed."

Change the park filter (top right) to **Freedom Park**, then back to
**All parks (citywide)**.

> "Park by park. Freedom Park scores lowest mainly because its biodiversity
> sub-index is almost zero: GBIF has a single record inside its boundary. That's
> missing survey effort, not a dead park — and it has no mapped trees or water,
> so those sub-indices show 'No data' rather than zero."

**If asked "is that really live?"** — the panel shows **Updated HH:MM IST**;
open `http://localhost:5000/api/integrations/air-quality` in a tab to show the
raw concentrations, the averages and the `method` string.

**If asked why the Air Quality KPI and the panel differ by a few points** — the
KPI is the mean of the six parks' stored virtual-sensor readings; the panel is a
fresh query for the selected location (the mean park position when no park is
selected).

**If asked about the species tile ("587 of 596")** — 587 species have GBIF
records inside the boundaries; the catalogue also keeps 9 curated regional
species that GBIF has not recorded there, which do not affect any index.

---

## 3 · Map — OpenStreetMap and GBIF (40 s)

Open `/map` (**Biodiversity Map** in the sidebar).

> "Park boundaries, trees, water bodies and trails are the real OpenStreetMap
> features inside each park. The wildlife layer is GBIF occurrence records. None
> of this is stored for the map — every layer is drawn from the module that
> owns the data."

Click a park boundary, then a tree pin. Point at the **Selected** panel's
provenance badge and at **Condition (demonstration value)**.

> "The tree's position and species are real; its condition score is a demo
> value, and the panel says so."

Toggle **Pollution Hotspots** off and on.

> "These circles are demonstration incidents, sized by their computed priority
> score."

**If asked about the coordinate order** — GeoJSON is `[lng, lat]`, Leaflet is
`[lat, lng]`; conversion lives only in `frontend/lib/api/geo.ts`.

---

## 4 · Biodiversity — records, not individuals (80 s)

Open `/biodiversity`, **Indices** tab.

> "These indices are computed from about 37,000 GBIF occurrence records, and the
> page is explicit that a record is not an animal: ten birders reporting the
> same kite are ten records."

Point at the four headline tiles, then **How the score is derived**
(Shannon–Wiener, Pielou, Gini–Simpson, Margalef, Berger–Parker).

Point at **Invasive records** (GRIIS India) and **Threatened**.

> "Invasive flags come from the GRIIS India checklist; conservation status from
> IUCN via GBIF."

Scroll to **Index Calculator**. Type `100, 1, 1, 1` → **Compute** (H′ ≈ 0.16,
J′ ≈ 0.12). Then `25, 25, 25, 25` → **Compute** (H′ ≈ 1.39, J′ = 1.00).

> "Same four species, completely different ecological health. That's why
> evenness has its own weight in the score."

Switch to **Catalogue**, open any insect or plant.

> "Most insects and plants have never been assessed by the IUCN, so they are
> 'Not Evaluated' — deliberately not 'Least Concern', which would be a false
> claim. The species sheet can also cross-check the record against GBIF live."

**If asked "isn't pooling birds and plants wrong?"** — yes, methodologically;
scroll to **Per-Taxocene Indices**, which computes the same mathematics within
each class. That is the figure to quote when comparing sites.

**If asked why Sankey Tank outscores Lalbagh on biodiversity** — sampling
artefact. With few records most species appear once or twice, so evenness
approaches 1. Lalbagh holds about nine records in ten.

---

## 5 · Sensors — virtual vs simulated (50 s)

Sign in first: **Sign in** (top right) → **Park Officer**.

Open `/sensors`. Read the blue notice, or paraphrase:

> "There is no hardware. Air-quality, temperature and humidity sensors are
> virtual: every stored reading is a real Open-Meteo observation for that
> park's coordinates. Noise, soil moisture and water quality have no public
> source at park scale, so they are simulated to exercise the same ingestion,
> anomaly and alert pipeline a real gateway would use."

Point at the **Deployed** tile hint (at the time of writing "18 Open-Meteo · 15
simulated") and the source badge on each card.

Click **Refresh readings**. Read the toast.

> "Virtual sensors store a value only when Open-Meteo's observation time has
> moved on, so often this says zero new observations — that's correct, it
> refuses to duplicate or invent readings. Simulated sensors add one reading
> each."

Open a **Noise (simulated)** card: the chart, the dashed warning thresholds,
any red **Flagged anomaly** points, and the **Anomaly detection** list (it may
be empty — spikes are rare).

> "Three detectors vote — z-score, a MAD-based modified z-score, and Tukey's
> IQR fence. Two of three flags a reading."

**If asked "why do two parks show the same AQI?"** — CAMS and the forecast
model are gridded; one cell can cover several nearby parks.

---

## 6 · AI — real inference, honest accuracy (90 s)

Open `/ai` (**AI Monitoring**). Point at the blue notice.

> "This is real inference: Google's pre-trained MobileNetV2 runs on the server
> with TensorFlow.js. It was not trained on park imagery, so each task pools
> ImageNet classes — all 59 bird classes into 'bird' — and adds pixel colour
> statistics. The measured accuracy is on the page: 16 of 22 labelled photos
> overall, and **litter 0 of 3**. Those 22 are the same photos the thresholds
> were calibrated on, so treat it as optimistic."

**Fire.** On **Analyse**, pick **Fire & smoke detection**. **Upload a photo** →
`backend/src/seed/data/sample-images/eval-fire-bonfire.jpg`. Under **Park
(needed for auto-escalation)** choose **Cubbon Park**. Click **Analyse image**.

Point at the result: **Flames visible**, critical, a confidence in the high 90s
at the time of writing, the **Label probabilities**, **Evidence** and **Top
ImageNet classes**.

Scroll to **Escalation decision** — all three checks ticked, and the red box
**Incident INC-… opened at high priority**.

> "Only fire or smoke can open an incident by itself, only at or above the 85 %
> confidence floor, and only with a park so the crew has a location. Every other
> finding waits for a human."

**Wildlife.** Pick **Wildlife recognition**, upload
`wildlife-indian-pond-heron.jpg`, leave the park as **Not specified**, analyse.

> "It says **Bird**, and the detail line says the closest ImageNet class is a
> **bittern**. That's the limit of an ImageNet model: most Indian species aren't
> in its vocabulary, so species are named at ImageNet granularity."

Point at **Escalation decision**: not escalatable, queued for review.

**If asked "so what about litter?"** — open **Model**: the litter task shows
**0/3 correct**. ImageNet recognises a bottle or a bag, not a heap of mixed
waste. It is never allowed to open an incident; fixing it needs training on
labelled litter photos.

**If asked "how would you measure accuracy properly?"** — a held-out labelled
set, much larger than 22 images. The review queue (**Detections** → **Correct**
/ **Wrong**) is how those labels would be collected; **Performance** turns
reviews into observed precision.

**If asked "is the same image always the same answer?"** — yes: fixed weights,
no randomness. An integration test checks that renaming an image does not
change the result and a different image does.

---

## 7 · Incidents — triage, assign, work order, resolve (60 s)

Still signed in as **Park Officer**, open `/incidents`. **Triage queue** is the
default tab; the incident the fire photo just opened is in it.

> "Incidents are ordered by a computed score — hazard, severity, exposure,
> urgency and community signal — not by arrival time and not by whoever typed
> 'urgent'."

Click an incident to open the sheet. Walk the **Actions**:

1. **Assign to** → pick a member of staff → **Assign**.
2. **Raise a work order** → the sheet then shows *Work order WO-… is open for
   this incident*.
3. Type a line in **Resolution notes** → **Mark resolved**.

> "Resolving stamps the resolution time, stops the incident ageing and resolves
> its alert."

**If asked about ageing** — urgency is `1 − e^(−t/τ)` with τ the type's
response target: it saturates, so ageing adds at most 10 points and a week-old
vandalism report can never outrank a new fire.

**If asked "can an officer set the priority?"** — no. The API ignores a
priority sent by the client and recomputes it on every write.

---

## 8 · Citizen portal — report and upvote (55 s)

Open the user menu → **Sign out**, then sign in as **Citizen**. Open `/citizen`
(**Citizen Portal**).

Click **Submit a report** → **Issue**, a title and description, choose a park,
**Park centre** for the location → **Submit report**.

> "It gets a CR- reference and waits for an officer."

On **All reports**, click the thumbs-up on someone else's report; click it again
to withdraw.

> "One upvote per account, enforced by a single atomic database update, so a
> double-click or a replay counts once. When a report has become an incident,
> its upvotes feed that incident's community term — log-scaled and weighted at
> 0.10, so popularity can never outrank a hazard."

Point at a card showing **Became incident INC-… — status**.

**If there is time:** sign in as **Park Officer**, click **Review** on your new
report → **Accept**, set incident type, severity and people affected →
**Submit decision**. Accepting an issue opens an incident; accepting a wildlife
sighting writes a verified observation into the biodiversity indices.

---

## 9 · Analytics — a report computed from data (45 s)

Sign in as **Ecologist**. Open `/analytics` → **Reports** tab.

Click **Generate report** → type **Ecosystem health assessment**, **All
monitored parks**, **Last 90 days** → **Generate draft**.

> "The metrics, findings and recommendations are computed from the recorded
> data by stated rules — weakest sub-index below 55, evenness below 0.6,
> invasive records present, and so on. The metrics are frozen with the report,
> so a published report keeps the figures it was written against."

Click **Publish**. Optionally **Export PDF**.

> "Drafts are visible only to ecologists and above; once published, anyone can
> read it."

---

## 10 · Assistant (30 s)

Open `/assistant` (**Eco Assistant**). Under **Try asking**, click *How is the
air quality at Cubbon Park?*

Point at **Sources**.

> "It retrieves with TF-IDF and cosine similarity over the database, then fills
> an answer template from those records and live computations. It is not a
> language model — which means every number is traceable and it can't invent
> one."

**If asked why the park name didn't turn it into a 'parks' question** — a park
name sets the scope; it does not override a more specific intent.

---

## 11 · Administration (30 s)

Sign in as **Administrator**. Open `/admin` → **Settings**.

Point at **Ecosystem Health Index Weights** and **AI auto-escalation confidence
floor**.

> "Weights must sum to 1.00 before they can be saved, and saving re-scores every
> park at once. The escalation floor is the 85 % we saw on the fire photo."

Switch to **System**: **Public API Integrations** (Reachable badges), and
**Maintenance Actions**.

> "No API keys are needed. In production the server refuses to start without a
> real database, a strong JWT secret and a CORS origin, and it refuses to
> reseed."

Close:

> "Real open data scored by our own code, real inference with its accuracy
> measured and stated, and every simulated or demonstration value labelled."

---

## What to say about limitations

Say these before being asked. An assessor who hears them from you moves on.

| Limitation | What to say |
|---|---|
| No physical sensors | "AQI, temperature and humidity are real model observations for the park's coordinates — gridded, so nearby parks can match. Noise, soil and water are simulated. A device would POST to `/api/sensors/:id/readings` and nothing downstream changes." |
| General-purpose vision model | "16 of 22 on photos the thresholds were tuned on, so it's optimistic. Litter is 0 of 3. Species come out at ImageNet granularity. That is why everything goes to review and only fire escalates." |
| GBIF counts are records | "They measure recording effort as much as wildlife. Lalbagh holds about nine in ten records; small samples look artificially even; recent months are incomplete because publication lags." |
| Pooled diversity index | "Methodologically imperfect; the per-taxocene table is the rigorous comparison." |
| Demonstration operational data | "Accounts, incidents, work orders, citizen reports and asset condition scores are demo records flagged `demo: true` — a portal only gets those from real use." |
| Assistant | "Retrieval is real; generation is templates, by design." |
| Security | "The JWT lives in `localStorage`; production should use httpOnly cookies. The image-URL fetcher blocks private addresses and re-checks redirects, but a DNS-rebinding race is still possible." |

---

## Offline

Only two features need the internet at run time: **Live Conditions** and the
**virtual sensors** (Open-Meteo), including **Refresh readings**. Offline, the
panel says **Live data unavailable** and the virtual sensors store nothing — they
turn stale and, after three hours, offline — rather than invent values.

Everything else — seeding from the committed snapshot, the dashboard scores,
biodiversity indices, simulated sensors, incidents, citizen reports, reports,
the assistant and **image analysis** — works offline **once the vision model is
cached** in `backend/.cache/mobilenet-v2/`.

Cosmetic things that also need a connection: the base-map tiles (the data layers
still draw on a blank background), species photographs (hosted by iNaturalist
and others), the GBIF cross-check in a species sheet, and street-address lookup
in the citizen report form.

---

## Fallbacks

| Problem | What to do |
|---|---|
| "Cannot reach the API" on every page | The backend is not running. Start `npm run backend:dev`; the error state says so. |
| Live Conditions says **Live data unavailable** | You are offline. Say so — see [Offline](#offline). |
| Image analysis fails with "model unavailable" (503) | The model is not cached and there is no network. Run `npm run model:download` on a connection; once cached it works offline. |
| **Detections** is empty | The model was unavailable when the database was seeded. Once it is cached, restart the backend (the in-memory database re-seeds) or use `/admin` → **System** → **Reseed database**. |
| The fire photo did not open an incident | Check that a park was selected and that the confidence floor in `/admin` → **Settings** is still 85 %. |
| Data looks wrong mid-demo | `/admin` → **System** → **Reseed database** (development only). Parks, species and observations come back identically; sensor readings and live values differ. It signs everyone out. |
| A page takes seconds to open | Development-mode compilation on first visit. Use the production build for the review. |
| Wrong role for an action | Sign in as **Administrator** — it can do everything. |

---

## Five things worth remembering

1. **Real open data, labelled** — OpenStreetMap parks and assets, GBIF species
   and records, GRIIS invasive flags, Open-Meteo weather and CAMS air quality.
   Demo and simulated values carry a badge.
2. **Our own mathematics on it** — CPCB AQI with averaging periods and the
   maximum operator, Shannon and evenness on GBIF records, a weighted composite
   that ignores missing data, a two-of-three anomaly vote, bounded ageing in
   triage.
3. **Real inference, measured** — MobileNetV2 on the server; 16/22 on
   calibration photos, litter 0/3; only fire escalates.
4. **Records are not individuals** — and effort differs hugely between parks.
5. **It runs anywhere** — no database install, no API keys; offline except for
   live conditions once the model is cached.

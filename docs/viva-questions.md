# Viva Preparation

Anticipated questions with answers. Grouped by how likely they are to come up.
Every number here comes from the code, the committed data snapshot, or
`npm run eval:vision` — and the weak spots are stated before an examiner finds
them.

---

## A · The questions you will almost certainly get

### "Is the data real?"

Mostly — and the interface labels which is which.

**Real, from open data** (committed snapshot in
`backend/src/seed/data/open-data/`, rebuilt with `npm run data:refresh`):

- **Six Bengaluru parks** — Cubbon Park, Lalbagh Botanical Gardens, Sankey Tank
  Park, Jayaprakash Narayan Park, Freedom Park and Coles Park — with their
  **OpenStreetMap** boundaries, computed areas and mapped facilities.
- **Assets** — the trees, benches, street lamps, paths, water bodies and
  structures mapped inside those boundaries in OpenStreetMap.
- **587 species and 37 182 occurrence records** from **GBIF**, recorded inside
  each park boundary since 1 January 2023, counted per species per month, with
  IUCN categories, CC-licensed photos, and introduced/invasive flags from the
  **GRIIS India** checklist.

**Real, live:** air quality (CAMS pollutant concentrations turned into a CPCB
AQI by our own code), temperature and humidity from **Open-Meteo** for each
park's coordinates, plus 48 hours of real hourly history loaded at seed time.

**Real inference:** the AI module runs a pre-trained MobileNetV2 on the actual
pixels of the submitted image.

**Not real, and flagged `demo: true`:** user accounts, citizen reports,
incidents, work orders, the alerts derived from them, and asset condition scores
and maintenance histories. A municipal system only gets those records from real
use. **Simulated:** the noise, soil-moisture and water-quality sensors, labelled
"Simulated" wherever they appear.

---

### "Is the AI actually working, or is it fake?"

It is real inference, with limits I can quantify.

**What it is.** Google's MobileNetV2 (1.0, 224×224) ImageNet checkpoint from
TensorFlow Hub, run on the server with TensorFlow.js on the WebAssembly backend —
about 30–80 ms an image on a laptop CPU. It produces a genuine 1000-class
probability distribution. Change the image and the answer changes; the same
image under a different name gives the same answer, and an integration test
checks both.

**What it is not.** It was not trained or fine-tuned on park imagery — I had no
labelled dataset. ImageNet has no class for "chlorosis" or "overflowing bin", so
each task *pools* ImageNet classes into groups — the 59 bird classes become one
"bird" signal — and, where ImageNet has nothing useful, uses pixel colour
statistics: HSV bands for green, yellow and brown foliage, and flame and smoke
chromaticity gated by the network's own fire evidence. The scores are normalised
into a probability vector. Every weight is in `ai-inference.service.js` and
every result returns the evidence it used.

**How well it works.** `npm run eval:vision` over 22 openly licensed Wikimedia
Commons photos:

| Task | Correct |
|---|---|
| fire / smoke | 9 / 11 |
| foliage health | 3 / 3 |
| wildlife | 3 / 3 |
| plant | 1 / 2 |
| litter | **0 / 3** |
| overall | 16 / 22 (73 %) |

**If they push:** those constants were calibrated on the same 22 photos, so 73 %
is in-sample and optimistic, and 22 images is far too few for a real error rate.
Litter detection does not work on the evaluation photos — a heap of mixed waste
is not an ImageNet object. That is why every detection enters a human review
queue, and why **only a fire or smoke finding** — at or above the 85 % confidence
floor, with a park selected — can open an incident on its own.

---

### "Why is the AQI the maximum of the sub-indices, not the average?"

Because air is only as clean as its worst pollutant. Averaging lets one
hazardous pollutant hide behind five clean ones.

Concretely: ozone at index 180 with everything else at 20 averages to about 47 —
that reads "Good" when the air is "Moderate" and unsafe for anyone with a
respiratory condition. The maximum operator is what the CPCB specifies, for
exactly this reason.

---

### "Open-Meteo gives you hourly numbers. Is your AQI computed correctly?"

Three details that are easy to get wrong, all handled in `aqi.service.js`:

1. **Averaging periods.** The CPCB index is defined on 24-hour means for PM₂.₅,
   PM₁₀, NO₂ and SO₂ and 8-hour means for CO and O₃. I average the hourly CAMS
   series over those windows and only count a pollutant with at least 75 % of the
   hours present. Applying the table to one hour would exaggerate midday ozone.
2. **Truncation.** The CPCB bands have gaps at their printed precision — PM₂.₅
   `[0, 30]` then `[31, 60]`. A value of 30.9 falls in neither and, naively,
   reads as AQI 500. Concentrations are truncated to the table's precision first
   (whole µg/m³; one decimal for CO), so 30.9 becomes 30 → index 50.
3. **Units.** Open-Meteo gives CO in µg/m³; the CPCB table uses mg/m³. It is
   divided by 1000 — otherwise every CO sub-index would be off by a factor of a
   thousand.

If there is too little data for any pollutant, the AQI is `null` and the API
says so; it never reports "AQI 0 — Good".

---

### "How is the biodiversity score calculated?"

It combines four normalised components:

```
Score = 100 · (0.35·Ĥ + 0.25·J′ + 0.20·R̂ + 0.20·Ĉ)
```

Shannon carries the largest weight because it is the only term reacting to
richness *and* evenness simultaneously. Evenness is separated out so a park
dominated by one species cannot score well on richness alone. Richness still
matters on its own (capped at a reference of 40 species), and the conservation
component rewards records of Near Threatened or rarer species. "Not Evaluated"
is kept separate from "Least Concern" and neither adds to the score.

**The demonstration:** on the Biodiversity page, the Index Calculator takes an
arbitrary abundance vector. `100, 1, 1, 1` gives H′ = 0.16, J′ = 0.12.
`25, 25, 25, 25` gives H′ = 1.39, J′ = 1.00. Same richness, entirely different
ecological health.

---

### "Where does the live data come from, and what happens if it fails?"

Open-Meteo's forecast API for weather and its CAMS-based air-quality API for
pollutant concentrations — no API key. GBIF and Nominatim are also called live
for species cross-checks and reverse geocoding.

**On failure:** every call has an 8-second timeout and returns
`{ok: false, reason}` instead of throwing; the Live Conditions panel says
"unavailable" and why. The live sensors then store **nothing** — no fallback
constants, no invented values. They go stale, and after three hours without data
they are marked offline and drop out of scoring. Parks, species, observations
and assets come from the committed snapshot, so the app still seeds and runs
offline; only the live readings stop.

---

### "Why do incidents need a computed priority? Why not let officers set it?"

Three reasons.

**Consistency.** Two officers filing the same incident type would rank it
differently. A formula does not.

**Auditability.** The triage view shows the factor breakdown, so an officer can
see *why* something ranks where it does and argue with the inputs rather than the
verdict.

**Starvation.** A manually-set priority never changes. An unattended incident
would sit at the bottom forever. The ageing term `Û(t) = 1 − e^(−t/τ)` makes it
climb — but saturates, so a week-old vandalism report can never outrank a new
fire. That bound is deliberate; linear ageing would produce exactly that failure.

---

## B · Likely follow-ups

### "Are the sensors real?"

There are no physical sensors — the hardware layer was out of scope. Each sensor
declares its `source`:

- **`open-meteo`** (AQI, temperature, humidity): a *virtual* sensor. Every stored
  reading is a real Open-Meteo observation for the park's coordinates, ingested
  only when the upstream observation time advances.
- **`simulated`** (noise, soil moisture, water quality): no public source measures
  these at park scale, so an AR(1) process with a daily cycle, Gaussian noise and
  rare spikes generates them — enough to exercise ingestion, anomaly detection
  and alerting.
- **`device`**: a physical gateway would POST to `/api/sensors/:id/readings`. Only
  device sensors accept posted readings.

**Limitations to state.** CAMS and the forecast model are gridded model output,
not a monitor in the park; their cells are far larger than a park, so nearby
parks can receive identical values. And the EHI's air component averages the
AQI score with the noise score, so part of it is simulated. Water and soil
sub-indices are entirely simulated.

---

### "Why three anomaly detectors instead of one?"

Each fails differently.

The **z-score** is cheap and interpretable, but σ is itself inflated by the
outliers it should be detecting — one extreme value raises the threshold enough
to hide itself.

The **modified z-score** uses median absolute deviation, which has a 50 %
breakdown point, so it is not fooled by a handful of extremes. The constant
0.6745 is Φ⁻¹(0.75), which makes MAD a consistent estimator of σ for normal data
— that is why the threshold 3.5 is comparable to the z-test's 3.

**Tukey's fence** assumes no distribution at all, which matters for AQI where the
upper tail is genuinely long and non-normal.

Requiring two of three cuts the false-positive rate any one produces on noisy,
non-stationary field data. Detection is suppressed until a sensor has 8 readings
of history.

---

### "Why is exposure logarithmic in the priority formula?"

Because the marginal significance of an additional affected person falls
sharply. The difference between 10 and 100 people affected is enormous; between
4,000 and 4,090 it is nothing. A linear term would let a single large-park
incident permanently dominate the queue regardless of hazard.

---

### "GBIF counts — are those animals?"

No, and the interface says "records", not "individuals". A GBIF row in this
project is one species in one park in one month, and its count is the number of
occurrence records — mostly eBird checklists and iNaturalist observations. Ten
birders reporting the same kite give ten records.

That has consequences I would point out myself:

- **Effort dominates.** Lalbagh holds 33 803 of the 37 182 records, so the
  citywide index is essentially Lalbagh's. Freedom Park has a single record.
- **Small samples look even.** Sankey Tank (96 records) scores 77.3 and
  Lalbagh (33 803 records) 72.1. With few records most species appear once or
  twice, evenness approaches 1, and the score rises. That is a sampling artefact,
  not evidence that Sankey Tank is more biodiverse.
- **Recorders' preferences show.** Conspicuous birds are over-recorded relative
  to insects and plants.

A defensible comparison needs structured surveys with equal effort per park.

---

### "Isn't pooling birds and plants into one diversity index methodologically wrong?"

Largely, yes — and we say so in the interface rather than hoping nobody notices.

Ecologists compute diversity within a **taxocene**: one taxonomic group surveyed
by one method. Pooling mixes units of survey effort, so the pooled index partly
measures survey method.

We report the pooled score because a park manager needs one comparable number per
park — but the API also returns `byClassIndices`, the same mathematics applied
within each class, and the page renders it. That is the figure to quote when
comparing sites rigorously.

---

### "Why do only verified observations count?"

Because otherwise one enthusiastic — or mistaken — citizen could move a park's
biodiversity score. A sighting a citizen logs is unverified until an ecologist
verifies it, or until an officer accepts the citizen report, which writes a
verified observation. Records created by ecologists, officers and admins are
verified on entry.

The GBIF rows are imported as verified: they are already published records, and
re-verifying tens of thousands of them by hand in the portal would not be
meaningful. Their quality is GBIF's and the publishing datasets'.

---

### "How accurate is the litter detector, honestly?"

On the three evaluation photos — a garbage dump, a plastic bottle and an
overflowing bin — it answered "No litter objects recognised" every time: 0 / 3.
ImageNet recognises discrete objects such as a bottle or a plastic bag in a
clear shot; it has no concept of a litter heap, and in cluttered scenes that
evidence is too weak. The result says so in its `notes`, it is never allowed to
open an incident, and fixing it properly means training on labelled litter
images.

The wildlife task has a related limit: species are named at **ImageNet
granularity**. An Indian pond heron is reported as a "Bird" whose closest
ImageNet class is a bittern; most Indian species are not in ImageNet at all.

---

### "The image URL is fetched by your server. Isn't that a security hole?"

It would be — it is a classic server-side request forgery vector — so
`vision.service.js` guards it:

- only `http` and `https`;
- the host is resolved and refused if **any** address is loopback, private
  (10/8, 172.16/12, 192.168/16), link-local (169.254/16, where cloud metadata
  lives), CGNAT, IPv6 unique-local or link-local, multicast or unspecified;
- redirects are not followed automatically — each hop (at most 3) is re-validated,
  so a public URL cannot bounce the server inwards;
- 15-second timeout, 8 MB ceiling, and only bytes that really are JPEG or PNG are
  decoded.

Analysis also requires an account and is rate limited to 20 per account per
minute, because it is CPU-bound and stores an image. **Residual risk I would
admit:** the address is checked with one DNS lookup and the fetch resolves again,
so a DNS-rebinding attacker could in principle win that race. Pinning the fetch
to the validated address would close it.

---

### "How do you prevent alert spam?"

Alerts are keyed by the *condition*, not the event. A sensor that stays out of
range produces a reading every refresh; each one finds the existing active alert
by `dedupeKey`, increments its occurrence counter, and escalates the severity if
the condition has worsened — rather than creating a new row.

When the sensor returns to range, `autoResolve` closes the alert without anyone
touching it. Anomaly alerts are deduplicated per sensor per hour.

---

### "Can one person inflate a report's upvotes?"

No. Each report stores `upvotedBy`, and the upvote is a single conditional update
— "add this user and increment, only if this user is not already there" — so a
repeat, or two rapid clicks, count once. The voter list is never sent to clients.
The count is mirrored onto the linked incident, where it feeds the priority
formula's community term — which is log-scaled and weighted at 0.10, so even a
popular report cannot outrank a genuine hazard.

---

### "Why do some scores show a dash instead of a number?"

Because missing data is `null`, never 0. Jayaprakash Narayan Park has no water
body and no trees mapped in OpenStreetMap, so it has no water sensor and no tree
assets: its water and tree sub-indices are `null`, and its Ecosystem Health Index
is the weighted mean of what it *does* have. Substituting zeros would grade it
down for the absence of data, and a zero AQI would read as perfectly clean air.

---

### "What stops a user making themselves an admin?"

The registration endpoint never reads `role` from the request body — it is
hard-coded to `citizen`. Elevated roles are granted only through the admin
module, which itself requires the admin role. An admin also cannot change their
own role or deactivate their own account, which prevents locking the platform
out of administration. The role is read from the database on every request, not
trusted from the token.

---

### "Where is the JWT stored?"

In `localStorage`. It is the pragmatic choice for a separately hosted API with no
CSRF handling, but it means any successful XSS could read the token. A production
deployment should move to an httpOnly, `SameSite` cookie with CSRF protection.

---

## C · Technical detail questions

### "Walk me through what happens when I create an incident."

```
POST /api/incidents
 → helmet / compression / cors / rate limit
 → requireAuth      verify JWT, load user, refuse if deactivated
 → requireRole      officer or above, else 403
 → validate         Zod parses the body, 422 with field detail on failure
 → beforeCreate     reference code from the Counter collection, seed the timeline
 → model.create     Mongoose schema validation, then insert
 → afterCreate      priority.scoreIncident() computes the score and band
                    alert.raise() if high or critical
 → audit.record     append-only entry with the changed fields
 → response         { success: true, data }
```

Everything after `validate` is the shared code path from the CRUD factory in
`controllers/crud.factory.js`.

---

### "Why a CRUD factory rather than writing each controller out?"

Eleven controllers (parks, assets, species, observations, sensors, citizen
reports, incidents, work orders, AI detections, eco-reports, users) need the
same five operations, differing only in which fields are filterable, searchable
and populated, and whether delete is soft. Writing them out would duplicate
pagination, soft-delete handling and the audit hook eleven times, with eleven
chances to get one subtly wrong.

The factory takes a configuration and returns the five handlers. Each module then
adds only its genuinely specific logic — triage for incidents, inference for AI,
indices for biodiversity.

---

### "How can two incidents never get the same reference code?"

Codes like `INC-2026-0031` come from a `Counter` document incremented atomically
with `$inc`. The previous approach, `countDocuments() + 1`, breaks the moment a
record is deleted: the count falls and the next code repeats an existing one. A
counter never goes backwards. On first use the counter is initialised from the
highest code already stored, so the seeded records are respected. An integration
test deletes an incident and checks the next code is unique.

---

### "How does a neural network run inside an Express server?"

TensorFlow.js with its WebAssembly backend — no GPU, no Python, no native build.
The checkpoint (~14 MB) is fetched once from TensorFlow Hub into
`backend/.cache/mobilenet-v2/`; I wrote a small disk loader because the Node
file-system handler lives in `tfjs-node`, which needs native compilation. The
model is warmed up at boot and downloaded at build time on Render. If WASM cannot
start, it falls back to the pure-JavaScript backend, which is much slower. If the
model cannot load at all, analysis answers 503 rather than guessing.

---

### "How is the open-data snapshot built?"

`scripts/fetch-open-data.js`:

1. Overpass fetches each park's OSM boundary and the features in its bounding
   box; a point-in-polygon test keeps what is inside. Area is computed from the
   polygon.
2. GBIF's occurrence search is queried per month since January 2023 with the
   simplified boundary as the geometry, faceted by species — exact record counts
   without paging through tens of thousands of records.
3. Each species is looked up for taxonomy, an English name, its IUCN category and
   a licensed photo; fungi, spiders and the like are dropped.
4. The GRIIS India Darwin Core archive is downloaded and unzipped to flag
   introduced and invasive species.

The output is committed, so seeding needs no network and gives the same
biodiversity figures every time until someone refreshes it.

---

### "How does the frontend keep its cache correct after a write?"

Query keys come from one factory (`qk`), and every key starts with its module
name. `invalidateQueries({queryKey: qk.incidents.all})` therefore clears the
list, the detail, the triage queue and the stats in one call.

Mutations declare what they invalidate. Verifying an observation invalidates
biodiversity, dashboard *and* analytics — because verification admits a record
into the indices and therefore moves every score derived from them.

---

### "What is the coordinate-order issue you mention in the code?"

GeoJSON — and therefore MongoDB, and therefore every API response — orders
coordinates `[longitude, latitude]`. Leaflet orders them `[latitude, longitude]`.

Getting it backwards puts a Bengaluru park in the Indian Ocean, and the bug is
invisible until the map renders. So the conversion happens in exactly one file,
`frontend/lib/api/geo.ts`, and never inline in a component. The API also rejects
`[0, 0]`, which only ever means nobody picked a location.

---

### "Why is TF-IDF ranked by cosine similarity rather than a dot product?"

Document lengths in this corpus vary by an order of magnitude — a species
description is hundreds of words, an incident title is six. Without length
normalisation the long documents win every query regardless of relevance. Cosine
divides by the L2 norms, which removes that bias.

And the intent router handles phrases: "air quality" is boosted to the
air-quality intent, and naming a park sets the scope without hijacking the
intent — "How is the air quality at Cubbon Park?" is answered about air.

---

### "How is the simulated sensor data generated?"

For noise, soil moisture and water quality only — an AR(1) process around a daily
sine, with Gaussian noise:

```
x_t = α·x_{t−1} + (1 − α)·(base + A·sin(2π(h − φ)/24)) + ε,     α = 0.7
```

The AR(1) term matters: real environmental variables are autocorrelated, so
independent samples would look obviously synthetic and would break the anomaly
detector's assumptions. Noise uses the Box–Muller transform, `h` is the local
hour in Asia/Kolkata so the cycle follows the parks rather than the server, and a
3 % chance of a spike gives the detector something to find.

**A detail I would correct if asked:** the code calls φ the "peak hour", but
`sin(2π(h − φ)/24)` peaks six hours after φ.

---

### "What stops this being deployed insecurely?"

With `NODE_ENV=production` the server refuses to start unless `JWT_SECRET` is at
least 32 characters and not the development default, `MONGODB_URI` points at a
real database, and `CORS_ORIGIN` is set. The destructive reseed endpoint is
disabled in production, and error responses stop including internal messages.

---

## D · Questions about scope and process

### "What would you do next?"

In order of value:

1. **Train the vision models.** The review queue already collects confirmed and
   corrected labels; with enough of them, fine-tune MobileNetV2 per task —
   litter first, since it currently fails — and evaluate on a held-out set rather
   than the calibration photos.
2. **Real sensors.** Register a sensor with `source: 'device'`; a gateway POSTs to
   `/api/sensors/:id/readings` and nothing downstream changes. Start with noise
   and water, which are currently simulated.
3. **Structured biodiversity surveys** with equal effort per park, so the indices
   compare parks rather than recording activity.
4. **Replace the retrieval stage** with sentence embeddings and a vector index —
   the interface (`retrieve` → ranked documents with scores) would not change.
5. **Move JWT to httpOnly cookies** with CSRF protection, and pin validated
   addresses in the image fetcher.

---

### "What changed after the Week-6 assessor review?"

Recorded in the logs:

- module descriptions tied back to the problem statement rather than listed as
  standalone features;
- the health and biodiversity computations simplified for explainability — which
  is why the dashboard shows the contribution breakdown;
- the AI module labelled as using simulated responses at that stage. It has since
  been replaced by real MobileNetV2 inference, and the labelling now states its
  method, its measured accuracy and its limits instead;
- user roles fixed at Citizen / Officer / Administrator on the supervisor's
  instruction. (The implementation adds Ecologist between citizen and officer,
  because verifying species records is a distinct responsibility from operational
  incident handling.)

After that, the prototype's generated parks, species and observations were
replaced with OpenStreetMap, GBIF and Open-Meteo data, with every remaining
demonstration record flagged.

---

### "How much of this is original versus generated?"

Answer honestly and specifically. The parts worth claiming as design decisions
are the ones where a choice was made and defended:

- choosing the **maximum** operator for AQI, with **CPCB averaging periods** and
  **truncation** to table precision;
- separating **evenness** into its own weighted term, and keeping **Not
  Evaluated** distinct from Least Concern;
- **bounding** the ageing function so it cannot outrank an emergency;
- requiring **two of three** anomaly detectors rather than trusting one;
- letting **only fire findings** escalate automatically, and only above a
  confidence floor;
- deriving the **map layers** from other modules rather than storing them;
- reporting **per-taxocene** indices alongside the pooled one;
- returning **null, not zero**, for anything not measured, and ingesting nothing
  rather than inventing values when a live source is down;
- labelling the **provenance** of every value — real, simulated or demo.

Each of those is a judgement, and each is documented at the point in the code
where it matters.

---

## E · If something goes wrong live

| Situation | Say this |
|---|---|
| API down | "That's the error state doing its job — it's telling me the backend isn't running." Start it. |
| Live data unavailable | "We're offline, so Open-Meteo timed out. The live sensors store nothing rather than invent values — they'll show stale, then offline." |
| Image analysis returns 503 | "The model downloads once, about 14 MB, and there's no network. Once it's cached it runs offline." |
| The AI gets a photo wrong | "That's the reason for the review queue — I'll reject it with the correct label, and the precision figure updates." |
| Unexpected data | "Let me reseed — the parks, species and observations come from the committed snapshot, so they come back identically." `/admin` → System → Reseed. (Sensor readings will differ: they are live or randomly simulated.) |
| Asked something you don't know | "I'd have to check the implementation — it's in `services/<x>.service.js`." Then open it. |

The last one is worth rehearsing. Opening the file and reading the comment is a
better answer than guessing.

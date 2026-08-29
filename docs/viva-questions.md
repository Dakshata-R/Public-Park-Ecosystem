# Viva Preparation

Anticipated questions with answers. Grouped by how likely they are to come up.

---

## A · The questions you will almost certainly get

### "Why MongoDB and not PostgreSQL with PostGIS?"

For a prototype, MongoDB's GeoJSON support with `2dsphere` indexes covers every
spatial query this system makes — `$near` for "what's within 500 m", `$geoWithin`
for park containment. PostGIS becomes worth its complexity when you need
topology operations, projections, or raster analysis; we need none of those.

The document model also suits the domain: assets have type-specific attributes
(a tree has DBH and canopy spread, a bench has material and seat count), and a
flexible `attributes` map avoids either six near-identical tables or a sparse
one with forty mostly-null columns.

**If they push:** the trade-off is real. We lose transactional joins and schema
enforcement at the database level — which is why validation is enforced twice, by
Zod at the API boundary and by Mongoose schemas underneath.

---

### "Is the AI actually working, or is it fake?"

Both halves of that deserve a straight answer.

**What is real:** the entire inference contract. Class vocabularies per task,
softmax with temperature, argmax prediction, confidence as max probability,
severity mapping, the recommended-action lookup, and the auto-escalation rule
that opens an incident when a finding is both dangerous and confident. The full
probability vector is stored and displayed.

**What is not:** the logits. They come from a SHA-256 hash of the image
identifier rather than a trained convolutional network.

**Why:** the Week-6 assessor feedback specifically required that the AI module
state it uses simulated responses at prototype stage rather than overstate
capability. The interface says so in a banner on the page.

**How it would be replaced:** set `AI_MODEL_ENDPOINT` and the service POSTs to a
served model, expecting the same `{probabilities: [{label, probability}]}` shape.
Nothing downstream changes — it is one function.

---

### "Why is the AQI the maximum of the sub-indices, not the average?"

Because air is only as clean as its worst pollutant. Averaging lets one
hazardous pollutant hide behind five clean ones.

Concretely: ozone at index 180 with everything else at 20 averages to about 47 —
that reads "Satisfactory" when the air is genuinely unsafe for anyone with a
respiratory condition. The maximum operator is what both the CPCB and the US EPA
specify, for exactly this reason.

---

### "How is the biodiversity score calculated?"

It combines four normalised components:

```
Score = 100 · (0.35·Ĥ + 0.25·J′ + 0.20·R̂ + 0.20·Ĉ)
```

Shannon carries the largest weight because it is the only term reacting to
richness *and* evenness simultaneously. Evenness is separated out so a park
dominated by one invasive cannot score well on richness alone. Richness still
matters on its own, and the conservation component rewards habitat that supports
threatened species.

**The demonstration:** on the Biodiversity page, the Index Calculator takes an
arbitrary abundance vector. `100, 1, 1, 1` gives H′ = 0.19, J′ = 0.14.
`25, 25, 25, 25` gives H′ = 1.39, J′ = 1.00. Same richness, entirely different
ecological health.

---

### "Where does the live data come from, and what happens if it fails?"

Four services, none of which need an API key: Open-Meteo for weather, Open-Meteo
Air Quality (CAMS model) for pollutant concentrations, GBIF for species
occurrence, and OpenStreetMap Nominatim for reverse geocoding.

Worth stressing: Open-Meteo returns raw **concentrations**, not a finished index.
The CPCB breakpoint mathematics that turns µg/m³ into an AQI is implemented in
this project. The formula is genuinely being applied, not decorated with.

**On failure:** every call has an 8-second timeout and returns
`{ok: false, reason}` instead of throwing. The Live Conditions panel says
"unavailable" and states why; the sensor simulator falls back to its configured
constants. The system works fully offline — the data is simply no longer
anchored to reality.

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
non-stationary field data.

---

### "Why is exposure logarithmic in the priority formula?"

Because the marginal significance of an additional affected person falls
sharply. The difference between 10 and 100 people affected is enormous; between
4,000 and 4,090 it is nothing. A linear term would let a single large-park
incident permanently dominate the queue regardless of hazard.

---

### "Your evenness figure is low. Is that a bug?"

No — and it is worth explaining why. The seeded dataset includes three invasive
species with high abundances, which is realistic for an urban park network. High
Berger–Parker dominance is precisely what drives evenness down, and that is the
signal the index exists to produce. The Biodiversity page flags the invasive
count directly beside it.

---

### "Isn't pooling birds and plants into one diversity index methodologically wrong?"

Largely, yes — and we say so in the interface rather than hoping nobody notices.

Ecologists compute diversity within a **taxocene**: one taxonomic group surveyed
by one method. Pooling mixes units of survey effort, because a botanist counting
stems in a quadrat produces far larger numbers than an ornithologist counting
individuals on a transect. The pooled index then partly measures survey method.

We report the pooled score because a park manager needs one comparable number per
park — but the API also returns `byClassIndices`, the same mathematics applied
within each class, and the page renders it. That is the figure to quote when
comparing sites rigorously.

---

### "Why do only verified observations count?"

Because otherwise one enthusiastic — or mistaken — citizen could move a park's
biodiversity score. Verification by an ecologist is the gate between public input
and the scientific record.

It is visible in the data: about 30 % of citizen-sourced observations in the seed
are unverified, and the Observations tab lets you filter to them.

---

### "How do you prevent alert spam?"

Alerts are keyed by the *condition*, not the event. A sensor that stays out of
range produces a reading every minute; each one finds the existing active alert
by `dedupeKey`, increments its occurrence counter, and escalates the severity if
the condition has worsened — rather than creating a new row.

When the sensor returns to range, `autoResolve` closes the alert without anyone
touching it.

---

### "What stops a user making themselves an admin?"

The registration endpoint never reads `role` from the request body — it is
hard-coded to `citizen`. Elevated roles are granted only through the admin
module, which itself requires the admin role. An admin also cannot change their
own role, which prevents locking the platform out of administration.

---

## C · Technical detail questions

### "Walk me through what happens when I create an incident."

```
POST /api/incidents
 → helmet / cors / rate limit
 → requireAuth      verify JWT, load user
 → requireRole      officer or above, else 403
 → validate         Zod parses the body, 422 with field detail on failure
 → beforeCreate     generate reference code, seed the timeline
 → model.create     Mongoose schema validation, then insert
 → afterCreate      priority.scoreIncident() computes the score and band
                    alert.raise() if high or critical
 → audit.record     append-only entry with the changed fields
 → response         { success: true, data }
```

Everything after `validate` is one code path shared by all eleven CRUD modules —
the factory in `controllers/crud.factory.js`.

---

### "Why a CRUD factory rather than writing each controller out?"

Eleven modules need the same five operations, differing only in which fields are
filterable, searchable and populated. Writing them out is roughly 700 lines of
near-identical code with eleven chances to get pagination, or the audit hook,
subtly wrong in one of them.

The factory takes a configuration and returns the five handlers. Each module then
adds only its genuinely specific logic — triage for incidents, inference for AI,
indices for biodiversity.

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
`frontend/lib/api/geo.ts`, and never inline in a component.

---

### "Why is TF-IDF ranked by cosine similarity rather than a dot product?"

Document lengths in this corpus vary by an order of magnitude — a species
description is hundreds of words, an incident title is six. Without length
normalisation the long documents win every query regardless of relevance. Cosine
divides by the L2 norms, which removes that bias.

---

### "How is the sensor data generated?"

An AR(1) process with a diurnal component and Gaussian noise:

```
x_t = α·x_{t−1} + (1 − α)·(base + A·sin(2π(h − φ)/24)) + ε
```

The AR(1) term matters: real environmental variables are autocorrelated, so
independent samples would look obviously synthetic and would also break the
anomaly detector's assumptions.

The noise uses the Box–Muller transform to get normal samples from uniform ones.

And `base` is not a constant when online — it is refreshed every 15 minutes from
live weather and air-quality data for that park's coordinates, so a simulated
probe tracks genuine conditions.

---

## D · Questions about scope and process

### "What would you do next?"

In order of value:

1. **Real sensors.** The ingestion endpoint already exists; a gateway would POST
   to `/api/sensors/:id/readings` and nothing else would change.
2. **Train the vision models.** Collect and label field images, fine-tune
   MobileNetV2 per task, serve it, set `AI_MODEL_ENDPOINT`.
3. **Replace the retrieval stage** with sentence embeddings and a vector index —
   the interface (`retrieve` → ranked documents with scores) would not change.
4. **Move JWT to httpOnly cookies** with CSRF protection.
5. **Predictive analytics** — forecasting tree decline from condition trends.

---

### "What changed after the Week-6 assessor review?"

Four things, all recorded in the logs:

- Module descriptions tied back to the problem statement rather than listed as
  standalone features;
- the health and biodiversity computations simplified for explainability — which
  is why the dashboard shows the contribution breakdown;
- the AI module explicitly labelled as using simulated responses;
- user roles fixed at Citizen / Officer / Administrator on the supervisor's
  instruction. (The implementation adds Ecologist between citizen and officer,
  because verifying species records is a distinct responsibility from operational
  incident handling.)

---

### "How much of this is original versus generated?"

Answer honestly and specifically. The parts worth claiming as design decisions
are the ones where a choice was made and defended:

- choosing the **maximum** operator for AQI rather than the mean;
- separating **evenness** into its own weighted term;
- **bounding** the ageing function so it cannot outrank an emergency;
- requiring **two of three** anomaly detectors rather than trusting one;
- deriving the **map layers** from other modules rather than storing them;
- reporting **per-taxocene** indices alongside the pooled one;
- **excluding offline sensors** from scoring rather than counting them as zero.

Each of those is a judgement, and each is documented at the point in the code
where it matters.

---

## E · If something goes wrong live

| Situation | Say this |
|---|---|
| API down | "That's the error state doing its job — it's telling me the backend isn't running." Start it. |
| Live data unavailable | "We're offline, so the upstream call timed out. The system degrades to its own model rather than breaking." |
| Unexpected data | "Let me reseed — it's deterministic, so we get a known dataset back." `/admin` → System → Reseed. |
| Asked something you don't know | "I'd have to check the implementation — it's in `services/<x>.service.js`." Then open it. |

The last one is worth rehearsing. Opening the file and reading the comment is a
better answer than guessing.

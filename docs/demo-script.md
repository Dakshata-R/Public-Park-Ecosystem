# Demo Script — 10 minutes

A walkthrough for the review. Timings are generous; the whole thing fits in ten
minutes at a normal pace.

---

## Before you start

**Two terminals, in this order:**

```bash
# Terminal 1
cd backend && npm run dev
# wait for: "GreenPulse API listening on http://localhost:5000"

# Terminal 2
cd frontend && npm run dev
```

Open **http://localhost:3000**. Have a second browser tab on
**http://localhost:5000/api** to show the API index if asked.

**Check before presenting:** the dashboard shows a health score and the Live
Conditions panel shows a real temperature. If Live Conditions says "unavailable",
you are offline — say so if it comes up; everything else still works.

---

## 1 · The problem (30 s)

> "Urban parks are tracked the old way — periodic manual walk-throughs.
> Tree disease, pollution and hazards are found only after they escalate,
> biodiversity isn't logged systematically, and citizens have no way to report
> anything. GreenPulse is one platform that senses, maps, and manages all of it."

---

## 2 · Dashboard — the composite index (90 s)

Land on `/dashboard`.

> "Eight KPIs, all computed — none of these are stored numbers."

Point at the **Ecosystem Health gauge**, then the contribution bars beneath it.

> "The index is a weighted mean of five sub-indices. This breakdown is the
> important part: you can see *soil* contributing only 7 points of the 69.5,
> which tells a park manager exactly where remediation earns most. A single
> score would hide that."

Scroll to **Live Conditions**.

> "This is real data. Open-Meteo gives us raw pollutant concentrations — PM2.5,
> NO₂, ozone — and *our* code converts them to an AQI using the CPCB breakpoint
> tables. These per-pollutant bars are the sub-indices we computed. The overall
> AQI is the **maximum**, not the average, because air is only as clean as its
> worst pollutant."

**If asked "is that really live?"** — change the park in the top-right filter;
the temperature and AQI change with the coordinates.

---

## 3 · Biodiversity — the mathematics (2 min)

Go to `/biodiversity`, **Indices** tab.

> "Biodiversity isn't a number we store. It's computed from 420 field
> observations."

Point at the five formula cards.

> "Shannon–Wiener, Pielou's evenness, Gini–Simpson, Margalef, Berger–Parker.
> Each shows the formula and this dataset's actual value."

Scroll to the **Index Calculator** — this is the strongest moment in the demo.

Type `100, 1, 1, 1` → **Compute**. Note H′ ≈ 0.19, J′ ≈ 0.14.
Then type `25, 25, 25, 25` → **Compute**. Note H′ ≈ 1.39, J′ = 1.00.

> "Same four species both times. Completely different ecological health. The
> first is a park overrun by one invasive; the second is balanced. That's why
> species count alone is a poor measure — and it's why evenness has its own
> weight in our composite score."

Scroll to **Per-Taxocene Indices**.

> "One caveat we're explicit about: ecologists compute diversity *within* a
> taxonomic group, not across all life, because counting plant stems and
> counting herons use different units of survey effort. We report the pooled
> score because a manager needs one number per park — but we also give the
> per-class breakdown, which is the defensible comparison."

---

## 4 · Incidents — computed priority (90 s)

Go to `/incidents`. Sign in as **officer** if prompted (`officer@greenpulse.gov`
/ `greenpulse123` — the login page has one-click buttons).

The **Triage queue** is the default tab.

> "Incidents are ordered by a computed score, not by arrival time and not by
> someone typing 'urgent'."

Point at the factor chips on the top incident.

> "Hazard, severity, exposure, urgency, community. Exposure is log-scaled
> because the gap between 10 and 100 people affected matters far more than
> between 4,000 and 4,090."

Click an incident → the detail sheet shows the full breakdown.

> "Ageing is the interesting one. An unattended incident has to climb the queue
> or it starves — but linear ageing would eventually let a week-old graffiti
> report outrank a new fire. So we use `1 − e^(−t/τ)`, which saturates. Ageing
> can contribute at most 10 points: enough to break ties, never enough to
> outrank an emergency."

---

## 5 · AI module — and honesty about it (90 s)

Go to `/ai`.

Read the blue banner aloud, or paraphrase:

> "We're explicit that these are prototype-stage models. The pipeline is real —
> class vocabulary, softmax, argmax, severity mapping, the escalation rule all
> run — but the weights are a deterministic surrogate rather than a trained
> network. That was the scope agreed at the Week-6 review."

Pick **Fire & Smoke**, select a sample image, pick a park, click **Analyse**.

> "Note we show the *full* probability vector, not just the winner. A classifier
> that's 88% sure is a different thing from one that's 34% sure, and hiding that
> is how AI features mislead people."

Scroll to **Escalation decision**.

> "Three conditions: is it dangerous, is it confident, and do we have a location.
> All three, and it opens an incident automatically. Below the confidence floor
> it queues for a human — because a false fire alarm is expensive."

---

## 6 · Sensors — anomaly detection (60 s)

Go to `/sensors`, click any sensor.

> "Every reading carries a raw value and a normalised 0–100 score, because
> sensors report in incompatible directions — low AQI is good, high soil moisture
> is good."

Point at the chart: the dashed threshold lines and any red anomaly points.

> "Three detectors vote on each reading: a z-score test, a modified z-score
> using median absolute deviation — which is robust to the very outliers it's
> looking for — and Tukey's IQR fence. Two out of three flags it. Voting cuts
> the false positives any single detector produces on noisy field data."

> "And the simulator anchors itself to live weather every 15 minutes, so these
> aren't invented numbers — they track real conditions at that park's
> coordinates."

---

## 7 · The citizen loop (90 s)

Go to `/citizen`.

> "This closes the loop from the public back into operations."

Click **Review** on a submitted issue (you need the officer account).

> "When an officer accepts an issue, it becomes a tracked incident — and the
> severity and exposure they enter here feed the triage score directly. When they
> accept a *wildlife sighting*, it becomes a verified observation, and that
> observation enters the biodiversity indices we just looked at."

> "Only verified observations count. That gate is what stops one enthusiastic —
> or mistaken — reporter from moving a park's score."

Show an already-accepted report with the "Became incident INC-…" link.

---

## 8 · Assistant and map (60 s)

Go to `/assistant`. Click a suggested question, e.g. *"Which species have been
recorded and how diverse are they?"*

> "Retrieval-augmented, over the live database. TF-IDF weighting with cosine
> similarity — cosine rather than a raw dot product because document lengths
> here vary by an order of magnitude."

Point at the **Sources** panel.

> "Every answer cites which records it drew on, with similarity scores. It
> retrieves genuinely; it composes the answer from templates rather than an LLM.
> The advantage is that every figure is traceable to a record — nothing is
> invented."

Go to `/map` briefly.

> "Eight layers, all GeoJSON from MongoDB with a 2dsphere index. And none of
> this is stored for the map's benefit — a tree pin *is* the asset register's
> record of that tree, a pollution circle *is* an open incident, sized by its
> priority score. The map can't go stale relative to the modules it draws."

---

## 9 · Close (30 s)

Go to `/admin` → **Settings** tab. Show the weight sliders.

> "And the whole index is configurable. Change these weights and every park is
> re-scored — with validation that they sum to 1, because a partial update would
> leave parks scored under two different formulas."

> "Frontend and backend run separately, sixteen collections, about fifty
> endpoints, and it runs with no MongoDB installation because the backend boots
> an in-memory instance and seeds it."

---

## Fallbacks if something breaks

| Problem | What to do |
|---|---|
| "Cannot reach the API" everywhere | Backend isn't running. `cd backend && npm run dev`. The error state on screen says this. |
| Live Conditions unavailable | You're offline. Say so — everything else is unaffected, and the simulator falls back to its own model. |
| Blank map | Leaflet CSS is loaded from a CDN. Offline, the layers still load; only the base tiles are missing. |
| Data looks wrong | `/admin` → System → **Reseed**. Takes ~10 s and restores a known-good dataset. |
| Wrong role for an action | Sign in as admin (`admin@greenpulse.gov`) — it can do everything. |

---

## The five things worth remembering

1. **The mathematics is real** — Shannon, CPCB AQI, weighted composite, three-detector anomaly ensemble, exponential-ageing triage. The Index Calculator proves it live.
2. **Live public data, scored by our own code** — Open-Meteo gives concentrations; the CPCB conversion is ours.
3. **Nothing is stored that should be derived** — biodiversity from observations, priority from attributes, map layers from other modules.
4. **The system is honest about its limits** — the AI banner says exactly what is simulated.
5. **It runs anywhere** — no database install, no API keys, works offline.

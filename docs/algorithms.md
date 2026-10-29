# Algorithms & Mathematics

Every formula the system uses, where it lives, and why it was chosen. Constants
quoted here are the ones in the code; worked examples were reproduced by calling
the service functions themselves.

---

## 1. Air Quality Index

**`backend/src/services/aqi.service.js`** · fed by **`external.service.js`**

### 1.1 Sub-index — piecewise linear interpolation

A pollutant concentration *C* is mapped to an index value using the breakpoint
table published by the **Central Pollution Control Board (CPCB, India)**:

```
        I_high − I_low
  I  =  ─────────────── · (C − C_low)  +  I_low          rounded to an integer
        C_high − C_low
```

where `[C_low, C_high]` is the concentration band containing *C* and
`[I_low, I_high]` is the matching index band. Concentrations are µg/m³, except
CO in mg/m³. Negative inputs are clamped to 0; anything above the top breakpoint
saturates at 500.

| Pollutant | Bands (µg/m³; CO mg/m³) → 0–50 · 51–100 · 101–200 · 201–300 · 301–400 · 401–500 |
|---|---|
| PM₂.₅ | 0–30 · 31–60 · 61–90 · 91–120 · 121–250 · 251–500 |
| PM₁₀ | 0–50 · 51–100 · 101–250 · 251–350 · 351–430 · 431–600 |
| NO₂ | 0–40 · 41–80 · 81–180 · 181–280 · 281–400 · 401–600 |
| SO₂ | 0–40 · 41–80 · 81–380 · 381–800 · 801–1600 · 1601–2400 |
| CO | 0–1 · 1.1–2 · 2.1–10 · 10.1–17 · 17.1–34 · 34.1–50 |
| O₃ | 0–50 · 51–100 · 101–168 · 169–208 · 209–748 · 749–1000 |

**Worked example.** PM₂.₅ = 45 µg/m³ falls in the band 31–60 µg/m³, which maps
to index 51–100:

```
I = (100 − 51)/(60 − 31) × (45 − 31) + 51
  = 49/29 × 14 + 51
  = 23.66 + 51
  = 74.66  →  75
```

### 1.2 Truncation to table precision

The published bands are **discontinuous at the precision they are printed to**:
PM₂.₅ `[0, 30]` is followed by `[31, 60]`. A measured 30.9 µg/m³ lies in neither,
and a naive lookup falls through every band and returns 500. Both the CPCB and
US EPA methods truncate the concentration to the table's precision first:

```
  C′ = ⌊C · 10^d + 10⁻⁹⌋ / 10^d          d = 0 for PM₂.₅, PM₁₀, NO₂, SO₂, O₃;  d = 1 for CO
```

| Input | Truncated | Sub-index |
|---|---|---|
| PM₂.₅ 30.9 | 30 | 50 |
| PM₁₀ 50.1 | 50 | 50 |
| CO 1.084 | 1.0 | 50 |
| CO 1.1 | 1.1 | 51 |

(The 10⁻⁹ guards against a value like 1.1 being stored as 1.0999999….)

### 1.3 Averaging periods

The CPCB index is defined on **24-hour means** for PM₂.₅, PM₁₀, NO₂ and SO₂ and
**8-hour means** for CO and O₃. Applying the breakpoints to a single hourly value
overstates short peaks — midday ozone most of all. `computeAveragedAqi(hourly, t)`
takes index-aligned hourly series and, for each pollutant *p* with period *hₚ*:

```
  W_p   = finite values among hours (t − hₚ + 1) … t
  C̄_p   = mean(W_p)                    only if |W_p| ≥ ⌈0.75 · hₚ⌉   (18 of 24, 6 of 8)
  I_p   = subIndex(p, C̄_p)
```

A pollutant without 75 % coverage contributes nothing; if **no** pollutant
qualifies, the AQI is `null` and the integration reports `ok: false` — an empty
upstream response must never read as "AQI 0 — Good".

Open-Meteo's CAMS feed returns carbon monoxide in µg/m³, so it is divided by
1000 before it meets the mg/m³ CO table (otherwise it would be wrong by a factor
of a thousand). `getAirQuality` requests the past day plus today in GMT, takes
the newest hour that is not in the future as *t*, and returns both the current
concentrations and the `averages` the AQI was computed from.
`getHourlyHistory` requests one extra day so the first backfilled hours also
have full windows.

**Worked example** (from the unit test). PM₂.₅ steady at 20 for 24 h → mean 20 →
I = 33. Ozone 30 for 16 h then 160 for the last 8 h → 8-hour mean 160 → band
101–168 → I = 101 + (99/67)·59 ≈ 188. AQI = 188, dominant pollutant O₃.

### 1.4 Overall AQI — the maximum operator

```
  AQI = max( I_PM2.5, I_PM10, I_NO2, I_SO2, I_CO, I_O3 )     over the pollutants that qualified
```

**Why maximum, not mean.** Air is only as clean as its worst pollutant.
Averaging would let one hazardous pollutant hide behind five clean ones — a
sample with ozone at index 180 and everything else at 20 would average to about
47 and read "Good" when it is in fact "Moderate" and unsafe for people with
respiratory conditions.

Categories: ≤50 Good · ≤100 Satisfactory · ≤200 Moderate · ≤300 Poor ·
≤400 Very Poor · ≤500 Severe.

### 1.5 Inversion to a 0–100 goodness score

AQI is an inverted scale (0 best, 500 worst) while every other index in the
project is 0–100 with higher better. `aqiToScore` interpolates linearly *within*
each CPCB band so the mapping is continuous while band edges land on round
numbers:

| AQI | 0 | 50 | 100 | 200 | 300 | 400 | 500 |
|---|---|---|---|---|---|---|---|
| Score | 100 | 100 | 80 | 60 | 40 | 20 | 0 |

e.g. AQI 75 → 90, AQI 150 → 70. A second uniform linear stretch was rejected:
AQI is *already* piecewise linear, so re-stretching it would distort the category
boundaries the public recognises.

---

## 2. Biodiversity Indices

**`backend/src/services/biodiversity.service.js`**

Given *S* species with abundances n₁ … n_S, total N = Σ nᵢ, and proportional
abundance pᵢ = nᵢ / N. Only `verified: true` observations are aggregated.

> **What nᵢ is in this dataset.** The seeded observations are GBIF rows — one per
> species, park and month — whose `count` is the **number of occurrence records**
> (eBird checklists, iNaturalist observations …), not a count of individuals.
> Citizen sightings accepted in the portal add their reported `count`. The
> indices are therefore computed over record frequencies; see §2.9.

### 2.1 Species richness

```
  S = number of distinct species observed
```

Simple, and by itself misleading: a park with 500 pigeons and one hawk has the
same richness as one with 250 of each.

### 2.2 Shannon–Wiener index

```
  H′ = − Σ pᵢ · ln(pᵢ)
```

Information-theoretic: the uncertainty in guessing the species of a randomly
drawn record. H′ = 0 for a monoculture and rises with *both* richness and
evenness. Its maximum for S species is `H′_max = ln(S)`.

### 2.3 Pielou's evenness

```
  J′ = H′ / ln(S),   J′ ∈ [0, 1]          (defined as 0 when S = 1)
```

Isolates evenness from richness. J′ = 1 means every species is equally abundant.

**Worked comparison** — the case that shows why richness alone fails:

| Community | S | H′ | J′ |
|---|---|---|---|
| `100, 1, 1, 1` | 4 | 0.1637 | 0.1181 |
| `25, 25, 25, 25` | 4 | 1.3863 | 1.0000 |

Identical richness, wildly different ecological health. The first is a park
overrun by one species; the second is balanced.

*(Both are reproducible in the Index Calculator on the Biodiversity page, which
calls `POST /biodiversity/indices/preview`.)*

### 2.4 Simpson's index

```
  D  = Σ pᵢ²                (probability two random records share a species)
  1 − D                     (Gini–Simpson diversity, rises with diversity)
```

### 2.5 Margalef richness

```
  D_Mg = (S − 1) / ln(N)                   (0 when N = 1)
```

Richness corrected for sampling effort, so parks surveyed with different
intensities stay more comparable.

### 2.6 Berger–Parker dominance

```
  d = max(pᵢ)
```

The share held by the commonest species. High dominance is what drags evenness
down.

### 2.7 Composite Biodiversity Score

```
  Score = 100 · ( 0.35·Ĥ + 0.25·J′ + 0.20·R̂ + 0.20·Ĉ )           (0 when S = 0)
```

| Term | Definition | Weight | Reasoning |
|---|---|---|---|
| Ĥ | min(1, H′ / ln(S_ref)) | 0.35 | The only term reacting to richness *and* evenness at once |
| J′ | Pielou evenness | 0.25 | Separated out so a monoculture cannot score well on richness alone |
| R̂ | min(1, S / S_ref) | 0.20 | Raw species count still matters |
| Ĉ | Conservation component (below) | 0.20 | Recording a threatened species is stronger evidence of habitat quality |

`S_ref = 40` is the richness treated as "excellent" for an urban park.

**Conservation component.**

```
  Ĉ = min(1,  Σᵢ (wᵢ − 1) · nᵢ  ⁄  (N · (w_max − 1)) )          w_max = 5
```

| IUCN category | w |
|---|---|
| Not Evaluated, Data Deficient, Extinct in the Wild, Least Concern | 1 (no signal) |
| Near Threatened | 2 |
| Vulnerable | 3 |
| Endangered | 4 |
| Critically Endangered | 5 |

"Not Evaluated" is kept distinct from "Least Concern" in the catalogue: most
insects and plants have never been assessed, and labelling them Least Concern
would be a false claim. Both carry weight 1, so neither inflates the score.
`threatenedSpecies` counts species that are Near Threatened or worse;
`invasiveCount` sums the records of species flagged invasive by GRIIS India.

### 2.8 A methodological caveat, stated rather than hidden

Ecologists compute diversity within a **taxocene** — one taxonomic group
surveyed by one method — not across all life at a site. Pooling birds,
butterflies and plants mixes units of survey effort, and the pooled index then
measures survey *method* as much as diversity.

The project reports the pooled score because a park manager needs one comparable
number per park, **and** returns `byClassIndices` — the same mathematics applied
within each class. That is the figure to quote when comparing sites rigorously,
and it is rendered on the Biodiversity page.

### 2.9 Record counts and sampling effort

Because nᵢ counts records, the indices inherit the recording effort of each
park. Computing §2.1–2.7 over the committed snapshot with the service functions
gives:

| Scope | Records N | S | H′ | J′ | Score |
|---|---|---|---|---|---|
| All six parks | 37 182 | 587 | 4.2524 | 0.667 | 71.7 |
| Lalbagh Botanical Gardens | 33 803 | 448 | 4.1688 | 0.6829 | 72.1 |
| Cubbon Park | 3 041 | 335 | 4.3946 | 0.7559 | 73.9 |
| Sankey Tank Park | 96 | 53 | 3.6232 | 0.9126 | 77.3 |
| Jayaprakash Narayan Park | 200 | 48 | 3.5361 | 0.9134 | 76.4 |
| Coles Park | 41 | 16 | 2.571 | 0.9273 | 55.6 |
| Freedom Park | 1 | 1 | 0 | 0 | 0.5 |

Two lessons worth stating. Lalbagh holds about nine records in ten, so the
citywide figure is essentially Lalbagh's. And a lightly recorded park can score
*higher* than a heavily recorded one: with a few dozen records most species are
seen once or twice, evenness approaches 1, and richness saturates Ĥ quickly.
These numbers describe what has been recorded, not how many animals live there.

---

## 3. Ecosystem Health Index

**`backend/src/services/ecosystem-score.service.js`**

```
  EHI = Σ wₖ · Sₖ  ⁄  Σ wₖ         k ∈ {air, water, soil, tree, biodiversity} with Sₖ ≠ null
```

Default weights (stored in `Setting`, editable by an admin; `getWeights`
re-normalises them to sum to 1):

| Component | Weight | Sₖ is… |
|---|---|---|
| Air | 0.25 | mean of the AQI score and the noise score, over whichever of the two have a reporting sensor |
| Water | 0.20 | mean normalised reading of the park's water-quality sensors |
| Tree health | 0.20 | mean `condition` of active tree and plant assets |
| Biodiversity | 0.20 | the composite score of §2.7 |
| Soil | 0.15 | mean normalised reading of the soil-moisture sensors |

A sensor contributes only if it is active, not `offline`, and has reported at
least once. A component with no input is `null`; if every component is `null`
the EHI and its grade are `null`.

**Why divide by Σw over the available components.** It makes the formula robust
to an administrator's weights, and — more importantly — it handles missing data
correctly. Jayaprakash Narayan Park has no water body mapped in OpenStreetMap
(so no water sensor) and no mapped trees (so no tree assets); it is scored on
the components it *does* have rather than being penalised with zeros it never
earned.

### 3.1 Normalising raw readings

Sensors report in incompatible units and directions. Three shapes cover them:

```
  lower-is-better    S = 100 · (max − x) / (max − min)
  identity           S = clip(x, 0, 100)
  band (optimal)     S = 100 · (1 − |x − c| / h),  clipped to [0, 100]
```

| Type | Shape | Parameters |
|---|---|---|
| AQI | CPCB band map | §1.5 |
| Noise | lower-is-better | 35 dB → 100, 85 dB → 0 |
| Water (WQI), Soil (%) | identity | already 0–100 |
| Temperature | band | centre 24 °C, half-width 14 (10–38 °C) |
| Humidity | band | centre 55 %, half-width 35 (20–90 %) |

Temperature and humidity are shown on the sensor pages but do not enter the EHI.

**Worked example** (illustrative inputs). Air 80, tree 70, biodiversity 40; no
water or soil sensor:

```
EHI = (0.25×80 + 0.20×70 + 0.20×40) / (0.25 + 0.20 + 0.20)
    = (20 + 14 + 8) / 0.65
    = 64.6   →  "moderate"
```

With zeros substituted for the missing components the same park would score
42.0 and be graded "poor" — for the absence of a sensor. The per-component
`contributions` are returned and rendered on the dashboard.

### 3.2 Grade bands

| Score | Grade |
|---|---|
| ≥ 85 | excellent |
| ≥ 70 | good |
| ≥ 55 | moderate |
| ≥ 40 | poor |
| < 40 | critical |

### 3.3 Trend series

`healthTrend` groups stored readings by UTC day and sensor type, normalises each
day's mean, and emits `null` for a type with no readings that day — the chart
draws a break, not a plunge to zero.

---

## 4. Anomaly Detection

**`backend/src/services/anomaly.service.js`**

A reading must be flagged as unusual **for that sensor**, not merely past a
fixed threshold: 30 °C is unremarkable in a car park and alarming inside a
shaded wetland. Three detectors run over the sensor's previous 50 readings; with
fewer than 8, detection is suppressed ("insufficient history").

### 4.1 Z-score (parametric)

```
  μ = (1/n) Σ xᵢ
  σ = √( (1/(n−1)) Σ (xᵢ − μ)² )        [Bessel-corrected]
  z = (x − μ) / σ                        (0 when σ = 0)
```

Flagged when |z| > k, where k is `Setting.anomalyZThreshold` (default 3 — the
≈99.7 % interval of a normal distribution). Cheap and interpretable, but σ is
itself inflated by the very outliers it should detect.

### 4.2 Modified z-score (robust)

```
  MAD = median( |xᵢ − median(x)| )
  M   = 0.6745 · (x − median(x)) / MAD          flagged when |M| > 3.5
```

The constant **0.6745 = Φ⁻¹(0.75)** makes MAD a consistent estimator of σ for
normal data, so the threshold 3.5 is comparable to the z-test's 3. Because the
median has a 50 % breakdown point, this detector is not fooled by a handful of
extreme values. When MAD = 0 (over half the window identical) the scale falls
back to σ, so a constant-then-jump series is still caught.

### 4.3 Tukey's IQR fence (non-parametric)

```
  IQR = Q₃ − Q₁                  (quantiles by linear interpolation, "type 7")
  outlier ⟺ IQR > 0  and  ( x < Q₁ − 1.5·IQR  or  x > Q₃ + 1.5·IQR )
```

Assumes no distribution at all — which matters for skewed variables such as AQI,
where the upper tail is genuinely long. The `IQR > 0` condition stops a flat
window from flagging every value.

### 4.4 Majority vote

A reading is anomalous when **at least two of three** agree. Voting cuts the
false-positive rate any single detector produces on noisy, non-stationary data.
An anomaly raises an alert (severity `high` if all three voted, else `medium`),
deduplicated per sensor per hour.

---

## 5. Incident Triage

**`backend/src/services/priority.service.js`**

```
  P = 100 · ( 0.35·H + 0.25·Ŝ + 0.20·Ê + 0.10·Û + 0.10·Ĉ )          rounded to 0.1
```

| Term | Definition |
|---|---|
| **H** | Hazard weight of the incident type, ∈ [0, 1] |
| **Ŝ** | Reported severity, (s − 1)/4 for s ∈ 1…5, clamped |
| **Ê** | Exposure: `ln(1 + people) / ln(1 + 5000)`, capped at 1 |
| **Û** | Urgency from age (below) |
| **Ĉ** | Community signal: `ln(1 + upvotes) / ln(1 + 200)`, capped at 1 |

`upvotes` on an incident mirrors the per-account upvote count of the citizen
report it came from (§10.2), and is re-read — with the score recomputed — every
time that count changes. Priority is never accepted from the client.

### 5.1 Hazard weights and response targets

| Type | H | τ (hours) |
|---|---|---|
| Fire | 1.00 | 0.5 |
| Water pollution | 0.80 | 6 |
| Air pollution | 0.75 | 8 |
| Tree fall | 0.70 | 4 |
| Infrastructure damage | 0.60 | 24 |
| Illegal dumping | 0.50 | 24 |
| Dead animal | 0.45 | 12 |
| Vandalism | 0.40 | 48 |
| *(unknown type)* | 0.50 | 24 |

### 5.2 Why exposure is log-scaled

The difference between 10 and 100 people affected matters far more than between
4 000 and 4 090. A linear term would let one large-park incident permanently
dominate the queue.

### 5.3 Ageing — bounded, not unbounded

```
  Û(t) = 1 − e^(−t/τ)
```

where *t* is hours since reporting and *τ* is the type's response target.

An unattended incident must climb the queue or it starves behind a stream of
newer, slightly-higher-scoring ones. But **linear ageing would eventually let a
week-old vandalism report outrank a new fire** — which is exactly wrong.

The exponential saturates: at t = τ the incident has ~63 % of the ageing weight,
at t = 3τ it is at 95 %, and it never exceeds 1. Combined with the 0.10 weight,
ageing can contribute at most 10 points — enough to break ties among comparable
incidents, never enough to outrank a genuine emergency.

Resolved and closed incidents stop ageing. An open incident older than τ is
flagged `isOverdue`. The triage queue sorts by score, then oldest first.

### 5.4 Bands

| Score | Priority |
|---|---|
| ≥ 75 | critical |
| ≥ 55 | high |
| ≥ 35 | medium |
| < 35 | low |

**Worked example.** Tree fall, severity 4, 300 people affected, just reported:

```
H = 0.70                                    → 0.35 × 0.70 = 0.2450
Ŝ = (4−1)/4 = 0.75                          → 0.25 × 0.75 = 0.1875
Ê = ln(301)/ln(5001) = 5.707/8.517 = 0.670  → 0.20 × 0.670 = 0.1340
Û = 0 (just reported)                       → 0.10 × 0    = 0
Ĉ = 0 (no upvotes)                          → 0.10 × 0    = 0

P = 100 × 0.5665 = 56.7  →  "high"
```

*(`scoreIncident({ type: 'tree-fall', severity: 4, affectedPeople: 300 })`
returns exactly this.)*

---

## 6. AI Inference

**`backend/src/services/vision.service.js`** (pixels and network) ·
**`backend/src/services/ai-inference.service.js`** (task mapping, engine choice) ·
**`backend/src/services/llm-vision.service.js`** (species identification) ·
**`backend/src/services/llm-provider.service.js`** (Gemini / Groq / OpenAI-compatible / Claude)

One task: **Wildlife recognition** (`wildlife`). Two engines answer it in the
same label vocabulary:

| Engine | When | Names species? |
|---|---|---|
| `llm-vision` | a language-model key set (`GEMINI_API_KEY`, free; or Groq, `LLM_BASE_URL`, Anthropic) and the API answers | yes — common + scientific, with confidence, a severity and an action |
| `mobilenet-fallback` | no key, or the API failed, timed out or declined | ImageNet class only ("tiger") |

MobileNetV2 (§6.1–6.3) always runs: it is the fallback and the evidence shown
next to an AI vision result. Every detection records its `engine` and, for
`llm-vision`, its `provider` and model (detections stored before providers were
pluggable carry `claude-vision`).

### 6.1 The network

```
1. Decode JPEG or PNG (format from the magic number) → packed RGB
2. Bilinear resize to 224×224, scale to [0, 1]
3. MobileNetV2 1.0 / 224, ImageNet checkpoint (TF Hub imagenet/mobilenet_v2_100_224/classification/2)
4. 1001 logits → softmax → drop index 0 ("background") → 1000 ImageNet probabilities pᵢ
```

The weights are Google's pre-trained checkpoint, run with TensorFlow.js on the
WebAssembly backend (CPU fallback). **Nothing was trained or fine-tuned by this
project.** ImageNet has no park-management categories, so the wildlife labels
are built from the animal classes the network does produce.

### 6.2 Softmax (numerically stable)

```
  pᵢ = e^(zᵢ − max z)  ⁄  Σⱼ e^(zⱼ − max z)
```

Subtracting `max z` prevents overflow without changing the result. No
temperature is applied.

### 6.3 Pooling ImageNet classes into groups

A group's evidence is the probability mass the network put on its members:

```
  E_g = Σ_{i ∈ g} pᵢ
```

| Group | ImageNet indices |
|---|---|
| bird | 7–24, 80–100, 127–146 (59 classes) |
| amphibian | 25–32 |
| reptile | 33–68 |
| invertebrate | 69–79, 107–126 |
| insect | 300–320 |
| butterfly | 321–326 |
| wildMammal | 101–106, 147–150, 269–280, 286–299, 330–338, 340, 342–344, 347, 349–353, 355–388 |
| domesticAnimal | 151–268, 281–285, 339, 341, 345, 346, 348, 354 |
| fish | 0–6, 389–397 |

A unit test checks that groups do not overlap and stay inside the 1000 classes.

### 6.4 Fallback scoring

One non-negative score *s_k* per wildlife label:

```
  s = [ E_bird, E_butterfly, E_insect + E_invertebrate, E_reptile + E_amphibian,
        E_wildMammal, E_domesticAnimal, max(0, 1 − (all of those + E_fish)) ]
        Bird      Butterfly   Other insect or           Reptile or
                  or moth     invertebrate              amphibian
        Wild mammal   Domestic or stray animal   No animal detected
```

The most probable ImageNet member of the winning group becomes the fallback's
`species.common` ("Tiger", "Bee eater"), flagged as ImageNet granularity.

### 6.5 AI vision (language model)

The provider is chosen by `LLM_PROVIDER`, else from the first key present —
`GEMINI_API_KEY` → `GROQ_API_KEY` → `LLM_BASE_URL` → `ANTHROPIC_API_KEY`.
Gemini, Groq and local servers are called over the OpenAI-compatible Chat
Completions API with plain `fetch`; Claude through the Anthropic SDK.

When enabled, the stored ≤640 px JPEG (a base64 `data:` URL) and a one-line
summary of §6.3 (the top ImageNet classes — "use only as a hint") are sent to
`VISION_MODEL` (default `gemini-3.5-flash-lite` on Gemini; 25 s per request, one
retry on 429 / 5xx / timeout, 55 s overall). The reply is constrained by a
strict `json_schema` response format (JSON mode with the schema in the prompt
for servers that reject schemas):

```
  label_probabilities[]  { label ∈ the wildlife labels, probability }
  species                { common_name, scientific_name, confidence }
  severity (low … critical), recommended_action, caveat
```

Severity is operational: low for a routine sighting, raised for an animal that
needs managing (a snake on a path, strays) or that is injured, sick or dead.
The label probabilities are clamped to [0, 1] and renormalised over the task's
labels (unknown labels dropped), so the result has the same probability vector,
argmax and review vocabulary as the fallback. Because some providers ignore
the schema, the parsed reply is always validated on the server (zod); output
that is not JSON or does not match gets one repair round, then the request
falls back. A refusal, truncated output, timeout or API error falls back to
§6.4 with a note giving the reason. Seeding and `npm run eval:vision` use the
fallback unless asked (`--llm`), so a configured key's quota is not spent on
every start.

### 6.6 Normalisation and output

```
  P(k) = max(0, s_k) ⁄ Σⱼ max(0, s_j)
  prediction = argmax P,   confidence = 100 · max P   (one decimal)
```

Every result carries `engine`, `species`, the top-5 ImageNet classes, the named
`evidence` signal (`animalEvidence`), the model card and timings. `notes` add
caveats: the network is "unsure" when its top ImageNet class is below 20 %;
fallback names are ImageNet classes; what an API key would add, or why AI
vision was unavailable.

### 6.7 Measured accuracy

`npm run eval:vision` (`scripts/evaluate-vision.js`) runs every photo listed in
`src/seed/data/sample-images/attribution.json` — 3 openly licensed Wikimedia
Commons wildlife photographs — and counts a prediction correct if it is one of
that photo's accepted labels. Fallback engine:

| Task | Correct | Notes |
|---|---|---|
| wildlife (Indian pond heron, green bee-eater, plain tiger butterfly) | 3 / 3 | named "Bittern", "Bee eater", "Monarch" — ImageNet granularity |

**Caveat:** three photographs is a smoke test, not a validated error rate.
`--llm` re-runs it on AI vision (one API call per photo).

### 6.8 Human review and precision

No AI finding acts on its own: every detection enters the review queue. A park
officer (or admin) marks it `confirmed` or `rejected`. A rejection may carry a
`correctedLabel`, which must be one of the task's own class labels and differ
from the prediction. The observed precision is

```
  precision = 100 · confirmed ⁄ (confirmed + rejected)        null until a review exists
```

— precision over *reviewed* detections, which is only as representative as the
choice of what gets reviewed.

---

## 7. Retrieval for the Assistant

**`backend/src/services/assistant.service.js`**

### 7.1 Tokenising

Lower-case, split on non-alphanumerics, drop stopwords and tokens of ≤ 2
characters, then strip common suffixes (`-ies → -y`, `-ing`, `-ed`, `-es`, `-s`).

### 7.2 TF-IDF weighting

For term *t* in document *d* within a corpus *D* of *N* documents (parks,
species, recent incidents, assets, sensors, citizen reports, work orders; rebuilt
when older than 60 s):

```
  tf(t,d)   = f(t,d) / |d|
  idf(t,D)  = ln( N / (1 + nₜ) ) + 1          [smoothed]
  w(t,d)    = tf(t,d) · idf(t,D)
```

### 7.3 Cosine similarity

```
             Σₜ qₜ · dₜ
  cos(q,d) = ───────────────
             ‖q‖₂ · ‖d‖₂
```

**Why cosine, not a raw dot product.** Document lengths vary by an order of
magnitude — a species description dwarfs an incident title. Without length
normalisation, the long documents would always win regardless of relevance.
The top 5 (k = 5) documents with a positive score become the citations.

### 7.4 Intent classification

1. **Lexicon score.** Each intent has a word list; a matching token scores 1, and
   a word that *names* the intent scores 2. Naming the intent directly counts even
   if the word is not in its lexicon. Without the specificity weight, "what is
   the biodiversity score?" ties between `biodiversity` and `health` and the
   winner is decided by object declaration order.
2. **Phrases.** "air quality" → airQuality, "water quality" and "soil health" →
   health, "work order" → maintenance, each boosting that intent by +3.
3. **Park names do not hijack intent.** If the generic `parks` intent wins but a
   more specific intent also scored, the specific one is used — so "How is the air
   quality at Cubbon Park?" is answered about air quality.
4. `confidence = min(1, hits / min(3, tokens))`.

The word `quality` is deliberately absent from the health lexicon because it
collides with "air quality" and "water quality". Scope is set separately: the
answer is computed for the first active park whose full name — or, failing that,
first word — appears in the question, else across all parks.

### 7.5 Scope

Retrieval is genuine; generation is template-based over records and live
computations (`computeEcosystemHealth`, `analyseBiodiversity`, reporting AQI
sensors). Every figure in an answer is traceable, missing figures are said to be
"not measured", and the citations panel shows which documents matched and how
strongly.

---

## 8. Sensor Data

**`backend/src/services/sensor.service.js`**

### 8.1 Virtual sensors (`source: 'open-meteo'`)

AQI, temperature and humidity sensors read Open-Meteo for their park's
coordinates. On each refresh:

```
  observation = current temperature / humidity (forecast API) or averaged CPCB AQI (§1.3)
  ingest      ⟺ observation exists  and  observedAt > sensor.lastReadingAt
  offline     ⟸ no observation  and  now − lastReadingAt > 3 h
```

A value is stored only when the upstream observation time advances (weather is
cached 10 min, air quality 15 min), with the upstream timestamp — converted from
Open-Meteo's local wall-clock time using its `utc_offset_seconds`. Nothing is
generated when the service is unreachable. At seed time each virtual sensor is
backfilled with the past 48 hours of real hourly values.

### 8.2 Simulated sensors (`source: 'simulated'`)

Noise, soil moisture and water quality have no public park-scale source.
Environmental variables are not white noise — they have a daily cycle and are
autocorrelated — so the generator is an AR(1) process around a diurnal sine:

```
  seasonal(h) = base + A · sin(2π (h − φ) / 24)
  x_t = α · x_{t−1} + (1 − α) · seasonal(h) + σ · z
  with probability 0.03:  x_t ← x_t ± A · (2.5 + 2u),   u ~ U(0,1)
  x_t ← clip(x_t, minValue, maxValue), rounded to 0.1
```

| Symbol | Meaning |
|---|---|
| α = 0.7 | AR(1) persistence, so the series drifts rather than jumping |
| h | Local hour in **Asia/Kolkata**, so the cycle follows the parks' clock on any server |
| A, φ | Diurnal amplitude and phase (`peakHour` in the code) |
| z ~ N(0, 1) | Box–Muller: `z = √(−2 ln u₁) · cos(2π u₂)`, u₁ nudged off 0 |

The rare spike exists so the anomaly detector (§4) has something to find; spikes
are only ever injected into simulated data.

| Type | base | A | φ | σ |
|---|---|---|---|---|
| Noise (dB) | 52 | 12 | 18 | 3 |
| Water (WQI) | 68 | 4 | 12 | 2 |
| Soil moisture (%) | 42 | 8 | 6 | 2.5 |

Note on phase: `sin(2π(h − φ)/24)` crosses the baseline rising at h = φ and
reaches its maximum six hours later, at h = φ + 6.

Seed history for simulated sensors is 48 h at 60-minute steps. An administrator
can switch simulation off (`enableSensorSimulation`); simulated sensors that are
offline or in maintenance emit nothing.

### 8.3 One ingestion path

Virtual, simulated and physical (`device`) readings all pass through
`ingestReading`: anomaly verdict against the previous 50 readings → persist →
update cached value and status (`warning` when past `warnAbove`/`warnBelow`) →
raise or auto-resolve the threshold alert (severity by relative exceedance:
> 50 % critical, > 20 % high, else medium). Only `device` sensors accept
`POST /sensors/:id/readings`.

### 8.4 Reproducibility

The open-data snapshot is fixed until `npm run data:refresh` is run, so species,
observations and the biodiversity indices come back identically on every seed.
Demonstration records use **mulberry32**, a seeded PRNG (seed 20260828), so their
content repeats, although their dates are relative to the day of seeding.
Simulated sensor readings use `Math.random` and live Open-Meteo values change
with the weather, so sensor-derived scores differ between runs.

---

## 9. Generated Reports

**`backend/src/services/report.service.js`**

A report freezes `metrics` computed over `[now − days, now]` (EHI and
sub-indices, biodiversity indices over all records and within the period,
incidents, work orders, citizen reports, AI detections, and mean/min/max/anomaly
counts per sensor type with their sources) and derives each sentence from a
stated rule:

| Rule | Recommendation |
|---|---|
| weakest measured sub-index < 55 | prioritise that component |
| evenness J′ < 0.6 | favour native understorey planting |
| invasive records > 0 | map and schedule removal of invasive stands |
| mean AQI > 100 | publish advisories, extend buffer planting |
| mean water index < 50 | sample inflows, schedule weed removal |
| mean soil moisture < 30 % | mulch, review irrigation |
| overdue work orders > 0 | rebalance crews |
| critical incidents > 0 | review response times against targets |
| accepted / submitted < 0.5 | publish reporting guidance |

A metric with no data produces a sentence saying so rather than a number.

---

## 10. Integrity Rules

### 10.1 Reference codes

```
  seq ← findOneAndUpdate({ _id: prefix }, { $inc: { seq: 1 } }, upsert)
  code = prefix + "-" + zero-pad(seq, 4)          e.g. INC-2026-0031, WO-2026-0037, CR-2026-0037, TRE-0231
```

On first use a prefix's counter is initialised with `$max` to the highest
numeric suffix already stored. The counter never decreases, so deleting a record
cannot make a later code collide with an existing one.

### 10.2 Upvotes

```
  upvote:   findOneAndUpdate({ _id, upvotedBy: { $ne: user } }, { $addToSet: { upvotedBy: user }, $inc: { upvotes: 1 } })
  withdraw: findOneAndUpdate({ _id, upvotedBy: user },         { $pull:     { upvotedBy: user }, $inc: { upvotes: −1 } })
```

The condition and the update are one atomic operation, so two rapid clicks
cannot both count and a repeat is a no-op. After a change the linked incident's
`upvotes` is updated and its priority recomputed (§5).

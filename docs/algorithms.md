# Algorithms & Mathematics

Every formula the system uses, where it lives, and why it was chosen. This is
the document behind the Week-4 and Week-5 logs.

---

## 1. Air Quality Index

**`backend/src/services/aqi.service.js`**

### 1.1 Sub-index — piecewise linear interpolation

A pollutant concentration *C* is mapped to an index value using the breakpoint
table published by the **Central Pollution Control Board (CPCB, India)**:

```
        I_high − I_low
  I  =  ─────────────── · (C − C_low)  +  I_low
        C_high − C_low
```

where `[C_low, C_high]` is the concentration band containing *C* and
`[I_low, I_high]` is the matching index band.

**Worked example.** PM₂.₅ = 45 µg/m³ falls in the band 31–60 µg/m³, which maps
to index 51–100:

```
I = (100 − 51)/(60 − 31) × (45 − 31) + 51
  = 49/29 × 14 + 51
  = 23.66 + 51
  = 74.66  →  75
```

### 1.2 Overall AQI — the maximum operator

```
  AQI = max( I_PM2.5, I_PM10, I_NO2, I_SO2, I_CO, I_O3 )
```

**Why maximum, not mean.** Air is only as clean as its worst pollutant.
Averaging would let one hazardous pollutant hide behind five clean ones — a
sample with ozone at index 180 and everything else at 20 would average to about
47 and read "Satisfactory" when it is in fact "Moderate" and unsafe for people
with respiratory conditions.

### 1.3 Inversion to a 0–100 goodness score

AQI is an inverted scale (0 best, 500 worst) while every other index in the
project is 0–100 with higher better. `aqiToScore` interpolates linearly *within*
each CPCB band so the mapping is continuous while band edges land on round
numbers:

| AQI | 0 | 50 | 100 | 200 | 300 | 400 | 500 |
|---|---|---|---|---|---|---|---|
| Score | 100 | 100 | 80 | 60 | 40 | 20 | 0 |

A second uniform linear stretch was rejected: AQI is *already* piecewise linear,
so re-stretching it would distort the category boundaries the public recognises.

---

## 2. Biodiversity Indices

**`backend/src/services/biodiversity.service.js`**

Given *S* species with abundances n₁ … n_S, total N = Σ nᵢ, and proportional
abundance pᵢ = nᵢ / N:

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
drawn individual. H′ = 0 for a monoculture and rises with *both* richness and
evenness. Its maximum for S species is `H′_max = ln(S)`.

### 2.3 Pielou's evenness

```
  J′ = H′ / ln(S),   J′ ∈ [0, 1]
```

Isolates evenness from richness. J′ = 1 means every species is equally abundant.

**Worked comparison** — the case that shows why richness alone fails:

| Community | S | H′ | J′ |
|---|---|---|---|
| `100, 1, 1, 1` | 4 | 0.191 | 0.138 |
| `25, 25, 25, 25` | 4 | 1.386 | 1.000 |

Identical richness, wildly different ecological health. The first is a park
overrun by one invasive; the second is balanced.

*(Both are reproducible in the Index Calculator on the Biodiversity page.)*

### 2.4 Simpson's index

```
  D  = Σ pᵢ²                (probability two random individuals share a species)
  1 − D                     (Gini–Simpson diversity, rises with diversity)
```

### 2.5 Margalef richness

```
  D_Mg = (S − 1) / ln(N)
```

Richness corrected for sampling effort, so parks surveyed with different
intensities stay comparable.

### 2.6 Berger–Parker dominance

```
  d = max(pᵢ)
```

The share held by the commonest species. High dominance is what drags evenness
down, and is usually the fingerprint of an invasive.

### 2.7 Composite Biodiversity Score

```
  Score = 100 · ( 0.35·Ĥ + 0.25·J′ + 0.20·R̂ + 0.20·Ĉ )
```

| Term | Definition | Weight | Reasoning |
|---|---|---|---|
| Ĥ | H′ / ln(S_ref), capped at 1 | 0.35 | The only term reacting to richness *and* evenness at once |
| J′ | Pielou evenness | 0.25 | Separated out so a monoculture cannot score well on richness alone |
| R̂ | S / S_ref, capped at 1 | 0.20 | Raw species count still matters |
| Ĉ | Weighted share of threatened species | 0.20 | Recording a threatened species is stronger evidence of habitat quality |

`S_ref = 40` is the richness treated as "excellent" for an urban park.

Conservation weights: Least Concern 1, Near Threatened 2, Vulnerable 3,
Endangered 4, Critically Endangered 5.

### 2.8 A methodological caveat, stated rather than hidden

Ecologists compute diversity within a **taxocene** — one taxonomic group
surveyed by one method — not across all life at a site. Pooling birds,
butterflies and plant stems mixes units of survey effort: a botanist counting
stems in a quadrat produces far larger numbers than an ornithologist counting
individuals on a transect, and the pooled index then measures survey *method* as
much as diversity.

The project reports the pooled score because a park manager needs one comparable
number per park, **and** returns `byClassIndices` — the same mathematics applied
within each class. That is the figure to quote when comparing sites rigorously,
and it is rendered on the Biodiversity page.

---

## 3. Ecosystem Health Index

**`backend/src/services/ecosystem-score.service.js`**

```
  EHI = Σ wₖ · Sₖ  ⁄  Σ wₖ         k ∈ {air, water, soil, tree, biodiversity}
```

Default weights:

| Component | Weight | Reasoning |
|---|---|---|
| Air | 0.25 | Fastest-moving indicator, most direct effect on visitors |
| Water | 0.20 | |
| Tree health | 0.20 | |
| Biodiversity | 0.20 | |
| Soil | 0.15 | Changes slowly, least directly experienced |

**Why divide by Σw.** Two reasons. It makes the formula robust to an
administrator retuning weights that no longer sum to 1, and — more importantly —
it handles missing data correctly. A park with no soil sensor is scored on the
four indicators it *does* have, rather than being penalised with a zero it never
earned.

### 3.1 Normalising raw readings

Sensors report in incompatible units and directions. Three shapes cover them:

```
  higher-is-better   S = 100 · (x − min) / (max − min)
  lower-is-better    S = 100 · (max − x) / (max − min)
  band (optimal)     S = 100 · (1 − |x − c| / h),  clipped at 0
```

| Type | Shape | Parameters |
|---|---|---|
| AQI | CPCB category map | (special-cased, see §1.3) |
| Noise | lower-is-better | 35 dB → 100, 85 dB → 0 |
| Water, Soil | higher-is-better | already 0–100 |
| Temperature | band | centre 24 °C, half-width 14 |
| Humidity | band | centre 55 %, half-width 35 |

**Worked example.** Central Green Park: air 82.8, water 83.6, soil 46.9, tree
73.8, biodiversity 51.4.

```
EHI = (0.25×82.8 + 0.20×83.6 + 0.15×46.9 + 0.20×73.8 + 0.20×51.4) / 1.00
    = (20.70 + 16.72 + 7.04 + 14.76 + 10.28)
    = 69.5   →  "moderate"
```

Soil contributes only 7.04 of the 69.5 — visibly the weakest component, and
therefore where remediation earns most. That breakdown is rendered on the
dashboard.

### 3.2 Grade bands

| Score | Grade |
|---|---|
| ≥ 85 | excellent |
| ≥ 70 | good |
| ≥ 55 | moderate |
| ≥ 40 | poor |
| < 40 | critical |

---

## 4. Anomaly Detection

**`backend/src/services/anomaly.service.js`**

A reading must be flagged as unusual **for that sensor**, not merely past a
fixed threshold: 30 °C is unremarkable in a car park and alarming inside a
shaded wetland. Three detectors run over a rolling 50-reading window.

### 4.1 Z-score (parametric)

```
  μ = (1/n) Σ xᵢ
  σ = √( (1/(n−1)) Σ (xᵢ − μ)² )        [Bessel-corrected]
  z = (x − μ) / σ
```

Flagged when |z| > 3 — the ≈99.7 % interval of a normal distribution. Cheap and
interpretable, but σ is itself inflated by the very outliers it should detect.

### 4.2 Modified z-score (robust)

```
  MAD = median( |xᵢ − median(x)| )
  M   = 0.6745 · (x − median(x)) / MAD
```

The constant **0.6745 = Φ⁻¹(0.75)** makes MAD a consistent estimator of σ for
normal data, so the threshold |M| > 3.5 is comparable to the z-test's k = 3.
Because the median has a 50 % breakdown point, this detector is not fooled by a
handful of extreme values.

### 4.3 Tukey's IQR fence (non-parametric)

```
  IQR = Q₃ − Q₁
  outlier ⟺ x < Q₁ − 1.5·IQR   or   x > Q₃ + 1.5·IQR
```

Assumes no distribution at all — which matters for skewed variables such as AQI,
where the upper tail is genuinely long.

### 4.4 Majority vote

A reading is anomalous when **at least two of three** agree. Voting cuts the
false-positive rate any single detector produces on the noisy, non-stationary
data a park sensor generates.

---

## 5. Incident Triage

**`backend/src/services/priority.service.js`**

```
  P = 100 · ( 0.35·H + 0.25·Ŝ + 0.20·Ê + 0.10·Û + 0.10·Ĉ )
```

| Term | Definition |
|---|---|
| **H** | Hazard weight of the incident type, ∈ [0, 1] |
| **Ŝ** | Reported severity, (s − 1)/4 for s ∈ 1…5 |
| **Ê** | Exposure: `ln(1 + people) / ln(1 + 5000)`, capped at 1 |
| **Û** | Urgency from age (below) |
| **Ĉ** | Community signal: `ln(1 + upvotes) / ln(1 + 200)`, capped at 1 |

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

Resolved and closed incidents stop ageing.

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

*(This is the exact case the end-to-end test asserts.)*

---

## 6. AI Inference

**`backend/src/services/ai-inference.service.js`**

### 6.1 Intended production pipeline

```
1. Decode → resize 224×224 → normalise to ImageNet mean/σ
2. MobileNetV2 / EfficientNet-B0 backbone (pre-trained, frozen initially)
3. Global average pooling → dropout(0.2) → dense(C)
4. Softmax over the C task classes
5. Prediction = argmax pᵢ,  confidence = 100 · max pᵢ
```

**Transfer learning, not training from scratch.** The labelled data a municipal
deployment can realistically gather — a few thousand images per task — is far
too little to train a network from nothing, but ample to fine-tune a head on
ImageNet features.

### 6.2 Softmax with temperature

```
  pᵢ = e^((zᵢ − max z)/T)  ⁄  Σⱼ e^((zⱼ − max z)/T)
```

Subtracting `max z` prevents overflow without changing the result. T < 1
sharpens the distribution; the project uses T = 0.6.

### 6.3 What is simulated, and why it is honest

The logits come from a **SHA-256 digest** of `<task>:<image identifier>`, mapped
to roughly [−2, 6]. The asymmetric range makes one class usually dominate, which
is how a confident classifier behaves — a uniform range would produce
implausibly flat output.

Determinism matters for a demonstration: re-uploading the same photo gives the
same answer, so a live presentation cannot be derailed by a re-roll.

Setting `AI_MODEL_ENDPOINT` routes inference to a served model through the same
function; nothing downstream knows the difference.

### 6.4 Escalation rule

An incident is opened automatically only when **all three** hold:

1. Severity is `high` or `critical`
2. Confidence ≥ the configured floor (default 85 %)
3. A park was supplied, so the incident has a location

Otherwise the finding is queued for human review. A false fire alarm is
expensive, so the system prefers a missed auto-escalation over a wrong one.

---

## 7. Retrieval for the Assistant

**`backend/src/services/assistant.service.js`**

### 7.1 TF-IDF weighting

For term *t* in document *d* within a corpus *D* of *N* documents:

```
  tf(t,d)   = f(t,d) / |d|
  idf(t,D)  = ln( N / (1 + nₜ) ) + 1          [smoothed]
  w(t,d)    = tf(t,d) · idf(t,D)
```

### 7.2 Cosine similarity

```
             Σₜ qₜ · dₜ
  cos(q,d) = ───────────────
             ‖q‖₂ · ‖d‖₂
```

**Why cosine, not a raw dot product.** Document lengths here vary by an order of
magnitude — a species description dwarfs an incident title. Without length
normalisation, the long documents would always win regardless of relevance.

### 7.3 Intent classification

Lexicon matching with a specificity weight: a word that *names* an intent counts
double. Without that, "what is the biodiversity score?" ties at one hit each
between `biodiversity` ("biodiversity") and `health` ("score"), and the winner is
decided by object declaration order — which is not a decision that ordering
should be making.

The word `quality` is deliberately absent from the health lexicon because it
collides with "air quality" and "water quality".

### 7.4 Scope

Retrieval is genuine; generation is template-based over retrieved records. That
is the honest scope for a prototype, and it buys something an LLM would not:
every figure in an answer is traceable to the record it came from, and the
citations panel shows exactly which documents matched and how strongly.

---

## 8. Sensor Simulation

**`backend/src/services/sensor.service.js`**

Environmental variables are not white noise — they have a daily cycle and are
strongly autocorrelated:

```
  x_t = α·x_{t−1} + (1 − α)·( base + A·sin(2π(h − φ)/24) ) + ε
```

| Symbol | Meaning |
|---|---|
| α = 0.7 | AR(1) persistence, so the series drifts rather than jumping |
| A | Diurnal amplitude |
| φ | Hour of the daily peak |
| ε ~ N(0, σ) | Gaussian noise via Box–Muller |

**Box–Muller transform:**

```
  z = √(−2 ln u₁) · cos(2π u₂),   u₁, u₂ ~ U(0,1)
```

### 8.1 Anchoring to reality

`base` is not a hard-coded constant when the machine is online. Every 15 minutes
the simulator pulls live weather and CAMS air-quality data for each park's actual
coordinates and uses those as the baseline. The diurnal, autocorrelation and
noise terms then vary around that anchor at sensor cadence — which no public API
provides.

When anchored, the diurnal amplitude is **halved**, because the live figure
already includes the time of day and double-counting it would exaggerate the
swing.

Offline, the anchors never populate and the constants take over. Nothing breaks;
the data is just synthetic rather than tethered.

### 8.2 Diurnal profiles

| Type | Base | Amplitude | Peak hour | σ | Rationale |
|---|---|---|---|---|---|
| AQI | 72 | 28 | 09:00 | 6 | Rush-hour peak |
| Temperature | 24 | 6 | 15:00 | 0.8 | Warmest mid-afternoon |
| Humidity | 62 | 15 | 05:00 | 3 | Highest before dawn |
| Noise | 50 | 14 | 18:00 | 3 | Evening footfall |
| Water | 82 | 4 | 12:00 | 2 | |
| Soil | 45 | 8 | 06:00 | 2.5 | |

### 8.3 Reproducibility

The seed generator uses **mulberry32**, a seeded PRNG, so the same dataset comes
back on every reseed. A Shannon index of 2.71 quoted in a presentation will
still be 2.71 afterwards.

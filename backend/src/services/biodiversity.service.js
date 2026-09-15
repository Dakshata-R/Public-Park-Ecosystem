'use strict';

/**
 * Biodiversity mathematics — Module 4.
 *
 * Species counts alone are a poor measure of ecological health: a park with
 * 500 pigeons and one hawk is not as healthy as one with 250 of each, even
 * though both have two species and 501 individuals. The indices below capture
 * that difference.
 *
 * Given S species with abundances n_1 … n_S and total N = Σ n_i, the
 * proportional abundance of species i is p_i = n_i / N.
 *
 * ---------------------------------------------------------------------------
 * Species richness           S = number of distinct species observed
 * ---------------------------------------------------------------------------
 * Shannon–Wiener index       H' = −Σ p_i · ln(p_i)
 *   Information-theoretic: the uncertainty in guessing the species of a
 *   randomly drawn individual. H' = 0 for a monoculture and rises with both
 *   richness and evenness. Its maximum for S species is H'_max = ln(S).
 * ---------------------------------------------------------------------------
 * Pielou's evenness          J' = H' / ln(S),   J' ∈ [0, 1]
 *   Isolates evenness from richness. J' = 1 means every species is equally
 *   abundant.
 * ---------------------------------------------------------------------------
 * Simpson's index            D = Σ p_i²
 *   Probability that two individuals drawn at random are the same species.
 *   Reported as the Gini–Simpson diversity 1 − D, which rises with diversity.
 * ---------------------------------------------------------------------------
 * Margalef richness          D_Mg = (S − 1) / ln(N)
 *   Richness corrected for sampling effort, so parks surveyed with different
 *   intensities remain comparable.
 * ---------------------------------------------------------------------------
 *
 * The single 0–100 Biodiversity Score reported to users combines four
 * normalised components (see `biodiversityScore` for the weights and the
 * reasoning behind each).
 *
 * ---------------------------------------------------------------------------
 * A methodological caveat, stated rather than hidden
 * ---------------------------------------------------------------------------
 * Ecologists normally compute diversity within a *taxocene* — one taxonomic
 * group surveyed by one method — not across all life at a site. Pooling birds,
 * butterflies and plant stems into a single Shannon index mixes units of
 * effort: a botanist counting stems in a quadrat produces far larger numbers
 * than an ornithologist counting individuals on a transect, and the pooled
 * index then measures survey method as much as it measures diversity.
 *
 * This project reports the pooled index because a park manager needs one
 * comparable number per park, but `analyseBiodiversity` also returns
 * `byClassIndices` — the same mathematics applied within each taxonomic class,
 * which is the methodologically defensible view and the one to quote when
 * comparing sites.
 */

const { Observation, Species } = require('../models');
const { toObjectId } = require('../utils/objectId');

/** Reference richness: the species count treated as "excellent" for a park. */
const RICHNESS_REFERENCE = 40;

/**
 * Conservation weighting. Recording a threatened species is stronger evidence
 * of habitat quality than recording a ubiquitous one, so rarer categories
 * contribute more to the conservation component.
 */
const CONSERVATION_WEIGHTS = {
  'Least Concern': 1,
  'Near Threatened': 2,
  Vulnerable: 3,
  Endangered: 4,
  'Critically Endangered': 5,
};

/**
 * Core index calculations over a plain abundance vector.
 *
 * @param {number[]} abundances Individuals observed per species (n_i > 0)
 * @returns {{richness:number,total:number,shannon:number,shannonMax:number,
 *            evenness:number,simpson:number,simpsonDiversity:number,
 *            margalef:number,dominance:number}}
 */
function computeIndices(abundances = []) {
  const counts = abundances.filter((n) => Number.isFinite(n) && n > 0);
  const richness = counts.length;
  const total = counts.reduce((sum, n) => sum + n, 0);

  if (richness === 0 || total === 0) {
    return {
      richness: 0, total: 0, shannon: 0, shannonMax: 0, evenness: 0,
      simpson: 0, simpsonDiversity: 0, margalef: 0, dominance: 0,
    };
  }

  const proportions = counts.map((n) => n / total);

  // H' = −Σ p ln p
  const shannon = -proportions.reduce((sum, p) => sum + p * Math.log(p), 0);
  const shannonMax = Math.log(richness);

  // J' = H'/ln(S); a single-species community is defined as evenness 0.
  const evenness = shannonMax > 0 ? shannon / shannonMax : 0;

  // D = Σ p²  →  Gini–Simpson diversity 1 − D
  const simpson = proportions.reduce((sum, p) => sum + p * p, 0);

  // D_Mg = (S−1)/ln(N); undefined for N = 1, reported as 0.
  const margalef = total > 1 ? (richness - 1) / Math.log(total) : 0;

  // Berger–Parker dominance: share held by the commonest species.
  const dominance = Math.max(...proportions);

  // `+ 0` collapses -0 to 0: a one-species community gives H' = −(1·ln 1),
  // which evaluates to negative zero. Harmless once serialised, but a
  // negative diversity index is meaningless and breaks identity comparisons.
  const round = (v) => Math.round(v * 10000) / 10000 + 0;

  return {
    richness,
    total,
    shannon: round(shannon),
    shannonMax: round(shannonMax),
    evenness: round(evenness),
    simpson: round(simpson),
    simpsonDiversity: round(1 - simpson),
    margalef: round(margalef),
    dominance: round(dominance),
  };
}

/**
 * Collapse the indices into a single 0–100 Biodiversity Score.
 *
 *   Score = 100 · (0.35·Ĥ + 0.25·J' + 0.20·R̂ + 0.20·Ĉ)
 *
 *   Ĥ  = H'/ln(S_ref)   normalised Shannon (capped at 1)
 *   J'                   Pielou evenness, already in [0, 1]
 *   R̂  = S/S_ref        normalised richness (capped at 1)
 *   Ĉ                    conservation component — the weighted share of
 *                        observations belonging to non-"Least Concern" species,
 *                        scaled so that a park holding threatened species
 *                        scores higher than one holding only common ones
 *
 * Shannon carries the largest weight because it is the only term that reacts
 * to richness and evenness simultaneously. Evenness is separated out so a park
 * dominated by one invasive species cannot score well on richness alone.
 *
 * @param {ReturnType<typeof computeIndices>} indices
 * @param {number} [conservationComponent=0] Ĉ in [0, 1]
 * @returns {number} 0–100, one decimal place
 */
function biodiversityScore(indices, conservationComponent = 0) {
  if (!indices || indices.richness === 0) return 0;

  const referenceMax = Math.log(RICHNESS_REFERENCE);
  const normalisedShannon = Math.min(1, indices.shannon / referenceMax);
  const normalisedRichness = Math.min(1, indices.richness / RICHNESS_REFERENCE);
  const conservation = Math.min(1, Math.max(0, conservationComponent));

  const score =
    100 *
    (0.35 * normalisedShannon +
      0.25 * indices.evenness +
      0.2 * normalisedRichness +
      0.2 * conservation);

  return Math.round(score * 10) / 10;
}

/**
 * Aggregate observations from MongoDB and compute every index.
 *
 * Only verified observations count — unverified citizen submissions would let
 * a single enthusiastic (or mistaken) reporter move a park's score.
 *
 * @param {object} [options]
 * @param {import('mongoose').Types.ObjectId|string} [options.parkId] Restrict to one park
 * @param {Date} [options.since] Only observations at or after this instant
 * @returns {Promise<object>} indices + score + per-species and per-class breakdowns
 */
async function analyseBiodiversity({ parkId, since } = {}) {
  const match = { verified: true };
  if (parkId) match.park = toObjectId(parkId);
  if (since) match.observedAt = { $gte: since };

  // Abundance per species, joined to the catalogue for class and status.
  const grouped = await Observation.aggregate([
    { $match: match },
    { $group: { _id: '$species', count: { $sum: '$count' }, sightings: { $sum: 1 } } },
    {
      $lookup: {
        from: Species.collection.name,
        localField: '_id',
        foreignField: '_id',
        as: 'species',
      },
    },
    { $unwind: '$species' },
    {
      $project: {
        _id: 0,
        speciesId: '$_id',
        count: 1,
        sightings: 1,
        commonName: '$species.commonName',
        scientificName: '$species.scientificName',
        class: '$species.class',
        conservationStatus: '$species.conservationStatus',
        isInvasive: '$species.isInvasive',
      },
    },
    { $sort: { count: -1 } },
  ]);

  const indices = computeIndices(grouped.map((g) => g.count));

  // Conservation component Ĉ: weighted share of observations from species of
  // elevated concern, divided by the maximum weight so Ĉ ∈ [0, 1].
  const totalIndividuals = indices.total || 1;
  const weightedConcern = grouped.reduce((sum, g) => {
    const weight = CONSERVATION_WEIGHTS[g.conservationStatus] ?? 1;
    return sum + (weight - 1) * g.count; // "Least Concern" contributes nothing
  }, 0);
  const maxWeight = Math.max(...Object.values(CONSERVATION_WEIGHTS)) - 1;
  const conservationComponent = Math.min(1, weightedConcern / (totalIndividuals * maxWeight));

  const byClass = grouped.reduce((acc, g) => {
    acc[g.class] = (acc[g.class] || 0) + g.count;
    return acc;
  }, {});

  /**
   * The same indices computed within each taxonomic class — the taxocene view
   * described in the header note. Comparing two parks on their bird Shannon
   * index is sound in a way that comparing pooled indices is not.
   */
  const abundancesByClass = grouped.reduce((acc, g) => {
    (acc[g.class] ||= []).push(g.count);
    return acc;
  }, {});

  const byClassIndices = Object.fromEntries(
    Object.entries(abundancesByClass).map(([className, abundances]) => [
      className,
      { ...computeIndices(abundances), individuals: abundances.reduce((a, b) => a + b, 0) },
    ])
  );

  const byConservation = grouped.reduce((acc, g) => {
    acc[g.conservationStatus] = (acc[g.conservationStatus] || 0) + 1;
    return acc;
  }, {});

  return {
    ...indices,
    conservationComponent: Math.round(conservationComponent * 10000) / 10000,
    score: biodiversityScore(indices, conservationComponent),
    invasiveCount: grouped.filter((g) => g.isInvasive).reduce((s, g) => s + g.count, 0),
    threatenedSpecies: grouped.filter((g) => g.conservationStatus !== 'Least Concern').length,
    byClass,
    byClassIndices,
    byConservation,
    species: grouped,
  };
}

module.exports = {
  computeIndices,
  biodiversityScore,
  analyseBiodiversity,
  CONSERVATION_WEIGHTS,
  RICHNESS_REFERENCE,
};

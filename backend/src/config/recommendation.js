// Rule-based recommendation scoring. Tune here; no code changes needed.
export const RECOMMENDATION_CONFIG = Object.freeze({
  // Relative importance of each soft preference. Only components that apply to a request
  // count (e.g. `interest` only when interests were given); the score is normalised to 0–100.
  weights: Object.freeze({
    interest: 25,
    category: 15,
    proximity: 20,
    budget: 10,
    rating: 15,
    popularity: 5,
    schedule: 10,
  }),

  // Component score (0–1) when the data needed is UNKNOWN (no fee, no ratings, no hours):
  // below average, never rewarded as if it were good.
  unknownScore: 0.25,

  // Bayesian rating: a 5.0 from one review should not beat a 4.6 from two hundred.
  ratingPrior: Object.freeze({ mean: 3, weight: 3 }),

  // Review count at which popularity is maxed out (log scale).
  popularityTargetReviews: 50,

  // Nearest approved places considered per request.
  maxCandidates: 500,

  // Show "what limited the results" suggestions when fewer than this many places qualify.
  suggestBelow: 3,

  // "Today" when a request has no start date. Opening hours are local to this zone.
  timezone: 'Asia/Dhaka',
});

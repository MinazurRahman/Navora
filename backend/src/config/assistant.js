// AI Trip Assistant limits. Small on purpose: every field ends up in the model's prompt.
export const ASSISTANT_CONFIG = Object.freeze({
  // Asked from the recommendation engine (its own maximum), so itinerary places can be
  // matched with their score and reasons.
  recommendationCandidates: 50,
  // Recommended places shown in addition to the itinerary's own places.
  maxRecommendations: 10,
  // Community-written text: short, and only as data.
  maxDescriptionChars: 200,
});

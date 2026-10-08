// AI Trip Assistant limits. Small on purpose: every field ends up in the model's prompt.
export const ASSISTANT_CONFIG = Object.freeze({
  // Asked from the recommendation engine (its own maximum), so itinerary places can be
  // matched with their score and reasons.
  recommendationCandidates: 50,
  // Recommended places shown in addition to the itinerary's own places.
  maxRecommendations: 10,
  // Community-written text: short, and only as data.
  maxDescriptionChars: 200,

  // Request and response bounds.
  maxQuestionChars: 500,
  maxAnswerChars: 2_000,
  maxSuggestions: 5,
  maxRationaleChars: 300,

  // Prompt budget = (context window − answer tokens − reserve) × charsPerToken. Conservative:
  // JSON with numbers and short words averages above 3 characters per token.
  charsPerToken: 3,
  promptReserveTokens: 256,

  // Low: answers should restate Navora's data, not be creative.
  temperature: 0.2,
  // The provider enforces AI_TIMEOUT_MS itself; the service stops waiting this much later
  // in case a provider ignores cancellation.
  timeoutGraceMs: 1_000,
});

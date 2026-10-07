// All rate-limit policies in one place. Sliding window; `window` uses Upstash duration
// syntax ("10 s", "15 m", "1 d"). Numbers are starting points: tune here.
//
// failOpen: what happens when Redis is unreachable.
//   true  → allow the request (log the failure). Ordinary endpoints.
//   false → reject with 503. Security-sensitive or costly endpoints.
export const RATE_LIMIT_POLICIES = Object.freeze({
  // Every /api/v1 request, per user (valid token) or per IP.
  general: { limit: 600, window: '15 m', failOpen: true },
  // Login/register brute force against one account, per IP + email.
  authAccount: { limit: 10, window: '15 m', failOpen: false },
  // Login/register spraying many emails from one IP. Loose enough for a campus NAT.
  authIp: { limit: 100, window: '15 m', failOpen: false },
  // Community place submissions, per user.
  submissions: { limit: 20, window: '1 d', failOpen: true },
  // New reviews, per user.
  reviews: { limit: 30, window: '1 d', failOpen: true },
  // Recommendation scoring (CPU-heavy, no paid API), per user or IP.
  recommendations: { limit: 20, window: '1 m', failOpen: true },
  // Itinerary generation/regeneration and route optimization: calls a paid routing API,
  // so it fails closed (decision confirmed 2026-10-01).
  routing: { limit: 10, window: '1 m', failOpen: false },
  // AI Trip Assistant, per user. A local model is CPU-heavy and shared by every instance,
  // so both limits fail closed.
  assistant: { limit: 10, window: '1 m', failOpen: false },
  assistantDaily: { limit: 100, window: '1 d', failOpen: false },
});

// Our own timeout. Upstash's built-in one ALLOWS the request on timeout, which would
// silently turn fail-closed policies into fail-open, so it is disabled.
export const RATE_LIMIT_TIMEOUT_MS = 1_000;

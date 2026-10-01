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
});

// Our own timeout. Upstash's built-in one ALLOWS the request on timeout, which would
// silently turn fail-closed policies into fail-open, so it is disabled.
export const RATE_LIMIT_TIMEOUT_MS = 1_000;

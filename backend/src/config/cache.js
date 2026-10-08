// Longest a single cache call may take before the request falls back to the database.
export const CACHE_TIMEOUT_MS = 500;

// Cache TTLs in seconds. Short on purpose: invalidation handles writes, TTLs bound the
// damage if an invalidation is ever missed (e.g. Redis briefly unreachable).
export const CACHE_TTL = Object.freeze({
  placeDetail: 300,
  placeLists: 120, // list, nearby, search
  recommendations: 120,
  // Road travel times do not depend on our data; only real provider results are cached.
  routing: 24 * 60 * 60,
  // AI availability (not per user): polling the status endpoint reaches the AI provider at
  // most once per TTL across all instances. Short, so a restarted or stopped provider shows quickly.
  aiStatus: 15,
});

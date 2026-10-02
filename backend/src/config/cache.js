// Cache TTLs in seconds. Short on purpose: invalidation handles writes, TTLs bound the
// damage if an invalidation is ever missed (e.g. Redis briefly unreachable).
export const CACHE_TTL = Object.freeze({
  placeDetail: 300,
  placeLists: 120, // list, nearby, search
  recommendations: 120,
  // Road travel times do not depend on our data; only real provider results are cached.
  routing: 24 * 60 * 60,
});

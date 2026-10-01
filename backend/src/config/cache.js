// Cache TTLs in seconds. Short on purpose: invalidation handles writes, TTLs bound the
// damage if an invalidation is ever missed (e.g. Redis briefly unreachable).
export const CACHE_TTL = Object.freeze({
  placeDetail: 300,
  placeLists: 120, // list, nearby, search
});

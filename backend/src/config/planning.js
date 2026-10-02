// Trip planning assumptions. Tune here.
export const PLANNING_CONFIG = Object.freeze({
  // Hard cap so no day is overloaded, even if the time would technically fit.
  maxStopsPerDay: 6,

  // Slack between stops (finding the entrance, tickets, a short rest).
  bufferMinutesBetweenStops: 10,

  // The day must leave time to get back to the start location (hotel, home).
  returnToStart: true,

  // Travel-time ESTIMATE when no routing provider is configured: straight-line distance
  // × detour factor ÷ average speed, plus a fixed overhead per leg (parking, waiting).
  // Itineraries built this way are marked travelTimesEstimated = true.
  // The per-leg overhead is also added to provider times, which are pure moving time
  // (OpenRouteService assumes free-flowing traffic).
  detourFactor: 1.35,
  speedsKmh: Object.freeze({ car: 18, walking: 4.5, cycling: 12, public_transport: 14 }),
  legOverheadMinutes: Object.freeze({ car: 10, walking: 0, cycling: 3, public_transport: 10 }),

  // Visit duration when a place has no typical_visit_minutes.
  defaultVisitMinutes: 60,
  visitMinutesByCategory: Object.freeze({
    museum: 90,
    historical_site: 75,
    religious_site: 30,
    park: 60,
    lake_or_river: 45,
    viewpoint: 30,
    restaurant: 60,
    cafe: 45,
    street_food: 30,
    market: 60,
    shopping_mall: 90,
    art_gallery: 60,
    cultural_center: 60,
    library: 45,
    zoo: 120,
    amusement_park: 180,
  }),

  // Candidates considered by the planner (best-ranked first).
  maxCandidatesPerDay: 20,

  // ponytail: clustering heuristic. Starting an empty day costs a full out-and-back trip,
  // shared by every stop that later joins that day, so only this fraction of it counts
  // when comparing days. Without it, far-apart places get piled onto the same day.
  // Upgrade path: proper clustering (e.g. k-medoids) before allocation.
  newDayCostFactor: 0.5,
});

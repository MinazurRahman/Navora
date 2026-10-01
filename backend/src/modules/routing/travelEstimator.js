import { PLANNING_CONFIG } from '../../config/planning.js';

const EARTH_RADIUS_METERS = 6_371_008.8;
const toRadians = (degrees) => (degrees * Math.PI) / 180;

// Great-circle distance between two { latitude, longitude } points. Only used for a few
// legs between already-selected stops; dataset-wide distance queries stay in PostGIS.
export function haversineMeters(a, b) {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

// ponytail: straight-line ESTIMATE (distance × detour factor ÷ mode speed + per-leg
// overhead). Replace with a routing provider's distance matrix behind the same signature.
export function createEstimatedTravel(config = PLANNING_CONFIG) {
  return function travel(from, to, mode) {
    const distanceMeters = Math.round(haversineMeters(from, to) * config.detourFactor);
    if (distanceMeters === 0) return { distanceMeters: 0, durationSeconds: 0 };
    const minutes = (distanceMeters / 1000 / config.speedsKmh[mode]) * 60 + config.legOverheadMinutes[mode];
    return { distanceMeters, durationSeconds: Math.round(minutes * 60) };
  };
}

export const ESTIMATED_TRAVEL_PROVIDER = 'estimate';

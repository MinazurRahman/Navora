import { createEstimatedTravel } from '../../../modules/routing/travelEstimator.js';

// Straight-line estimates: no network, every mode, never fails. Used as the default
// provider and as the fallback when a real provider fails.
export function createEstimateProvider(planningConfig) {
  const travel = createEstimatedTravel(planningConfig);

  return {
    name: 'estimate',
    supportsMode: () => true,

    async getDistanceMatrix(points, mode) {
      const legs = points.map((from) => points.map((to) => travel(from, to, mode)));
      return {
        durations: legs.map((row) => row.map((leg) => leg.durationSeconds)),
        distances: legs.map((row) => row.map((leg) => leg.distanceMeters)),
      };
    },

    async getRoute(points, mode) {
      const legs = points.slice(1).map((to, i) => travel(points[i], to, mode));
      return {
        distanceMeters: legs.reduce((sum, leg) => sum + leg.distanceMeters, 0),
        durationSeconds: legs.reduce((sum, leg) => sum + leg.durationSeconds, 0),
        legs,
        geometry: null, // no road geometry without a real provider
      };
    },
  };
}

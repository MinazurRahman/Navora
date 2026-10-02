import { PLANNING_CONFIG } from '../../config/planning.js';

const pointKey = (p) => `${p.latitude},${p.longitude}`;

// travel(from, to) backed by a map-service distance matrix over `points`.
// Provider times are pure moving time; parking/waiting happens anyway, so the same per-leg
// overhead the estimate includes is added (estimates already contain it).
export function createMatrixTravel(points, matrix, mode, config = PLANNING_CONFIG) {
  const index = new Map(points.map((p, i) => [pointKey(p), i]));
  const overheadSeconds = matrix.provider === 'estimate' ? 0 : config.legOverheadMinutes[mode] * 60;

  return function travel(from, to) {
    const i = index.get(pointKey(from));
    const j = index.get(pointKey(to));
    const seconds = matrix.durations[i][j];
    return { durationSeconds: seconds > 0 ? seconds + overheadSeconds : 0, distanceMeters: matrix.distances[i][j] };
  };
}

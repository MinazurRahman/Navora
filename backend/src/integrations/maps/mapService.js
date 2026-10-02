import { hashKey } from '../redis/cache.js';
import { getLogger } from '../../shared/logger.js';
import { ServiceUnavailableError } from '../../shared/errors/AppError.js';
import { MAP_ERROR, MapProviderError } from './errors.js';

// Above this a single request is too expensive (ORS free tier: 3,500 matrix cells).
export const MAX_POINTS = 50;

const round5 = (value) => Math.round(value * 1e5) / 1e5; // ~1 m: stable cache keys
const pointsKey = (points) => hashKey({ points: points.map((p) => [round5(p.latitude), round5(p.longitude)]) });

function assertPoints(points, min) {
  const valid =
    Array.isArray(points) &&
    points.length >= min &&
    points.length <= MAX_POINTS &&
    points.every((p) => Math.abs(p?.latitude) <= 90 && Math.abs(p?.longitude) <= 180);
  // Callers are our own services, so this is a programming error, not a client error.
  if (!valid) throw new Error(`Map service needs ${min}–${MAX_POINTS} valid { latitude, longitude } points`);
}

/**
 * The application's only view of routing. Results always say where they came from:
 *   { ..., provider: 'openrouteservice' | 'estimate', estimated: boolean, fallbackReason? }
 *
 * - getDistanceMatrix(points, mode) → { durations[from][to] (s), distances[from][to] (m) }
 * - getRoute(points, mode)          → { distanceMeters, durationSeconds, legs[] | null, geometry }
 * - getTravelTime(from, to, mode)   → { distanceMeters, durationSeconds }
 *
 * Provider failures (timeout, rate limit, outage, no route, missing data, unsupported
 * mode) are logged and answered with clearly flagged estimates, or a 503 when fallback
 * is disabled. Only real provider results are cached.
 */
// Provider errors echo the coordinates sent (e.g. "…coordinate 1: 90.0000000 21.0000000"):
// users' locations must not end up in logs.
export const maskCoordinates = (text) => text.replace(/-?\d{1,3}\.\d{2,}/g, '<coord>');

export function createMapService({ provider, fallback, cache, ttlSeconds, fallbackToEstimate = true }) {
  async function useFallback(kind, detail, run) {
    getLogger().warn({ provider: provider.name, kind, detail: maskCoordinates(detail) }, 'Routing provider failed; using estimates');
    if (!fallbackToEstimate) {
      throw new ServiceUnavailableError('Routing service is temporarily unavailable', { reason: kind }, 'ROUTING_UNAVAILABLE');
    }
    return { ...(await run(fallback)), provider: fallback.name, estimated: true, fallbackReason: kind };
  }

  // Calls the provider; any failure (incl. unexpected ones) becomes a fallback.
  async function callProvider(operation, run) {
    if (provider === fallback) return { ...(await run(fallback)), provider: fallback.name, estimated: true };
    try {
      return { ...(await run(provider)), provider: provider.name, estimated: false };
    } catch (err) {
      const kind = err instanceof MapProviderError ? err.kind : MAP_ERROR.UNAVAILABLE;
      return useFallback(kind, `${operation}: ${err.message}`, run);
    }
  }

  const cached = (key, load) => cache.getOrSet(key, ttlSeconds, load, { cacheIf: (result) => !result.estimated });

  async function getDistanceMatrix(points, mode) {
    assertPoints(points, 1);
    if (!provider.supportsMode(mode)) {
      return useFallback(MAP_ERROR.UNSUPPORTED_MODE, `mode ${mode}`, (p) => p.getDistanceMatrix(points, mode));
    }

    return cached(`route:matrix:${provider.name}:${mode}:${pointsKey(points)}`, async () => {
      const result = await callProvider('matrix', (p) => p.getDistanceMatrix(points, mode));
      const unreachable = result.durations.some((row) => row.some((v) => v === null)) || result.distances.some((row) => row.some((v) => v === null));
      if (!unreachable) return result;

      // Missing pairs (no road route): estimate just those cells, and say so.
      const estimate = await fallback.getDistanceMatrix(points, mode);
      getLogger().warn({ provider: provider.name, mode }, 'Routing matrix has missing pairs; estimating them');
      return {
        ...result,
        durations: result.durations.map((row, i) => row.map((v, j) => v ?? estimate.durations[i][j])),
        distances: result.distances.map((row, i) => row.map((v, j) => v ?? estimate.distances[i][j])),
        estimated: true,
        fallbackReason: MAP_ERROR.MISSING_DATA,
      };
    });
  }

  async function getRoute(points, mode) {
    assertPoints(points, 2);
    if (!provider.supportsMode(mode)) {
      return useFallback(MAP_ERROR.UNSUPPORTED_MODE, `mode ${mode}`, (p) => p.getRoute(points, mode));
    }
    return cached(`route:path:${provider.name}:${mode}:${pointsKey(points)}`, () => callProvider('route', (p) => p.getRoute(points, mode)));
  }

  async function getTravelTime(from, to, mode) {
    const matrix = await getDistanceMatrix([from, to], mode);
    return {
      distanceMeters: matrix.distances[0][1],
      durationSeconds: matrix.durations[0][1],
      provider: matrix.provider,
      estimated: matrix.estimated,
      ...(matrix.fallbackReason && { fallbackReason: matrix.fallbackReason }),
    };
  }

  return { providerName: provider.name, getDistanceMatrix, getRoute, getTravelTime };
}

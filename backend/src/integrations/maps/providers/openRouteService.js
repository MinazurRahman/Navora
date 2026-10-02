import { MAP_ERROR, MapProviderError } from '../errors.js';

// OpenRouteService v2 (https://openrouteservice.org/dev/#/api-docs). Only this file knows
// its URLs, profiles, request and response shapes. No public transport profile.
const PROFILES = Object.freeze({ car: 'driving-car', walking: 'foot-walking', cycling: 'cycling-regular' });
const toLngLat = ({ latitude, longitude }) => [longitude, latitude];

export function createOpenRouteServiceProvider({ apiKey, timeoutMs, baseUrl = 'https://api.openrouteservice.org', fetchImpl = fetch }) {
  async function post(path, body) {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { Authorization: apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        throw new MapProviderError(MAP_ERROR.TIMEOUT, `No response within ${timeoutMs}ms`);
      }
      throw new MapProviderError(MAP_ERROR.UNAVAILABLE, `Network error: ${err.message}`);
    }

    const payload = await response.json().catch(() => null);
    if (response.ok) {
      if (payload === null) throw new MapProviderError(MAP_ERROR.UNAVAILABLE, 'Unparseable response', { status: response.status });
      return payload;
    }

    const detail = payload?.error?.message ?? `HTTP ${response.status}`;
    if (response.status === 429) throw new MapProviderError(MAP_ERROR.RATE_LIMITED, detail, { status: 429 });
    if (response.status >= 500) throw new MapProviderError(MAP_ERROR.UNAVAILABLE, detail, { status: response.status });
    // 400/404: unroutable points, no route between them, invalid coordinates.
    throw new MapProviderError(MAP_ERROR.INVALID_ROUTE, detail, { status: response.status });
  }

  // One retry for transient failures (timeouts and rate limits are not retried: that
  // would only make the caller wait longer or burn more quota).
  async function postWithRetry(path, body) {
    try {
      return await post(path, body);
    } catch (err) {
      if (err.kind !== MAP_ERROR.UNAVAILABLE) throw err;
      return post(path, body);
    }
  }

  function profileFor(mode) {
    const profile = PROFILES[mode];
    if (!profile) throw new MapProviderError(MAP_ERROR.UNSUPPORTED_MODE, `No OpenRouteService profile for "${mode}"`);
    return profile;
  }

  return {
    name: 'openrouteservice',
    supportsMode: (mode) => mode in PROFILES,

    // durations (s) / distances (m) as [from][to]; null where the provider has no route.
    async getDistanceMatrix(points, mode) {
      const data = await postWithRetry(`/v2/matrix/${profileFor(mode)}`, {
        locations: points.map(toLngLat),
        metrics: ['duration', 'distance'],
        units: 'm',
      });
      if (!Array.isArray(data.durations) || !Array.isArray(data.distances)) {
        throw new MapProviderError(MAP_ERROR.MISSING_DATA, 'Matrix response has no durations/distances');
      }
      return { durations: data.durations, distances: data.distances };
    },

    async getRoute(points, mode) {
      const data = await postWithRetry(`/v2/directions/${profileFor(mode)}`, {
        coordinates: points.map(toLngLat),
        instructions: false,
      });
      const route = data.routes?.[0];
      if (!route?.summary || !Array.isArray(route.segments)) {
        throw new MapProviderError(MAP_ERROR.MISSING_DATA, 'Directions response has no route');
      }
      return {
        distanceMeters: Math.round(route.summary.distance ?? 0),
        durationSeconds: Math.round(route.summary.duration ?? 0),
        legs: route.segments.map((s) => ({ distanceMeters: Math.round(s.distance), durationSeconds: Math.round(s.duration) })),
        geometry: typeof route.geometry === 'string' ? route.geometry : null, // encoded polyline (precision 5)
      };
    },
  };
}

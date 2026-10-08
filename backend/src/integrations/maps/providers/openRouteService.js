import { MAP_ERROR, MapProviderError } from '../errors.js';

// OpenRouteService v2 (https://openrouteservice.org/dev/#/api-docs). Only this file knows
// its URLs, profiles, request and response shapes. No public transport profile.
const PROFILES = Object.freeze({ car: 'driving-car', walking: 'foot-walking', cycling: 'cycling-regular' });
const toLngLat = ({ latitude, longitude }) => [longitude, latitude];

export function createOpenRouteServiceProvider({ apiKey, timeoutMs, baseUrl = 'https://api.openrouteservice.org', fetchImpl = fetch }) {
  // signal (optional): the caller's own limit, e.g. the request's routing budget (mapService).
  async function post(path, body, signal) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([timeout, signal]) : timeout;
    const timedOut = () =>
      new MapProviderError(MAP_ERROR.TIMEOUT, timeout.aborted ? `No response within ${timeoutMs}ms` : 'Routing time budget for this request used up');

    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { Authorization: apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
        signal: combined,
      });
    } catch (err) {
      if (combined.aborted || err.name === 'TimeoutError' || err.name === 'AbortError') throw timedOut();
      throw new MapProviderError(MAP_ERROR.UNAVAILABLE, `Network error: ${err.message}`);
    }

    const payload = await response.json().catch(() => null);
    // Cut off while reading the body: a timeout, not an unparseable (retryable) response.
    if (combined.aborted) throw timedOut();
    if (response.ok) {
      if (payload === null) throw new MapProviderError(MAP_ERROR.UNAVAILABLE, 'Unparseable response', { status: response.status });
      return payload;
    }

    const detail = payload?.error?.message ?? `HTTP ${response.status}`;
    if (response.status === 429) throw new MapProviderError(MAP_ERROR.RATE_LIMITED, detail, { status: 429 });
    // A wrong, expired or blocked MAP_API_KEY: the provider is unusable, the route is not invalid.
    if (response.status === 401 || response.status === 403) {
      throw new MapProviderError(MAP_ERROR.UNAVAILABLE, `API key rejected (HTTP ${response.status}): ${detail}`, { status: response.status });
    }
    if (response.status >= 500) throw new MapProviderError(MAP_ERROR.UNAVAILABLE, detail, { status: response.status });
    // 400/404: unroutable points, no route between them, invalid coordinates.
    throw new MapProviderError(MAP_ERROR.INVALID_ROUTE, detail, { status: response.status });
  }

  // One retry for transient failures (timeouts and rate limits are not retried: that
  // would only make the caller wait longer or burn more quota; neither is a rejected key).
  async function postWithRetry(path, body, signal) {
    try {
      return await post(path, body, signal);
    } catch (err) {
      if (err.kind !== MAP_ERROR.UNAVAILABLE || err.status === 401 || err.status === 403) throw err;
      return post(path, body, signal);
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
    async getDistanceMatrix(points, mode, { signal } = {}) {
      const data = await postWithRetry(`/v2/matrix/${profileFor(mode)}`, {
        locations: points.map(toLngLat),
        metrics: ['duration', 'distance'],
        units: 'm',
      }, signal);
      if (!Array.isArray(data.durations) || !Array.isArray(data.distances)) {
        throw new MapProviderError(MAP_ERROR.MISSING_DATA, 'Matrix response has no durations/distances');
      }
      // ORS returns fractions (e.g. 1078.35 s); the app works in whole seconds/metres.
      const whole = (matrix) => matrix.map((row) => row.map((value) => (value === null ? null : Math.round(value))));
      return { durations: whole(data.durations), distances: whole(data.distances) };
    },

    async getRoute(points, mode, { signal } = {}) {
      const data = await postWithRetry(`/v2/directions/${profileFor(mode)}`, {
        coordinates: points.map(toLngLat),
        instructions: false,
      }, signal);
      const route = data.routes?.[0];
      if (!route?.summary) {
        throw new MapProviderError(MAP_ERROR.MISSING_DATA, 'Directions response has no route');
      }
      return {
        distanceMeters: Math.round(route.summary.distance ?? 0),
        durationSeconds: Math.round(route.summary.duration ?? 0),
        // ORS only sends per-leg segments together with turn-by-turn instructions, which
        // we do not request (per-leg times come from the matrix). null when absent.
        legs: Array.isArray(route.segments)
          ? route.segments.map((s) => ({ distanceMeters: Math.round(s.distance), durationSeconds: Math.round(s.duration) }))
          : null,
        geometry: typeof route.geometry === 'string' ? route.geometry : null, // encoded polyline (precision 5)
      };
    },
  };
}

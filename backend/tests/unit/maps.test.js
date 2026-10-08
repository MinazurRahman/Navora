import { describe, expect, it, vi } from 'vitest';
import { createOpenRouteServiceProvider } from '../../src/integrations/maps/providers/openRouteService.js';
import { createEstimateProvider } from '../../src/integrations/maps/providers/estimate.js';
import { createMapService, maskCoordinates, MAX_POINTS } from '../../src/integrations/maps/mapService.js';
import { logger } from '../../src/shared/logger.js';
import { MAP_ERROR, MapProviderError } from '../../src/integrations/maps/errors.js';
import { createCache } from '../../src/integrations/redis/cache.js';
import { PLANNING_CONFIG } from '../../src/config/planning.js';
import { parseEnv } from '../../src/config/env.js';
import { createInMemoryRedis } from '../helpers/testApp.js';

const A = { latitude: 23.8103, longitude: 90.4125 };
const B = { latitude: 23.7189, longitude: 90.3882 };
const C = { latitude: 23.7536, longitude: 90.3994 };

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function ors(fetchImpl, timeoutMs = 1_000) {
  return createOpenRouteServiceProvider({ apiKey: 'test-key', timeoutMs, baseUrl: 'https://ors.test', fetchImpl });
}

describe('OpenRouteService adapter', () => {
  it('sends [lng, lat] coordinates, the right profile and the API key; rounds fractions', async () => {
    // Real ORS responses contain fractions, e.g. 1078.35 s (seen against the live API).
    const fetchImpl = vi.fn(async () => json(200, { durations: [[0, 59.6], [70.2, 0]], distances: [[0, 899.5], [950.4, 0]] }));
    const result = await ors(fetchImpl).getDistanceMatrix([A, B], 'walking');

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://ors.test/v2/matrix/foot-walking');
    expect(init.headers.Authorization).toBe('test-key');
    expect(JSON.parse(init.body).locations).toEqual([[90.4125, 23.8103], [90.3882, 23.7189]]);
    expect(result).toEqual({ durations: [[0, 60], [70, 0]], distances: [[0, 900], [950, 0]] });
  });

  it('parses a route with legs and its encoded geometry', async () => {
    const fetchImpl = vi.fn(async () =>
      json(200, { routes: [{ summary: { distance: 1500.4, duration: 300.6 }, segments: [{ distance: 1500.4, duration: 300.6 }], geometry: '_p~iF~ps|U' }] }),
    );
    expect(await ors(fetchImpl).getRoute([A, B], 'car')).toEqual({
      distanceMeters: 1500,
      durationSeconds: 301,
      legs: [{ distanceMeters: 1500, durationSeconds: 301 }],
      geometry: '_p~iF~ps|U',
    });
    expect(fetchImpl.mock.calls[0][0]).toBe('https://ors.test/v2/directions/driving-car');
  });

  it('accepts the live response shape: no segments without instructions', async () => {
    // Shape observed from the live API with instructions: false.
    const live = { bbox: [], routes: [{ summary: { distance: 13260.1, duration: 1078.4 }, bbox: [], geometry: '_nipCcuyfPCkB', way_points: [0, 120] }], metadata: {} };
    expect(await ors(async () => json(200, live)).getRoute([A, B], 'car')).toEqual({
      distanceMeters: 13260,
      durationSeconds: 1078,
      legs: null,
      geometry: '_nipCcuyfPCkB',
    });
  });

  it.each([
    ['429', () => json(429, { error: { message: 'Quota exceeded' } }), MAP_ERROR.RATE_LIMITED, 1],
    ['404 (no route)', () => json(404, { error: { code: 2010, message: 'Could not find routable point' } }), MAP_ERROR.INVALID_ROUTE, 1],
    ['400 (bad request)', () => json(400, { error: { message: 'Invalid coordinates' } }), MAP_ERROR.INVALID_ROUTE, 1],
    ['401 (bad API key, not retried)', () => json(401, { error: 'Access to this API has been disallowed' }), MAP_ERROR.UNAVAILABLE, 1],
    ['403 (key blocked, not retried)', () => json(403, { error: 'Access to this API has been disallowed' }), MAP_ERROR.UNAVAILABLE, 1],
    ['503 (retried once)', () => json(503, {}), MAP_ERROR.UNAVAILABLE, 2],
    ['a network error (retried once)', () => { throw new TypeError('fetch failed'); }, MAP_ERROR.UNAVAILABLE, 2],
    ['a non-JSON success', () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } }), MAP_ERROR.UNAVAILABLE, 2],
    ['a response without durations', () => json(200, { foo: 1 }), MAP_ERROR.MISSING_DATA, 1],
  ])('maps %s to %s', async (_label, respond, kind, calls) => {
    const fetchImpl = vi.fn(async () => respond());
    await expect(ors(fetchImpl).getDistanceMatrix([A, B], 'car')).rejects.toMatchObject({ name: 'MapProviderError', kind });
    expect(fetchImpl).toHaveBeenCalledTimes(calls);
  });

  it('times out instead of hanging', async () => {
    const hanging = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
    await expect(ors(hanging, 30).getDistanceMatrix([A, B], 'car')).rejects.toMatchObject({ kind: MAP_ERROR.TIMEOUT });
  });

  it('a route response without a route is MISSING_DATA', async () => {
    await expect(ors(async () => json(200, { routes: [] })).getRoute([A, B], 'car')).rejects.toMatchObject({ kind: MAP_ERROR.MISSING_DATA });
  });

  it('has no public transport profile', async () => {
    const provider = ors(vi.fn());
    expect(provider.supportsMode('public_transport')).toBe(false);
    await expect(provider.getDistanceMatrix([A, B], 'public_transport')).rejects.toMatchObject({ kind: MAP_ERROR.UNSUPPORTED_MODE });
  });
});

describe('map service', () => {
  const estimate = createEstimateProvider(PLANNING_CONFIG);
  const matrixOf = (points, seconds) => ({
    durations: points.map((_, i) => points.map((__, j) => (i === j ? 0 : seconds))),
    distances: points.map((_, i) => points.map((__, j) => (i === j ? 0 : seconds * 10))),
  });

  function fakeProvider(overrides = {}) {
    return {
      name: 'fake',
      supportsMode: () => true,
      getDistanceMatrix: vi.fn(async (points) => matrixOf(points, 600)),
      getRoute: vi.fn(async () => ({ distanceMeters: 5000, durationSeconds: 900, legs: [], geometry: 'poly' })),
      ...overrides,
    };
  }

  function service(provider, options = {}) {
    return createMapService({ provider, fallback: estimate, cache: createCache(createInMemoryRedis()), ttlSeconds: 60, ...options });
  }

  it('returns provider data, labelled with its source', async () => {
    const result = await service(fakeProvider()).getDistanceMatrix([A, B], 'car');
    expect(result).toMatchObject({ provider: 'fake', estimated: false, durations: [[0, 600], [600, 0]] });
    expect(result).not.toHaveProperty('fallbackReason');
  });

  it('caches real results: the provider is called once for the same points', async () => {
    const provider = fakeProvider();
    const maps = service(provider);
    await maps.getDistanceMatrix([A, B], 'car');
    await new Promise((resolve) => setImmediate(resolve));
    await maps.getDistanceMatrix([{ latitude: 23.810300001, longitude: 90.4125 }, B], 'car'); // same to ~1 m
    expect(provider.getDistanceMatrix).toHaveBeenCalledTimes(1);

    await maps.getDistanceMatrix([A, B], 'walking'); // different mode, different key
    expect(provider.getDistanceMatrix).toHaveBeenCalledTimes(2);
  });

  it.each(Object.values(MAP_ERROR).filter((k) => k !== MAP_ERROR.UNSUPPORTED_MODE))(
    'falls back to flagged estimates on %s, and does not cache them',
    async (kind) => {
      const provider = fakeProvider({ getDistanceMatrix: vi.fn(async () => { throw new MapProviderError(kind, 'boom'); }) });
      const maps = service(provider);

      const result = await maps.getDistanceMatrix([A, B], 'car');
      expect(result).toMatchObject({ provider: 'estimate', estimated: true, fallbackReason: kind });
      expect(result.durations[0][1]).toBeGreaterThan(0);

      await maps.getDistanceMatrix([A, B], 'car');
      expect(provider.getDistanceMatrix).toHaveBeenCalledTimes(2); // retried next time, not served stale estimates
    },
  );

  it('treats unexpected provider errors as UNAVAILABLE', async () => {
    const provider = fakeProvider({ getDistanceMatrix: async () => { throw new TypeError('undefined is not a function'); } });
    expect((await service(provider).getDistanceMatrix([A, B], 'car')).fallbackReason).toBe(MAP_ERROR.UNAVAILABLE);
  });

  it('returns 503 ROUTING_UNAVAILABLE instead of estimates when fallback is disabled', async () => {
    const provider = fakeProvider({ getRoute: async () => { throw new MapProviderError(MAP_ERROR.TIMEOUT, 'slow'); } });
    await expect(service(provider, { fallbackToEstimate: false }).getRoute([A, B], 'car')).rejects.toMatchObject({
      status: 503,
      code: 'ROUTING_UNAVAILABLE',
      details: { reason: MAP_ERROR.TIMEOUT },
    });
  });

  it('uses flagged estimates for a mode the provider does not support, without calling it', async () => {
    const provider = fakeProvider({ supportsMode: (mode) => mode !== 'public_transport' });
    const result = await service(provider).getDistanceMatrix([A, B], 'public_transport');
    expect(result).toMatchObject({ estimated: true, fallbackReason: MAP_ERROR.UNSUPPORTED_MODE });
    expect(provider.getDistanceMatrix).not.toHaveBeenCalled();
  });

  it('fills unreachable pairs with estimates and flags the whole matrix', async () => {
    const provider = fakeProvider({ getDistanceMatrix: async () => ({ durations: [[0, null, 300], [null, 0, 200], [300, 200, 0]], distances: [[0, null, 3000], [null, 0, 2000], [3000, 2000, 0]] }) });
    const result = await service(provider).getDistanceMatrix([A, B, C], 'car');

    expect(result).toMatchObject({ provider: 'fake', estimated: true, fallbackReason: MAP_ERROR.MISSING_DATA });
    expect(result.durations[0][2]).toBe(300); // real values kept
    expect(result.durations[0][1]).toBeGreaterThan(0); // missing values estimated
  });

  it('getTravelTime returns one leg with its source', async () => {
    expect(await service(fakeProvider()).getTravelTime(A, B, 'car')).toEqual({ distanceMeters: 6000, durationSeconds: 600, provider: 'fake', estimated: false });
  });

  it('getRoute returns road geometry from the provider and none from the estimate', async () => {
    expect((await service(fakeProvider()).getRoute([A, B], 'car')).geometry).toBe('poly');
    expect(await service(estimate).getRoute([A, B, C], 'car')).toMatchObject({ provider: 'estimate', estimated: true, geometry: null });
  });

  it('keeps user coordinates out of the logs when the provider echoes them', async () => {
    const warn = vi.spyOn(logger, 'warn');
    const provider = fakeProvider({
      getDistanceMatrix: async () => {
        throw new MapProviderError(MAP_ERROR.INVALID_ROUTE, 'Could not find routable point within a radius of 350.0 meters of specified coordinate 1: 90.4125000 23.8103000.');
      },
    });
    await service(provider).getDistanceMatrix([A, B], 'car');

    const logged = JSON.stringify(warn.mock.calls);
    warn.mockRestore();
    expect(logged).toContain('INVALID_ROUTE');
    expect(logged).not.toMatch(/90\.41|23\.81/);
    expect(maskCoordinates('coordinate 1: -23.8103 90.4125, radius 350.0')).toBe('coordinate 1: <coord> <coord>, radius 350.0');
  });

  it('rejects invalid input from callers', async () => {
    const maps = service(fakeProvider());
    await expect(maps.getRoute([A], 'car')).rejects.toThrow(/2–50/);
    await expect(maps.getDistanceMatrix([{ latitude: 91, longitude: 0 }], 'car')).rejects.toThrow();
    await expect(maps.getDistanceMatrix(Array.from({ length: MAX_POINTS + 1 }, () => A), 'car')).rejects.toThrow();
  });
});

describe('configuration', () => {
  const base = { DATABASE_URL: 'postgres://u:p@localhost/db', JWT_SECRET: 'x'.repeat(32), UPSTASH_REDIS_REST_URL: 'https://x.upstash.io', UPSTASH_REDIS_REST_TOKEN: 't' };

  it('defaults to the estimate provider with fallback enabled', () => {
    expect(parseEnv(base).maps).toEqual({ provider: 'estimate', apiKey: undefined, timeoutMs: 5000, fallbackToEstimate: true });
  });

  it('requires MAP_API_KEY for a real provider', () => {
    expect(() => parseEnv({ ...base, MAP_PROVIDER: 'openrouteservice' })).toThrow(/MAP_API_KEY/);
    expect(parseEnv({ ...base, MAP_PROVIDER: 'openrouteservice', MAP_API_KEY: 'k' }).maps.provider).toBe('openrouteservice');
  });
});

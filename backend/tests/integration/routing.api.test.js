import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createIntegrationApp, testDatabaseUrl } from '../helpers/integrationApp.js';
import { createEstimateProvider } from '../../src/integrations/maps/index.js';
import { MAP_ERROR, MapProviderError } from '../../src/integrations/maps/errors.js';
import { PLANNING_CONFIG } from '../../src/config/planning.js';

const MONDAY = '2026-10-05';
const START = { latitude: 23.75, longitude: 90.39 };
const estimate = createEstimateProvider(PLANNING_CONFIG);

// A stand-in road provider: travel takes `factor` × the estimate; behaviour is switchable.
const provider = {
  name: 'fake-roads',
  mode: 'ok', // 'ok' | 'down'
  factor: 1,
  calls: 0,
  supportsMode: (mode) => mode !== 'public_transport',
  async getDistanceMatrix(points, mode) {
    this.calls += 1;
    if (this.mode === 'down') throw new MapProviderError(MAP_ERROR.TIMEOUT, 'no answer');
    const m = await estimate.getDistanceMatrix(points, mode);
    return { durations: m.durations.map((row) => row.map((v) => Math.round(v * this.factor))), distances: m.distances };
  },
  async getRoute(points, mode) {
    if (this.mode === 'down') throw new MapProviderError(MAP_ERROR.UNAVAILABLE, 'down');
    return { ...(await estimate.getRoute(points, mode)), geometry: 'encoded-road-polyline' };
  },
};

describe.skipIf(!testDatabaseUrl)('Itinerary generation through the map provider (PostGIS)', () => {
  let ctx;
  let owner;

  const api = () => request(ctx.app);
  async function tripWith(overrides) {
    const res = await api().post('/api/v1/trips').set(owner.headers).send({ title: 'T', startLocation: START, startDate: MONDAY, durationDays: 1, ...overrides });
    return res.body.data;
  }
  const generate = (tripId) => api().post('/api/v1/itineraries/generate').set(owner.headers).send({ tripId });

  beforeAll(async () => {
    ctx = await createIntegrationApp({ mapProvider: provider });
  });

  beforeEach(async () => {
    await ctx.reset();
    Object.assign(provider, { mode: 'ok', factor: 1, calls: 0 });
    owner = await ctx.signUp('owner');
    const moderator = await ctx.signUp('moderator', 'moderator');
    const sites = [[23.7536, 90.3994], [23.7375, 90.3950], [23.7450, 90.3800], [23.7600, 90.3850]];
    for (const [i, [latitude, longitude]] of sites.entries()) {
      await api().post('/api/v1/places').set(moderator.headers).send({
        name: `Site ${i + 1}`, category: 'museum', location: { latitude, longitude }, typicalVisitMinutes: 60, entryFee: 0,
      });
    }
  });

  afterAll(async () => {
    await ctx?.teardown();
  });

  it('uses the provider: real times, its name on the itinerary, a road polyline, no estimate warning', async () => {
    const trip = await tripWith({});
    const itinerary = (await generate(trip.id)).body.data;

    expect(itinerary.routing).toEqual({ provider: 'fake-roads', algorithm: 'nearest-neighbor+2opt', travelTimesEstimated: false });
    expect(itinerary.days[0].routePolyline).toBe('encoded-road-polyline');
    expect(itinerary.warnings.map((w) => w.code)).not.toContain('TRAVEL_TIMES_ESTIMATED');
    expect(provider.calls).toBeGreaterThan(0);
  });

  it('provider down: still produces an itinerary, clearly marked as estimated, with the reason', async () => {
    provider.mode = 'down';
    const trip = await tripWith({});
    const res = await generate(trip.id);

    expect(res.status).toBe(201);
    expect(res.body.data.routing).toMatchObject({ provider: 'estimate', travelTimesEstimated: true });
    expect(res.body.data.days[0].routePolyline).toBeNull();
    const warning = res.body.data.warnings.find((w) => w.code === 'TRAVEL_TIMES_ESTIMATED');
    expect(warning.message).toContain(MAP_ERROR.TIMEOUT);
  });

  it('unsupported mode (public transport): estimates, flagged', async () => {
    const trip = await tripWith({ travelMode: 'public_transport' });
    const itinerary = (await generate(trip.id)).body.data;
    expect(itinerary.routing.travelTimesEstimated).toBe(true);
    expect(itinerary.warnings.find((w) => w.code === 'TRAVEL_TIMES_ESTIMATED').message).toContain(MAP_ERROR.UNSUPPORTED_MODE);
  });

  it('real travel times slower than estimated: drops stops until the day fits, and says so', async () => {
    const roomy = (await generate((await tripWith({ dailyStartTime: '09:00', dailyEndTime: '14:00' })).id)).body.data;
    const plannedStops = roomy.days[0].stops.length;

    provider.factor = 4; // traffic: every leg takes 4× the estimate
    ctx.redis.store.clear(); // same points as above would otherwise come from the routing cache
    const tight = (await generate((await tripWith({ dailyStartTime: '09:00', dailyEndTime: '14:00' })).id)).body.data;

    expect(tight.days[0].stops.length).toBeLessThan(plannedStops);
    expect(tight.days[0].endTime <= '14:00').toBe(true);
    expect(tight.warnings.map((w) => w.code)).toContain('STOP_REMOVED_AFTER_ROUTING');
  });

  describe('POST /api/v1/routing/optimize', () => {
    const placeIds = async () => (await api().get('/api/v1/places').query({ limit: 50 })).body.data.map((p) => p.id);
    const optimize = (body, session = owner) => api().post('/api/v1/routing/optimize').set(session.headers).send({ start: START, ...body });

    it('orders the chosen places per day and returns legs, totals and metadata', async () => {
      const [a, b, c, d] = await placeIds();
      const res = await optimize({ days: [{ date: MONDAY, placeIds: [a, b, c] }, { placeIds: [d] }] });

      expect(res.status).toBe(200);
      const { days, totals, metadata } = res.body.data;
      expect(days.map((day) => day.stops.length)).toEqual([3, 1]);
      expect(days[0].stops.map((s) => s.place.id).sort()).toEqual([a, b, c].sort());
      expect(days[0].stops[0]).toMatchObject({ order: 1, travelFromPrevious: { minutes: expect.any(Number), distanceMeters: expect.any(Number) } });
      expect(days[0]).toMatchObject({ feasible: true, routePolyline: 'encoded-road-polyline', metadata: { provider: 'fake-roads', travelTimesEstimated: false } });
      expect(totals.distanceMeters).toBe(days[0].totals.distanceMeters + days[1].totals.distanceMeters);
      expect(metadata).toMatchObject({ algorithm: 'nearest-neighbor+2opt', globallyOptimal: false });
    });

    it('rejects unknown, unapproved and duplicate places', async () => {
      const [a] = await placeIds();
      const unknown = await optimize({ days: [{ placeIds: ['0b6b7c1e-2f4a-4c55-9d8e-3a1f2b4c5d6e'] }] });
      expect(unknown.status).toBe(400);
      expect(unknown.body.error.details[0].path).toBe('days.0.placeIds.0');

      const pending = (await api().post('/api/v1/places').set(owner.headers).send({ name: 'Mine', category: 'park', location: START })).body.data;
      expect((await optimize({ days: [{ placeIds: [pending.id] }] })).status).toBe(400);
      expect((await optimize({ days: [{ placeIds: [a, a] }] })).status).toBe(400);
    });

    it('validates the request and requires sign-in', async () => {
      expect((await optimize({ days: [] })).status).toBe(400);
      expect((await optimize({ start: { latitude: 99, longitude: 0 }, days: [{ placeIds: [(await placeIds())[0]] }] })).status).toBe(400);
      expect((await api().post('/api/v1/routing/optimize').send({ start: START, days: [] })).status).toBe(401);
    });
  });

  it('caches provider results: regenerating the same trip does not call the provider again', async () => {
    const trip = await tripWith({});
    await generate(trip.id);
    const callsAfterFirst = provider.calls;
    await generate(trip.id);
    expect(provider.calls).toBe(callsAfterFirst);
  });
});

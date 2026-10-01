import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createIntegrationApp, testDatabaseUrl } from '../helpers/integrationApp.js';
import { buildTestApp, createInMemoryRateLimiter } from '../helpers/testApp.js';

// 2026-10-05 is a Monday.
const MONDAY = '2026-10-05';
const START = { latitude: 23.7500, longitude: 90.3900 };
const allWeek = (opensAt, closesAt) => [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({ dayOfWeek, opensAt, closesAt }));

describe.skipIf(!testDatabaseUrl)('Trips and itinerary generation (PostGIS)', () => {
  let ctx;
  let owner;
  let stranger;
  let moderator;

  const api = () => request(ctx.app);
  const tripBody = (overrides = {}) => ({ title: 'Old Dhaka weekend', startLocation: START, startDate: MONDAY, durationDays: 2, ...overrides });
  const createTrip = async (overrides, session = owner) => {
    const res = await api().post('/api/v1/trips').set(session.headers).send(tripBody(overrides));
    expect(res.status).toBe(201);
    return res.body.data;
  };
  const generate = (tripId, session = owner) => api().post('/api/v1/itineraries/generate').set(session.headers).send({ tripId });

  // Places a few km from START, spread so travel matters.
  async function seedPlaces() {
    const make = (name, latitude, longitude, extra = {}) =>
      api().post('/api/v1/places').set(moderator.headers).send({
        name, category: 'historical_site', location: { latitude, longitude }, entryFee: 20, typicalVisitMinutes: 60, ...extra,
      });
    const created = [];
    for (const [i, [lat, lng]] of [[23.7189, 90.3882], [23.7086, 90.4062], [23.7154, 90.4011], [23.7375, 90.3950], [23.7536, 90.3994], [23.7300, 90.4100]].entries()) {
      created.push((await make(`Site ${i + 1}`, lat, lng, { tags: ['history'], openingHours: allWeek('09:00', '18:00') })).body.data);
    }
    created.push((await make('Unknown-hours park', 23.7450, 90.3800, { category: 'park', tags: ['nature'], entryFee: null })).body.data);
    return created;
  }

  beforeAll(async () => {
    ctx = await createIntegrationApp();
  });

  beforeEach(async () => {
    await ctx.reset();
    owner = await ctx.signUp('owner');
    stranger = await ctx.signUp('stranger');
    moderator = await ctx.signUp('moderator', 'moderator');
  });

  afterAll(async () => {
    await ctx?.teardown();
  });

  describe('trips CRUD', () => {
    it('creates a trip with sensible defaults', async () => {
      const trip = await createTrip({ startDate: undefined, interests: ['history', 'food'] });
      expect(trip).toMatchObject({
        title: 'Old Dhaka weekend',
        startLocation: START,
        startDate: null,
        durationDays: 2,
        dailyStartTime: '09:00',
        dailyEndTime: '20:00',
        searchRadiusKm: 10,
        budget: null,
        travelMode: 'car',
        travelingWithPet: false,
        parkingRequired: false,
        partySize: 1,
        interests: ['food', 'history'],
        selectedPlaceIds: [],
        currentItineraryId: null,
      });
    });

    it('stores the start date exactly (no timezone shift)', async () => {
      expect((await createTrip({ startDate: '2026-12-31' })).startDate).toBe('2026-12-31');
    });

    it.each([
      ['an unknown interest', { interests: ['astrology'] }, 'interests'],
      ['end before start', { dailyStartTime: '20:00', dailyEndTime: '09:00' }, 'dailyEndTime'],
      ['15 days', { durationDays: 15 }, 'durationDays'],
      ['an unknown travel mode', { travelMode: 'teleport' }, 'travelMode'],
      ['a radius under 0.5 km', { searchRadiusKm: 0.1 }, 'searchRadiusKm'],
      ['invalid coordinates', { startLocation: { latitude: 100, longitude: 90 } }, 'startLocation.latitude'],
      ['an unknown selected place', { selectedPlaceIds: ['0b6b7c1e-2f4a-4c55-9d8e-3a1f2b4c5d6e'] }, 'selectedPlaceIds.0'],
      ['a negative budget', { budget: { amount: -5, type: 'total' } }, 'budget.amount'],
    ])('rejects %s', async (_label, overrides, path) => {
      const res = await api().post('/api/v1/trips').set(owner.headers).send(tripBody(overrides));
      expect(res.status).toBe(400);
      expect(res.body.error.details.map((d) => d.path)).toContain(path);
    });

    it('trips are private: other users get 404, anonymous users 401', async () => {
      const trip = await createTrip();
      expect((await api().get(`/api/v1/trips/${trip.id}`).set(stranger.headers)).status).toBe(404);
      expect((await api().patch(`/api/v1/trips/${trip.id}`).set(stranger.headers).send({ title: 'x' })).status).toBe(404);
      expect((await api().delete(`/api/v1/trips/${trip.id}`).set(stranger.headers)).status).toBe(404);
      expect((await api().get('/api/v1/trips').set(stranger.headers)).body.meta.total).toBe(0);
      expect((await api().get(`/api/v1/trips/${trip.id}`)).status).toBe(401);
    });

    it('PATCH changes only the given fields', async () => {
      const trip = await createTrip({ interests: ['history'], parkingRequired: true });
      const res = await api().patch(`/api/v1/trips/${trip.id}`).set(owner.headers).send({ title: 'Renamed', durationDays: 3 });

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ title: 'Renamed', durationDays: 3, interests: ['history'], parkingRequired: true });
    });

    it('PATCH validates the daily window against the saved value', async () => {
      const trip = await createTrip({ dailyStartTime: '10:00' });
      const res = await api().patch(`/api/v1/trips/${trip.id}`).set(owner.headers).send({ dailyEndTime: '09:30' });
      expect(res.status).toBe(400);
    });

    it('DELETE removes the trip', async () => {
      const trip = await createTrip();
      expect((await api().delete(`/api/v1/trips/${trip.id}`).set(owner.headers)).status).toBe(200);
      expect((await api().get(`/api/v1/trips/${trip.id}`).set(owner.headers)).status).toBe(404);
    });
  });

  describe('itinerary generation', () => {
    let places;
    beforeEach(async () => {
      places = await seedPlaces();
    });

    it('generates a feasible day-by-day itinerary and saves it as the current version', async () => {
      const trip = await createTrip({ interests: ['history'], dailyStartTime: '09:00', dailyEndTime: '17:00', budget: { amount: 1000, type: 'total' }, partySize: 2 });
      const res = await generate(trip.id);

      expect(res.status).toBe(201);
      const itinerary = res.body.data;
      expect(itinerary).toMatchObject({ tripId: trip.id, version: 1, isCurrent: true, routing: { provider: 'estimate', algorithm: 'nearest-neighbor+2opt', travelTimesEstimated: true } });
      expect(itinerary.days.map((d) => [d.dayNumber, d.date])).toEqual([[1, MONDAY], [2, '2026-10-06']]);

      const allStops = itinerary.days.flatMap((d) => d.stops);
      expect(new Set(allStops.map((s) => s.place.id)).size).toBe(allStops.length); // no place twice
      for (const day of itinerary.days) {
        expect(day.stops.length).toBeGreaterThan(0);
        expect(day.stops.length).toBeLessThanOrEqual(6);
        expect(day.endTime <= '17:00').toBe(true); // incl. the trip back to the start
        expect(day.stops.map((s) => s.order)).toEqual(day.stops.map((_, i) => i + 1));
        for (const [i, stop] of day.stops.entries()) {
          expect(stop.plannedStart >= '09:00' && stop.plannedEnd <= '17:00').toBe(true);
          if (i > 0) expect(stop.plannedStart >= day.stops[i - 1].plannedEnd).toBe(true);
        }
      }

      // Cost = known fees × party size.
      const knownFees = allStops.filter((s) => s.estimatedCost !== null).reduce((sum, s) => sum + s.estimatedCost, 0);
      expect(itinerary.totals.estimatedCost).toBe(knownFees);
      expect(allStops.find((s) => s.estimatedCost !== null).estimatedCost).toBe(40);

      expect(itinerary.warnings.map((w) => w.code)).toContain('TRAVEL_TIMES_ESTIMATED');
      const tripNow = (await api().get(`/api/v1/trips/${trip.id}`).set(owner.headers)).body.data;
      expect(tripNow.currentItineraryId).toBe(itinerary.id);
      expect((await api().get(`/api/v1/itineraries/${itinerary.id}`).set(owner.headers)).body.data).toEqual(itinerary);
    });

    it('flags unknown opening hours and fees instead of assuming them', async () => {
      const trip = await createTrip({ durationDays: 1, interests: ['nature'], searchRadiusKm: 3 });
      const itinerary = (await generate(trip.id)).body.data;
      const park = places.at(-1);
      const stop = itinerary.days[0].stops.find((s) => s.place.id === park.id);

      expect(stop.openingHoursVerified).toBe(false);
      expect(stop.estimatedCost).toBeNull();
      expect(itinerary.warnings).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'OPENING_HOURS_UNVERIFIED', placeId: park.id }),
        expect.objectContaining({ code: 'ENTRY_FEE_UNKNOWN', placeId: park.id }),
      ]));
    });

    it('warns when the start date was assumed', async () => {
      const trip = await createTrip({ startDate: null, durationDays: 1 });
      const itinerary = (await generate(trip.id)).body.data;
      expect(itinerary.warnings.map((w) => w.code)).toContain('START_DATE_ASSUMED');
    });

    it('regenerating creates version 2 and makes it current', async () => {
      const trip = await createTrip({ durationDays: 1 });
      const v1 = (await generate(trip.id)).body.data;
      const v2 = (await generate(trip.id)).body.data;

      expect(v2.version).toBe(2);
      expect(v2.isCurrent).toBe(true);
      expect((await api().get(`/api/v1/itineraries/${v1.id}`).set(owner.headers)).body.data.isCurrent).toBe(false);
    });

    it('422 INSUFFICIENT_MATCHING_PLACES with the limiting requirement, never relaxing it', async () => {
      const trip = await createTrip({ parkingRequired: true }); // every seeded place has parking UNKNOWN
      const res = await generate(trip.id);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('INSUFFICIENT_MATCHING_PLACES');
      expect(res.body.error.details).toMatchObject({
        emptyDays: [{ dayNumber: 1, date: MONDAY }, { dayNumber: 2, date: '2026-10-06' }],
        candidatesInRadius: 7,
        eligiblePlaces: 0,
        scheduledPlaces: 0,
        excludedBy: { parking: 7 },
      });
      expect(res.body.error.details.suggestions[0]).toBe('7 nearby places are not confirmed to have parking');
    });

    it('422 when there are too few places to fill every day', async () => {
      const trip = await createTrip({ durationDays: 14, dailyEndTime: '11:00', searchRadiusKm: 3 });
      const res = await generate(trip.id);
      expect(res.status).toBe(422);
      expect(res.body.error.details.emptyDays.length).toBeGreaterThan(0);
    });

    it('includes selected places even when they rank low', async () => {
      const lowRanked = places.at(-1); // unknown hours/fee, not matching interests
      const trip = await createTrip({ durationDays: 1, interests: ['history'], selectedPlaceIds: [lowRanked.id] });
      const itinerary = (await generate(trip.id)).body.data;
      expect(itinerary.days[0].stops.map((s) => s.place.id)).toContain(lowRanked.id);
    });

    it('422 SELECTED_PLACES_NOT_FEASIBLE: says which selected place fails and why', async () => {
      const closedMondays = (
        await api().post('/api/v1/places').set(moderator.headers).send({
          name: 'Weekend bazaar', category: 'market', location: { latitude: 23.74, longitude: 90.39 },
          openingHours: [{ dayOfWeek: 6, opensAt: '09:00', closesAt: '17:00' }],
        })
      ).body.data;
      const notPetFriendly = places[0];

      const closedTrip = await createTrip({ durationDays: 1, selectedPlaceIds: [closedMondays.id] });
      const closedRes = await generate(closedTrip.id);
      expect(closedRes.status).toBe(422);
      expect(closedRes.body.error).toMatchObject({
        code: 'SELECTED_PLACES_NOT_FEASIBLE',
        details: { places: [{ placeId: closedMondays.id, reason: 'FAILS_REQUIREMENTS', requirements: ['openDuringTrip'] }] },
      });

      const petTrip = await createTrip({ durationDays: 1, travelingWithPet: true, selectedPlaceIds: [notPetFriendly.id] });
      const petRes = await generate(petTrip.id);
      expect(petRes.body.error.details.places[0]).toMatchObject({ placeId: notPetFriendly.id, requirements: ['petFriendly'] });
    });

    it('itineraries are private', async () => {
      const trip = await createTrip({ durationDays: 1 });
      const itinerary = (await generate(trip.id)).body.data;
      expect((await api().get(`/api/v1/itineraries/${itinerary.id}`).set(stranger.headers)).status).toBe(404);
      expect((await generate(trip.id, stranger)).status).toBe(404);
    });

    it('validates the request', async () => {
      expect((await api().post('/api/v1/itineraries/generate').set(owner.headers).send({ tripId: 'nope' })).status).toBe(400);
      expect((await api().post('/api/v1/itineraries/generate').send({})).status).toBe(401);
    });
  });
});

describe('itinerary generation rate limit', () => {
  it('uses the routing policy (429 when exceeded)', async () => {
    const app = buildTestApp({ rateLimiter: createInMemoryRateLimiter({ routing: 0 }) });
    const { body } = await request(app).post('/api/v1/auth/register').send({ name: 'A', email: 'a@example.com', password: 'long enough password' });
    const res = await request(app)
      .post('/api/v1/itineraries/generate')
      .set('Authorization', `Bearer ${body.data.tokens.accessToken}`)
      .send({ tripId: '0b6b7c1e-2f4a-4c55-9d8e-3a1f2b4c5d6e' });
    expect(res.status).toBe(429);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createIntegrationApp, testDatabaseUrl } from '../helpers/integrationApp.js';
import { createItinerariesRepository } from '../../src/modules/itineraries/index.js';

const MONDAY = '2026-10-05';
const START = { latitude: 23.75, longitude: 90.39 };
const ALL_WEEK = [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({ dayOfWeek, opensAt: '09:00', closesAt: '18:00' }));

describe.skipIf(!testDatabaseUrl)('Itinerary persistence (PostGIS)', () => {
  let ctx;
  let owner;
  let stranger;
  let moderator;
  let places; // name → place

  const api = () => request(ctx.app);
  const as = (session) => ({
    get: (path) => api().get(path).set(session.headers),
    post: (path, body) => api().post(path).set(session.headers).send(body),
    patch: (path, body) => api().patch(path).set(session.headers).send(body),
    delete: (path) => api().delete(path).set(session.headers),
  });

  async function addPlace(name, latitude, longitude, extra = {}) {
    const res = await as(moderator).post('/api/v1/places', {
      name, category: 'museum', location: { latitude, longitude }, typicalVisitMinutes: 60, entryFee: 10,
      openingHours: ALL_WEEK, parkingAvailable: 'YES', ...extra,
    });
    places[name] = res.body.data;
    return res.body.data;
  }

  async function newItinerary(tripOverrides = {}, session = owner) {
    const trip = (await as(session).post('/api/v1/trips', { title: 'Trip', startLocation: START, startDate: MONDAY, durationDays: 2, searchRadiusKm: 3, ...tripOverrides })).body.data;
    const res = await as(session).post('/api/v1/itineraries/generate', { tripId: trip.id });
    expect(res.status).toBe(201);
    return { trip, itinerary: res.body.data };
  }
  const stopIds = (day) => day.stops.map((s) => s.place.id);

  beforeAll(async () => {
    ctx = await createIntegrationApp();
  });

  beforeEach(async () => {
    await ctx.reset();
    places = {};
    owner = await ctx.signUp('owner');
    stranger = await ctx.signUp('stranger');
    moderator = await ctx.signUp('moderator', 'moderator');
    await addPlace('North', 23.7600, 90.3850);
    await addPlace('East', 23.7536, 90.3994);
    await addPlace('South', 23.7450, 90.3800);
    await addPlace('West', 23.7480, 90.3820);
  });

  afterAll(async () => {
    await ctx?.teardown();
  });

  describe('create and view', () => {
    it('generate saves the itinerary; it can be fetched again identically', async () => {
      const { itinerary } = await newItinerary();
      const res = await as(owner).get(`/api/v1/itineraries/${itinerary.id}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(itinerary);
      expect(itinerary).toMatchObject({ version: 1, isCurrent: true, userModified: false });
    });

    it('lists my itineraries newest first, paginated, filterable by trip and current version', async () => {
      const first = await newItinerary({ title: 'First trip' });
      await as(owner).post(`/api/v1/itineraries/${first.itinerary.id}/regenerate`); // v2 of the first trip
      const second = await newItinerary({ title: 'Second trip' });
      await newItinerary({ title: 'Not mine' }, stranger);

      const page1 = await as(owner).get('/api/v1/itineraries?limit=2&page=1');
      expect(page1.body.meta).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });
      expect(page1.body.data[0]).toMatchObject({ tripId: second.trip.id, tripTitle: 'Second trip', version: 1, isCurrent: true, dayCount: 2 });
      expect(page1.body.data[0].stopCount).toBeGreaterThan(0);

      const byTrip = await as(owner).get(`/api/v1/itineraries?tripId=${first.trip.id}`);
      expect(byTrip.body.data.map((i) => [i.version, i.isCurrent])).toEqual([[2, true], [1, false]]);

      const currentOnly = await as(owner).get('/api/v1/itineraries?current=true');
      expect(currentOnly.body.meta.total).toBe(2);
    });
  });

  describe('ownership', () => {
    it("another user cannot see, edit, regenerate or delete someone's itinerary (404)", async () => {
      const { itinerary } = await newItinerary();
      const path = `/api/v1/itineraries/${itinerary.id}`;

      expect((await as(stranger).get(path)).status).toBe(404);
      expect((await as(stranger).patch(path, { days: [{ dayNumber: 1, placeIds: [] }] })).status).toBe(404);
      expect((await as(stranger).post(`${path}/regenerate`)).status).toBe(404);
      expect((await as(stranger).delete(path)).status).toBe(404);
      expect((await as(stranger).get('/api/v1/itineraries')).body.meta.total).toBe(0);
      expect((await as(owner).get(path)).status).toBe(200); // untouched
    });

    it('requires sign-in', async () => {
      expect((await api().get('/api/v1/itineraries')).status).toBe(401);
    });
  });

  describe('update', () => {
    it('reorders a day exactly as given and recalculates times', async () => {
      const { itinerary } = await newItinerary({ durationDays: 1 });
      const original = stopIds(itinerary.days[0]);
      const reversed = [...original].reverse();

      const res = await as(owner).patch(`/api/v1/itineraries/${itinerary.id}`, { days: [{ dayNumber: 1, placeIds: reversed }] });
      expect(res.status).toBe(200);
      expect(stopIds(res.body.data.days[0])).toEqual(reversed);
      expect(res.body.data).toMatchObject({ userModified: true, version: 1 });
      const [day] = res.body.data.days;
      for (let i = 1; i < day.stops.length; i += 1) expect(day.stops[i].plannedStart >= day.stops[i - 1].plannedEnd).toBe(true);
    });

    it('removes a stop and moves another to a different day; totals follow', async () => {
      const { itinerary } = await newItinerary();
      const [day1, day2] = itinerary.days;
      const [moved, ...rest1] = stopIds(day1);

      const res = await as(owner).patch(`/api/v1/itineraries/${itinerary.id}`, {
        days: [{ dayNumber: 1, placeIds: rest1.slice(1) }, { dayNumber: 2, placeIds: [...stopIds(day2), moved] }],
      });
      expect(res.status).toBe(200);
      const after = res.body.data;
      expect(stopIds(after.days[1])).toContain(moved);
      expect(after.days.flatMap(stopIds)).not.toContain(rest1[0]); // removed
      expect(after.totals.visitMinutes).toBe(after.days.reduce((sum, d) => sum + d.totals.visitMinutes, 0));
      expect(after.totals.estimatedCost).toBe(after.days.flatMap((d) => d.stops).reduce((sum, s) => sum + s.estimatedCost, 0));
    });

    it('an emptied day plans no time and adds none to the total', async () => {
      const { itinerary } = await newItinerary();
      const res = await as(owner).patch(`/api/v1/itineraries/${itinerary.id}`, { days: [{ dayNumber: 2, placeIds: [] }] });
      expect(res.status).toBe(200);
      const [day1, day2] = res.body.data.days;
      expect(day2).toMatchObject({ stops: [], totals: { plannedMinutes: 0, travelMinutes: 0, visitMinutes: 0 } });
      expect(day1.totals.plannedMinutes).toBeGreaterThan(0);
      expect(res.body.data.totals.plannedMinutes).toBe(day1.totals.plannedMinutes);
    });

    it('adds a new place and can re-optimise the order on request', async () => {
      const { itinerary } = await newItinerary({ durationDays: 1 });
      const extra = await addPlace('Added later', 23.7520, 90.3900); // created after generation

      const res = await as(owner).patch(`/api/v1/itineraries/${itinerary.id}`, {
        days: [{ dayNumber: 1, placeIds: [extra.id, ...stopIds(itinerary.days[0])].slice(0, 4), optimizeOrder: true }],
      });
      expect(res.status).toBe(200);
      expect(stopIds(res.body.data.days[0])).toContain(extra.id);
    });

    it('rejects a place that breaks a mandatory requirement (422)', async () => {
      const unknownParking = await addPlace('Parking unknown', 23.7520, 90.3900, { parkingAvailable: 'UNKNOWN' });
      const { itinerary } = await newItinerary({ durationDays: 1, parkingRequired: true });

      const res = await as(owner).patch(`/api/v1/itineraries/${itinerary.id}`, { days: [{ dayNumber: 1, placeIds: [unknownParking.id] }] });
      expect(res.status).toBe(422);
      expect(res.body.error).toMatchObject({ code: 'PLACE_VIOLATES_REQUIREMENTS', details: { places: [{ placeId: unknownParking.id, requirements: ['parking'] }] } });
    });

    it('rejects an edit that does not fit the day, leaving the itinerary unchanged', async () => {
      const { itinerary } = await newItinerary({ durationDays: 1, dailyStartTime: '09:00', dailyEndTime: '12:00' });
      const all = Object.values(places).map((p) => p.id);

      const res = await as(owner).patch(`/api/v1/itineraries/${itinerary.id}`, { days: [{ dayNumber: 1, placeIds: all }] });
      expect(res.status).toBe(422);
      expect(res.body.error).toMatchObject({ code: 'ITINERARY_DAY_INFEASIBLE', details: { days: [{ dayNumber: 1, reason: expect.any(String) }] } });
      expect((await as(owner).get(`/api/v1/itineraries/${itinerary.id}`)).body.data).toEqual(itinerary);
    });

    it('rejects a place that is closed on that day', async () => {
      const { itinerary } = await newItinerary();
      const tuesdays = await addPlace('Tuesdays only', 23.7520, 90.3900, { openingHours: [{ dayOfWeek: 2, opensAt: '09:00', closesAt: '18:00' }] });
      const res = await as(owner).patch(`/api/v1/itineraries/${itinerary.id}`, { days: [{ dayNumber: 1, placeIds: [tuesdays.id] }] });
      expect(res.body.error).toMatchObject({ code: 'ITINERARY_DAY_INFEASIBLE', details: { days: [{ dayNumber: 1, reason: 'CLOSED', placeId: tuesdays.id }] } });
    });

    it.each([
      ['a place twice in the itinerary', (it) => ({ days: [{ dayNumber: 2, placeIds: [stopIds(it.days[0])[0]] }] }), 400],
      ['a day that does not exist', () => ({ days: [{ dayNumber: 9, placeIds: [] }] }), 400],
      ['the same day twice', () => ({ days: [{ dayNumber: 1, placeIds: [] }, { dayNumber: 1, placeIds: [] }] }), 400],
      ['an unknown place', () => ({ days: [{ dayNumber: 1, placeIds: ['0b6b7c1e-2f4a-4c55-9d8e-3a1f2b4c5d6e'] }] }), 400],
      ['no days', () => ({ days: [] }), 400],
    ])('rejects %s', async (_label, body, status) => {
      const { itinerary } = await newItinerary();
      expect((await as(owner).patch(`/api/v1/itineraries/${itinerary.id}`, body(itinerary))).status).toBe(status);
    });

    it('only the current version can be edited (409)', async () => {
      const { itinerary } = await newItinerary();
      await as(owner).post(`/api/v1/itineraries/${itinerary.id}/regenerate`);
      const res = await as(owner).patch(`/api/v1/itineraries/${itinerary.id}`, { days: [{ dayNumber: 1, placeIds: [] }] });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ITINERARY_NOT_CURRENT');
    });
  });

  describe('regenerate and delete', () => {
    it('regenerate creates the next version from the trip\'s current requirements', async () => {
      const { trip, itinerary } = await newItinerary({ durationDays: 1 });
      await as(owner).patch(`/api/v1/trips/${trip.id}`, { parkingRequired: true });
      await as(moderator).patch(`/api/v1/places/${places.North.id}`, { parkingAvailable: 'NO' });

      const res = await as(owner).post(`/api/v1/itineraries/${itinerary.id}/regenerate`);
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ version: 2, isCurrent: true });
      expect(stopIds(res.body.data.days[0])).not.toContain(places.North.id);
      expect((await as(owner).get(`/api/v1/itineraries/${itinerary.id}`)).body.data.isCurrent).toBe(false);
    });

    it('deleting the current version makes the newest remaining one current', async () => {
      const { trip, itinerary: v1 } = await newItinerary();
      const v2 = (await as(owner).post(`/api/v1/itineraries/${v1.id}/regenerate`)).body.data;

      const res = await as(owner).delete(`/api/v1/itineraries/${v2.id}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ id: v2.id, deleted: true });
      expect((await as(owner).get(`/api/v1/itineraries/${v2.id}`)).status).toBe(404);
      expect((await as(owner).get(`/api/v1/itineraries/${v1.id}`)).body.data.isCurrent).toBe(true);
      expect((await as(owner).get(`/api/v1/trips/${trip.id}`)).body.data.currentItineraryId).toBe(v1.id);
    });

    it('deleting the current version while a new one is generated leaves exactly one current version', async () => {
      const { trip, itinerary: v1 } = await newItinerary();
      const v2 = (await as(owner).post(`/api/v1/itineraries/${v1.id}/regenerate`)).body.data;
      const repository = createItinerariesRepository(ctx.db);

      // The delete's transaction stays open until the generation is blocked behind it.
      let release;
      const held = new Promise((resolve) => {
        release = resolve;
      });
      const deleting = ctx.db.transaction(async (trx) => {
        await repository.delete(v2.id, trx);
        await held;
      });
      const generating = as(owner).post('/api/v1/itineraries/generate', { tripId: trip.id }).then((res) => res);

      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const [{ waiting }] = (await ctx.db.raw('SELECT count(*)::int AS waiting FROM pg_locks WHERE NOT granted')).rows;
        if (waiting > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      release();
      await deleting;

      const res = await generating;
      expect(res.status).toBe(201);
      const current = await ctx.db('itineraries').where({ trip_id: trip.id, is_current: true }).select('id');
      expect(current).toEqual([{ id: res.body.data.id }]);
      expect((await as(owner).get(`/api/v1/itineraries/${v1.id}`)).body.data.isCurrent).toBe(false);
    });

    it('deleting the only version leaves the trip without an itinerary', async () => {
      const { trip, itinerary } = await newItinerary();
      await as(owner).delete(`/api/v1/itineraries/${itinerary.id}`);
      expect((await as(owner).get(`/api/v1/trips/${trip.id}`)).body.data.currentItineraryId).toBeNull();
    });

    it('deleting the trip deletes its itineraries', async () => {
      const { trip, itinerary } = await newItinerary();
      await as(owner).delete(`/api/v1/trips/${trip.id}`);
      expect((await as(owner).get(`/api/v1/itineraries/${itinerary.id}`)).status).toBe(404);
    });
  });
});

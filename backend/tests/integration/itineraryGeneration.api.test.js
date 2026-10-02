import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createIntegrationApp, testDatabaseUrl } from '../helpers/integrationApp.js';

// 2026-10-05 is a Monday. All places lie within ~3 km of START.
const MONDAY = '2026-10-05';
const START = { latitude: 23.75, longitude: 90.39 };
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];
const hours = (days, opensAt, closesAt) => days.map((dayOfWeek) => ({ dayOfWeek, opensAt, closesAt }));
const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

describe.skipIf(!testDatabaseUrl)('Itinerary generation scenarios (PostGIS)', () => {
  let ctx;
  let owner;
  let moderator;
  let placesByName;

  const api = () => request(ctx.app);
  async function addPlace(name, latitude, longitude, extra = {}) {
    const res = await api().post('/api/v1/places').set(moderator.headers).send({
      name, category: 'museum', location: { latitude, longitude }, typicalVisitMinutes: 60, entryFee: 0,
      openingHours: hours(ALL_DAYS, '09:00', '18:00'), parkingAvailable: 'YES', ...extra,
    });
    expect(res.status).toBe(201);
    placesByName[name] = res.body.data;
    return res.body.data;
  }
  async function generate(tripOverrides) {
    const trip = (await api().post('/api/v1/trips').set(owner.headers).send({
      title: 'Scenario', startLocation: START, startDate: MONDAY, durationDays: 1, searchRadiusKm: 5, ...tripOverrides,
    })).body.data;
    return api().post('/api/v1/itineraries/generate').set(owner.headers).send({ tripId: trip.id });
  }

  // Every day fits the user's window, visits fit opening hours, times add up.
  function expectWellFormed(itinerary, { start, end }) {
    for (const day of itinerary.days) {
      expect(day.startTime >= start && day.endTime <= end).toBe(true);
      expect(day.totals.plannedMinutes).toBe(toMin(day.endTime) - toMin(day.startTime));
      expect(day.totals.plannedMinutes).toBeGreaterThanOrEqual(day.totals.travelMinutes + day.totals.visitMinutes);
      let clock = toMin(day.startTime);
      for (const stop of day.stops) {
        expect(toMin(stop.plannedEnd) - toMin(stop.plannedStart)).toBe(stop.visitMinutes);
        expect(toMin(stop.plannedStart)).toBeGreaterThanOrEqual(clock + stop.travelFromPrevious.minutes);
        const place = Object.values(placesByName).find((p) => p.id === stop.place.id);
        const weekday = ((new Date(`${day.date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
        if (place.openingHours.length > 0) {
          expect(place.openingHours.some((h) => h.dayOfWeek === weekday && h.opensAt <= stop.plannedStart && stop.plannedEnd <= h.closesAt)).toBe(true);
        }
        clock = toMin(stop.plannedEnd);
      }
    }
  }

  beforeAll(async () => {
    ctx = await createIntegrationApp();
  });

  beforeEach(async () => {
    await ctx.reset();
    placesByName = {};
    owner = await ctx.signUp('owner');
    moderator = await ctx.signUp('moderator', 'moderator');
  });

  afterAll(async () => {
    await ctx?.teardown();
  });

  describe('1-day trip', () => {
    it('returns one day with start/end, ordered visits, durations, travel, distance and planned time', async () => {
      await addPlace('Museum A', 23.7536, 90.3994);
      await addPlace('Museum B', 23.7450, 90.3800);
      await addPlace('Museum C', 23.7600, 90.3850);

      const res = await generate({ dailyStartTime: '09:00', dailyEndTime: '18:00' });
      expect(res.status).toBe(201);
      const [day] = res.body.data.days;

      expect(res.body.data.days).toHaveLength(1);
      expect(day).toMatchObject({ dayNumber: 1, date: MONDAY, startTime: expect.stringMatching(/^\d\d:\d\d$/), endTime: expect.stringMatching(/^\d\d:\d\d$/) });
      expect(day.stops.map((s) => s.order)).toEqual([1, 2, 3]);
      expect(day.stops[0]).toMatchObject({ plannedStart: expect.any(String), plannedEnd: expect.any(String), visitMinutes: 60, travelFromPrevious: { minutes: expect.any(Number), distanceMeters: expect.any(Number) } });
      expect(day.totals).toMatchObject({ distanceMeters: expect.any(Number), travelMinutes: expect.any(Number), visitMinutes: 180, plannedMinutes: expect.any(Number) });
      expect(res.body.data.totals.plannedMinutes).toBe(day.totals.plannedMinutes);
      expectWellFormed(res.body.data, { start: '09:00', end: '18:00' });
    });

    it('never includes a place that breaks a mandatory requirement (UNKNOWN parking excluded)', async () => {
      await addPlace('Has parking', 23.7536, 90.3994);
      await addPlace('Parking unknown', 23.7450, 90.3800, { parkingAvailable: 'UNKNOWN' });
      await addPlace('No parking', 23.7600, 90.3850, { parkingAvailable: 'NO' });

      const res = await generate({ parkingRequired: true });
      expect(res.body.data.days[0].stops.map((s) => s.place.name)).toEqual(['Has parking']);
    });
  });

  describe('multi-day trip', () => {
    it('spreads places over consecutive days without repeats, each day inside the window', async () => {
      for (let i = 0; i < 8; i += 1) await addPlace(`Site ${i}`, 23.74 + i * 0.004, 90.38 + (i % 3) * 0.008);

      const res = await generate({ durationDays: 3, dailyStartTime: '10:00', dailyEndTime: '14:00' });
      expect(res.status).toBe(201);
      const { days } = res.body.data;

      expect(days.map((d) => d.date)).toEqual([MONDAY, '2026-10-06', '2026-10-07']);
      expect(days.every((d) => d.stops.length > 0)).toBe(true);
      const ids = days.flatMap((d) => d.stops.map((s) => s.place.id));
      expect(new Set(ids).size).toBe(ids.length);
      expectWellFormed(res.body.data, { start: '10:00', end: '14:00' });
    });
  });

  describe('insufficient destinations', () => {
    it('422 when places cannot fill every day, with the empty days listed', async () => {
      await addPlace('Only one', 23.7536, 90.3994);

      const res = await generate({ durationDays: 3 });
      expect(res.status).toBe(422);
      expect(res.body.error).toMatchObject({
        code: 'INSUFFICIENT_MATCHING_PLACES',
        details: { eligiblePlaces: 1, scheduledPlaces: 1, emptyDays: [{ dayNumber: 2, date: '2026-10-06' }, { dayNumber: 3, date: '2026-10-07' }] },
      });
    });

    it('422 when nothing nearby exists at all', async () => {
      const res = await generate({});
      expect(res.status).toBe(422);
      expect(res.body.error.details).toMatchObject({ candidatesInRadius: 0, suggestions: expect.arrayContaining([expect.stringMatching(/radius/)]) });
    });
  });

  describe('tight time windows', () => {
    beforeEach(async () => {
      await addPlace('Near 1', 23.7536, 90.3994);
      await addPlace('Near 2', 23.7450, 90.3800);
      await addPlace('Near 3', 23.7600, 90.3850);
    });

    it('fits only what the window allows, including the trip back', async () => {
      const res = await generate({ dailyStartTime: '09:00', dailyEndTime: '10:45' });
      expect(res.status).toBe(201);
      expect(res.body.data.days[0].stops).toHaveLength(1); // 2 × 60-min visits + travel cannot fit
      expectWellFormed(res.body.data, { start: '09:00', end: '10:45' });
    });

    it('422 when the window is too short for any visit', async () => {
      const res = await generate({ dailyStartTime: '09:00', dailyEndTime: '09:45' });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('INSUFFICIENT_MATCHING_PLACES');
    });
  });

  describe('opening-hour conflicts', () => {
    it('waits for a late opening: the day starts later instead of idling at the door', async () => {
      await addPlace('Opens at noon', 23.7536, 90.3994, { openingHours: hours(ALL_DAYS, '12:00', '18:00') });

      const res = await generate({ dailyStartTime: '09:00', dailyEndTime: '18:00' });
      const [day] = res.body.data.days;
      expect(day.stops[0].plannedStart).toBe('12:00');
      expect(day.startTime > '09:00').toBe(true); // leave just in time
      expectWellFormed(res.body.data, { start: '09:00', end: '18:00' });
    });

    it('puts a place on the one trip day it is open', async () => {
      await addPlace('Every day', 23.7536, 90.3994);
      await addPlace('Tuesdays only', 23.7450, 90.3800, { openingHours: hours([2], '09:00', '18:00') });

      const res = await generate({ durationDays: 2 });
      const tuesday = res.body.data.days.find((d) => d.date === '2026-10-06');
      expect(tuesday.stops.map((s) => s.place.name)).toContain('Tuesdays only');
      expectWellFormed(res.body.data, { start: '09:00', end: '20:00' });
    });

    it('excludes a place open only outside the user\'s hours, and says so', async () => {
      await addPlace('Daytime', 23.7536, 90.3994);
      await addPlace('Night market', 23.7450, 90.3800, { openingHours: hours(ALL_DAYS, '19:00', '23:00') });

      const res = await generate({ dailyStartTime: '09:00', dailyEndTime: '17:00' });
      expect(res.body.data.days[0].stops.map((s) => s.place.name)).toEqual(['Daytime']);
    });

    it('422 naming opening hours as the limit when that is all that is nearby', async () => {
      await addPlace('Night market', 23.7450, 90.3800, { openingHours: hours(ALL_DAYS, '19:00', '23:00') });

      const res = await generate({ dailyStartTime: '09:00', dailyEndTime: '17:00' });
      expect(res.status).toBe(422);
      expect(res.body.error.details.excludedBy).toEqual({ openDuringTrip: 1 });
      expect(res.body.error.details.suggestions[0]).toMatch(/closed during your daily hours/);
    });

    it('422 SELECTED_PLACES_NOT_FEASIBLE when a chosen place is closed during the trip', async () => {
      const weekendOnly = await addPlace('Weekend bazaar', 23.7536, 90.3994, { openingHours: hours([6, 7], '09:00', '18:00') });
      const res = await generate({ selectedPlaceIds: [weekendOnly.id] });

      expect(res.status).toBe(422);
      expect(res.body.error).toMatchObject({
        code: 'SELECTED_PLACES_NOT_FEASIBLE',
        details: { places: [{ placeId: weekendOnly.id, reason: 'FAILS_REQUIREMENTS', requirements: ['openDuringTrip'] }] },
      });
    });
  });
});

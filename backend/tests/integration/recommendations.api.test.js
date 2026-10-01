import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createIntegrationApp, testDatabaseUrl } from '../helpers/integrationApp.js';
import { buildTestApp, createInMemoryRateLimiter } from '../helpers/testApp.js';

// 2026-10-05 is a Monday.
const MONDAY = '2026-10-05';
const CENTRE = { latitude: 23.8103, longitude: 90.4125 };
const WEEKDAYS = [1, 2, 3, 4, 5].map((dayOfWeek) => ({ dayOfWeek, opensAt: '09:00', closesAt: '17:00' }));

describe.skipIf(!testDatabaseUrl)('Recommendations and place tags/hours (PostGIS)', () => {
  let ctx;
  let moderator;
  let user;

  const api = () => request(ctx.app);
  const createPlace = async (overrides) => {
    const res = await api()
      .post('/api/v1/places')
      .set(moderator.headers)
      .send({ name: 'Place', category: 'museum', location: { latitude: 23.75, longitude: 90.40 }, ...overrides });
    expect(res.status).toBe(201);
    return res.body.data;
  };
  const recommend = (body) => api().post('/api/v1/recommendations').send({ location: CENTRE, startDate: MONDAY, ...body });
  const names = (res) => res.body.data.map((r) => r.place.name);

  beforeAll(async () => {
    ctx = await createIntegrationApp();
  });

  beforeEach(async () => {
    await ctx.reset();
    moderator = await ctx.signUp('moderator', 'moderator');
    user = await ctx.signUp('user');
  });

  afterAll(async () => {
    await ctx?.teardown();
  });

  describe('place tags and opening hours', () => {
    it('stores and returns tags and weekly hours (24:00 included)', async () => {
      const place = await createPlace({
        tags: ['history', 'architecture', 'history'],
        openingHours: [...WEEKDAYS, { dayOfWeek: 6, opensAt: '18:00', closesAt: '24:00' }],
      });

      expect(place.tags).toEqual(['architecture', 'history']);
      expect(place.openingHours).toHaveLength(6);
      expect(place.openingHours.at(-1)).toEqual({ dayOfWeek: 6, opensAt: '18:00', closesAt: '24:00' });
    });

    it('defaults to no tags and unknown hours', async () => {
      const place = await createPlace();
      expect(place).toMatchObject({ tags: [], openingHours: [] });
    });

    it('replaces tags and hours on update; [] clears hours back to unknown', async () => {
      const place = await createPlace({ tags: ['history'], openingHours: WEEKDAYS });
      const res = await api().patch(`/api/v1/places/${place.id}`).set(moderator.headers).send({ tags: ['food'], openingHours: [] });
      expect(res.body.data).toMatchObject({ tags: ['food'], openingHours: [] });
    });

    it.each([
      ['an unknown interest', { tags: ['astrology'] }, 'tags'],
      ['closing before opening', { openingHours: [{ dayOfWeek: 1, opensAt: '18:00', closesAt: '09:00' }] }, 'openingHours.0'],
      ['an invalid time', { openingHours: [{ dayOfWeek: 1, opensAt: '9am', closesAt: '17:00' }] }, 'openingHours.0.opensAt'],
      ['day 8', { openingHours: [{ dayOfWeek: 8, opensAt: '09:00', closesAt: '17:00' }] }, 'openingHours.0.dayOfWeek'],
      [
        'overlapping hours on one day',
        { openingHours: [{ dayOfWeek: 1, opensAt: '09:00', closesAt: '13:00' }, { dayOfWeek: 1, opensAt: '12:00', closesAt: '17:00' }] },
        'openingHours',
      ],
    ])('rejects %s', async (_label, body, path) => {
      const res = await api().post('/api/v1/places').set(moderator.headers).send({
        name: 'X', category: 'museum', location: { latitude: 23.75, longitude: 90.4 }, ...body,
      });
      expect(res.status).toBe(400);
      expect(res.body.error.details.map((d) => d.path)).toContain(path);
    });

    it('lists available interests', async () => {
      const res = await api().get('/api/v1/tags');
      expect(res.body.data).toContainEqual({ slug: 'history', name: 'History' });
    });
  });

  describe('POST /api/v1/recommendations', () => {
    beforeEach(async () => {
      await createPlace({
        name: 'Lalbagh Fort', category: 'historical_site', location: { latitude: 23.7189, longitude: 90.3882 },
        tags: ['history', 'architecture'], entryFee: 20, openingHours: WEEKDAYS,
        parkingAvailable: 'YES', petFriendly: 'NO',
      });
      await createPlace({
        name: 'Hatirjheel Lake', category: 'lake_or_river', location: { latitude: 23.7536, longitude: 90.3994 },
        tags: ['nature', 'photography'], entryFee: 0, parkingAvailable: 'UNKNOWN', petFriendly: 'YES',
      });
      await createPlace({
        name: 'Star Mosque', category: 'religious_site', location: { latitude: 23.7154, longitude: 90.4011 },
        tags: ['history', 'religion'], entryFee: null, parkingAvailable: 'NO', petFriendly: 'UNKNOWN',
        openingHours: [{ dayOfWeek: 7, opensAt: '09:00', closesAt: '17:00' }], // Sundays only
      });
    });

    it('ranks by interest and explains why, with factual reasons and warnings', async () => {
      const res = await recommend({ interests: ['history'], searchRadiusKm: 15 });

      expect(res.status).toBe(200);
      // Star Mosque is closed every day of a Monday trip: excluded, not just ranked low.
      expect(names(res)).toEqual(['Lalbagh Fort', 'Hatirjheel Lake']);
      const [top, second] = res.body.data;
      expect(top.score).toBeGreaterThan(second.score);
      expect(top.reasons).toEqual(expect.arrayContaining([
        'Matches your interests: history',
        'Open during your daily hours on your trip day',
      ]));
      expect(second.warnings).toEqual(expect.arrayContaining(['No ratings yet', 'Opening hours could not be verified']));
      expect(res.body.meta).toMatchObject({ startDate: MONDAY, candidatesInRadius: 3, eligible: 2, returned: 2, excludedBy: { openDuringTrip: 1 } });
    });

    it('parking requirement: UNKNOWN and NO are excluded, and the response says so', async () => {
      const res = await recommend({ parkingRequired: true, searchRadiusKm: 15, dailyEndTime: '18:00' });

      expect(names(res)).toEqual(['Lalbagh Fort']);
      expect(res.body.data[0].reasons).toContain('Parking available (matches your parking requirement)');
      expect(res.body.meta.excludedBy.parking).toBe(2);
      expect(res.body.meta.suggestions[0]).toBe('2 nearby places are not confirmed to have parking');
    });

    it('pet requirement: only explicit YES', async () => {
      expect(names(await recommend({ travelingWithPet: true, searchRadiusKm: 15 }))).toEqual(['Hatirjheel Lake']);
    });

    it('nothing qualifies: empty list plus the limiting requirements, never relaxed silently', async () => {
      const res = await recommend({ travelingWithPet: true, parkingRequired: true, searchRadiusKm: 15 });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.meta.eligible).toBe(0);
      expect(res.body.meta.suggestions).toEqual(expect.arrayContaining([
        expect.stringContaining('not confirmed to have parking'),
        expect.stringContaining('not confirmed pet-friendly'),
        'Increase the search radius (currently 15 km)',
      ]));
    });

    it('respects the search radius', async () => {
      const res = await recommend({ searchRadiusKm: 7 }); // only Hatirjheel (6.42 km)
      expect(names(res)).toEqual(['Hatirjheel Lake']);
      expect(res.body.data[0].place.distanceMeters).toBeLessThanOrEqual(7_000);
    });

    it('budget: flags unknown fees instead of treating them as free', async () => {
      const res = await recommend({ searchRadiusKm: 15, budget: { amount: 500, type: 'total' }, startDate: '2026-10-11' }); // Sunday
      const mosque = res.body.data.find((r) => r.place.name === 'Star Mosque');
      const lake = res.body.data.find((r) => r.place.name === 'Hatirjheel Lake');

      expect(mosque.warnings).toContain('Entry fee unknown');
      expect(lake.reasons).toContain('Free entry');
      expect(lake.breakdown.budget).toBeGreaterThan(mosque.breakdown.budget);
    });

    it('reflects new reviews immediately (cache invalidated)', async () => {
      const first = await recommend({ searchRadiusKm: 15 });
      const lake = first.body.data.find((r) => r.place.name === 'Hatirjheel Lake');

      await api().post(`/api/v1/places/${lake.place.id}/reviews`).set(user.headers).send({ rating: 5 });
      const after = (await recommend({ searchRadiusKm: 15 })).body.data.find((r) => r.place.name === 'Hatirjheel Lake');

      expect(after.reasons).toContain('Rated 5 from 1 review');
      expect(after.score).toBeGreaterThan(lake.score);
    });

    it.each([
      ['missing location', { location: undefined }, 'location'],
      ['invalid latitude', { location: { latitude: 95, longitude: 90 } }, 'location.latitude'],
      ['radius over 50 km', { searchRadiusKm: 51 }, 'searchRadiusKm'],
      ['an unknown interest', { interests: ['astrology'] }, 'interests'],
      ['an unknown category', { preferredCategories: ['spaceport'] }, 'preferredCategories'],
      ['end time before start', { dailyStartTime: '18:00', dailyEndTime: '09:00' }, 'dailyEndTime'],
      ['an invalid date', { startDate: '2026-02-30' }, 'startDate'],
      ['a non-boolean requirement', { parkingRequired: 'yes' }, 'parkingRequired'],
      ['rating above 5', { minimumRating: 6 }, 'minimumRating'],
    ])('returns 400 for %s', async (_label, body, path) => {
      const res = await recommend(body);
      expect(res.status).toBe(400);
      expect(res.body.error.details.map((d) => d.path)).toContain(path);
    });
  });
});

describe('recommendations rate limit', () => {
  it('returns 429 when the recommendations limit is reached', async () => {
    const app = buildTestApp({ rateLimiter: createInMemoryRateLimiter({ recommendations: 0 }) });
    const res = await request(app).post('/api/v1/recommendations').send({ location: CENTRE });
    expect(res.status).toBe(429);
  });
});

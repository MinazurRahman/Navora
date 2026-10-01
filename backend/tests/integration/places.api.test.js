import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createIntegrationApp, testDatabaseUrl as url } from '../helpers/integrationApp.js';

// Full app on the real PostGIS test database (spatial SQL cannot be faked).

// Real Dhaka landmarks. Distances from CENTRE (computed by PostGIS): Hatirjheel 6.42 km,
// National Museum 8.26 km, Lalbagh 10.42 km, Ahsan Manzil 11.28 km, Chattogram 216.91 km.
const CENTRE = { latitude: 23.8103, longitude: 90.4125 };
const at = (latitude, longitude) => ({ latitude, longitude });

describe.skipIf(!url)('Places API (PostGIS)', () => {
  let ctx;
  let db;
  let user;
  let otherUser;
  let moderator;

  const api = () => request(ctx.app);
  const auth = (session) => session.headers;

  const placeBody = (overrides = {}) => ({
    name: 'Lalbagh Fort',
    description: 'Mughal fort complex from the 17th century',
    category: 'historical_site',
    location: at(23.7189, 90.3882),
    entryFee: 20,
    ...overrides,
  });

  async function createPlace(session, overrides) {
    const res = await api().post('/api/v1/places').set(auth(session)).send(placeBody(overrides));
    expect(res.status).toBe(201);
    return res.body.data;
  }

  beforeAll(async () => {
    ctx = await createIntegrationApp();
    db = ctx.db;
  });

  beforeEach(async () => {
    await ctx.reset();
    user = await ctx.signUp('user');
    otherUser = await ctx.signUp('other');
    moderator = await ctx.signUp('moderator', 'moderator');
  });

  afterAll(async () => {
    await ctx?.teardown();
  });

  describe('create', () => {
    it('creates a PENDING community submission and records the audit event', async () => {
      const place = await createPlace(user);

      expect(place).toMatchObject({
        name: 'Lalbagh Fort',
        category: { slug: 'historical_site', name: 'Historical Site' },
        location: { latitude: 23.7189, longitude: 90.3882 },
        entryFee: 20,
        currency: 'BDT',
        status: 'PENDING',
        createdBy: user.id,
        rating: { average: null, count: 0 },
        facilities: { parking: 'UNKNOWN', petFriendly: 'UNKNOWN', wheelchairAccessible: 'UNKNOWN' },
      });
      const events = await db('place_moderation_events').where({ place_id: place.id });
      expect(events).toMatchObject([{ action: 'SUBMITTED', to_status: 'PENDING', actor_id: user.id }]);
    });

    it('approves places created by moderators directly', async () => {
      expect((await createPlace(moderator)).status).toBe('APPROVED');
    });

    it('ignores client-supplied status and owner', async () => {
      const place = await createPlace(user, { status: 'APPROVED', createdBy: otherUser.id });
      expect(place.status).toBe('PENDING');
      expect(place.createdBy).toBe(user.id);
    });

    it('requires authentication', async () => {
      const res = await api().post('/api/v1/places').send(placeBody());
      expect(res.status).toBe(401);
    });

    it('rejects an unknown category', async () => {
      const res = await api().post('/api/v1/places').set(auth(user)).send(placeBody({ category: 'spaceport' }));
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([expect.objectContaining({ path: 'category' })]);
    });

    it.each([
      ['latitude above 90', { location: at(91, 90) }, 'location.latitude'],
      ['latitude below -90', { location: at(-90.5, 90) }, 'location.latitude'],
      ['longitude above 180', { location: at(23, 180.1) }, 'location.longitude'],
      ['coordinates as strings', { location: { latitude: '23.7', longitude: '90.4' } }, 'location.latitude'],
      ['missing location', { location: undefined }, 'location'],
      ['blank name', { name: '   ' }, 'name'],
      ['over-long name', { name: 'x'.repeat(201) }, 'name'],
      ['over-long description', { description: 'x'.repeat(5001) }, 'description'],
      ['negative entry fee', { entryFee: -1 }, 'entryFee'],
      ['invalid category format', { category: 'Not A Slug!' }, 'category'],
    ])('returns 400 for %s', async (_label, overrides, path) => {
      const res = await api().post('/api/v1/places').set(auth(user)).send(placeBody(overrides));
      expect(res.status).toBe(400);
      expect(res.body.error.details.map((d) => d.path)).toContain(path);
    });
  });

  describe('read', () => {
    it('shows approved places to everyone', async () => {
      const place = await createPlace(moderator);
      const res = await api().get(`/api/v1/places/${place.id}`);
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(place.id);
    });

    it('shows a pending place only to its submitter and moderators (404 for others)', async () => {
      const place = await createPlace(user);
      const path = `/api/v1/places/${place.id}`;

      expect((await api().get(path)).status).toBe(404);
      expect((await api().get(path).set(auth(otherUser))).status).toBe(404);
      expect((await api().get(path).set(auth(user))).status).toBe(200);
      expect((await api().get(path).set(auth(moderator))).status).toBe(200);
    });

    it('returns 400 for a malformed ID and 404 for an unknown one', async () => {
      expect((await api().get('/api/v1/places/not-a-uuid')).status).toBe(400);
      expect((await api().get('/api/v1/places/0b6b7c1e-2f4a-4c55-9d8e-3a1f2b4c5d6e')).status).toBe(404);
    });
  });

  describe('update and delete (ownership rules)', () => {
    const patch = (session, id, body) => api().patch(`/api/v1/places/${id}`).set(auth(session)).send(body);
    const remove = (session, id) => api().delete(`/api/v1/places/${id}`).set(auth(session));

    it('lets the submitter edit their PENDING place; it stays PENDING', async () => {
      const place = await createPlace(user);
      const res = await patch(user, place.id, { name: 'Lalbagh Fort (Kella)', location: at(23.719, 90.3885) });

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ name: 'Lalbagh Fort (Kella)', status: 'PENDING', location: at(23.719, 90.3885) });
    });

    it('turns an edited REJECTED submission back into PENDING and records RESUBMITTED', async () => {
      const place = await createPlace(user);
      await db('places').where({ id: place.id }).update({ status: 'REJECTED' });

      const res = await patch(user, place.id, { description: 'Added the correct opening details' });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('PENDING');

      const last = await db('place_moderation_events').where({ place_id: place.id }).orderBy('created_at', 'desc').first();
      expect(last).toMatchObject({ action: 'RESUBMITTED', from_status: 'REJECTED', to_status: 'PENDING' });
    });

    it('forbids the submitter from editing their place once APPROVED', async () => {
      const place = await createPlace(user);
      await db('places').where({ id: place.id }).update({ status: 'APPROVED' });

      const res = await patch(user, place.id, { name: 'Renamed' });
      expect(res.status).toBe(403);
    });

    it('forbids other users from modifying an approved place', async () => {
      const place = await createPlace(moderator);

      expect((await patch(otherUser, place.id, { name: 'Vandalised' })).status).toBe(403);
      expect((await remove(otherUser, place.id)).status).toBe(403);
      expect((await api().get(`/api/v1/places/${place.id}`)).body.data.name).toBe('Lalbagh Fort');
    });

    it("hides other users' pending places entirely (404)", async () => {
      const place = await createPlace(user);
      expect((await patch(otherUser, place.id, { name: 'x' })).status).toBe(404);
    });

    it('requires authentication to modify', async () => {
      const place = await createPlace(moderator);
      expect((await api().patch(`/api/v1/places/${place.id}`).send({ name: 'x' })).status).toBe(401);
      expect((await api().delete(`/api/v1/places/${place.id}`)).status).toBe(401);
    });

    it('lets moderators edit approved places', async () => {
      const place = await createPlace(user);
      await db('places').where({ id: place.id }).update({ status: 'APPROVED' });

      const res = await patch(moderator, place.id, { entryFee: 30, parkingAvailable: 'YES' });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ entryFee: 30, status: 'APPROVED', facilities: { parking: 'YES' } });
    });

    it('rejects an empty update', async () => {
      const place = await createPlace(user);
      expect((await patch(user, place.id, {})).status).toBe(400);
    });

    it('DELETE archives: the place leaves public view but the row remains', async () => {
      const place = await createPlace(moderator);
      const res = await remove(moderator, place.id);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('ARCHIVED');
      expect((await api().get(`/api/v1/places/${place.id}`)).status).toBe(404);
      expect((await api().get('/api/v1/places')).body.meta.total).toBe(0);
      expect(await db('places').where({ id: place.id }).first()).toBeDefined();
    });

    it('lets a submitter withdraw their pending place', async () => {
      const place = await createPlace(user);
      expect((await remove(user, place.id)).body.data.status).toBe('ARCHIVED');
    });
  });

  describe('listing, nearby, search, filters and pagination', () => {
    beforeEach(async () => {
      const seed = [
        { name: 'Lalbagh Fort', category: 'historical_site', location: at(23.7189, 90.3882), entryFee: 20 },
        { name: 'Ahsan Manzil', category: 'museum', location: at(23.7086, 90.4062), entryFee: 50 },
        { name: 'Hatirjheel Lake', category: 'lake_or_river', location: at(23.7536, 90.3994), entryFee: 0 },
        { name: 'Bangladesh National Museum', category: 'museum', location: at(23.7375, 90.3950), entryFee: null },
        { name: 'Chattogram War Cemetery', category: 'historical_site', location: at(22.3569, 91.8317), entryFee: 0 },
      ];
      for (const place of seed) await createPlace(moderator, place);
      await createPlace(user, { name: 'Pending Museum', category: 'museum', location: at(23.75, 90.40) });

      // Ratings: Ahsan Manzil 4.5, Lalbagh 3.0, others unrated.
      await db('places').where({ name: 'Ahsan Manzil' }).update({ rating_sum: 9, review_count: 2 });
      await db('places').where({ name: 'Lalbagh Fort' }).update({ rating_sum: 3, review_count: 1 });
    });

    const names = (res) => res.body.data.map((p) => p.name);
    const nearby = (query) => api().get('/api/v1/places/nearby').query({ ...CENTRE, ...query });

    it('lists approved places only, newest first', async () => {
      const res = await api().get('/api/v1/places');
      expect(res.status).toBe(200);
      expect(res.body.meta.total).toBe(5);
      expect(names(res)).not.toContain('Pending Museum');
      expect(names(res)[0]).toBe('Chattogram War Cemetery');
    });

    it('nearby: returns places within the radius, closest first, with distances', async () => {
      const res = await nearby({ radiusKm: 12 });

      expect(res.status).toBe(200);
      expect(names(res)).toEqual(['Hatirjheel Lake', 'Bangladesh National Museum', 'Lalbagh Fort', 'Ahsan Manzil']);
      const distances = res.body.data.map((p) => p.distanceMeters);
      expect(distances).toEqual([...distances].sort((a, b) => a - b));
      expect(distances[0]).toBeGreaterThan(6_300);
      expect(distances[0]).toBeLessThan(6_500);
    });

    it('nearby: a smaller radius excludes farther places', async () => {
      expect(names(await nearby({ radiusKm: 9 }))).toEqual(['Hatirjheel Lake', 'Bangladesh National Museum']);
    });

    it.each([
      [{ latitude: 91 }, 'latitude'],
      [{ longitude: -181 }, 'longitude'],
      [{ latitude: 'abc' }, 'latitude'],
      [{ latitude: '' }, 'latitude'],
      [{ radiusKm: 51 }, 'radiusKm'],
      [{ radiusKm: 0 }, 'radiusKm'],
    ])('nearby: rejects invalid query %o', async (override, path) => {
      const res = await nearby(override);
      expect(res.status).toBe(400);
      expect(res.body.error.details.map((d) => d.path)).toContain(path);
    });

    it('nearby: requires coordinates', async () => {
      expect((await api().get('/api/v1/places/nearby')).status).toBe(400);
    });

    it('filters by one or more categories', async () => {
      expect(names(await api().get('/api/v1/places').query({ category: 'museum' })).sort()).toEqual([
        'Ahsan Manzil',
        'Bangladesh National Museum',
      ]);
      expect((await api().get('/api/v1/places').query({ category: 'museum,lake_or_river' })).body.meta.total).toBe(3);
    });

    it('filters by budget, excluding places whose fee is unknown', async () => {
      const res = await api().get('/api/v1/places').query({ maxEntryFee: 20 });
      expect(names(res).sort()).toEqual(['Chattogram War Cemetery', 'Hatirjheel Lake', 'Lalbagh Fort']);
      expect(names(res)).not.toContain('Bangladesh National Museum'); // fee unknown
    });

    it('filters by minimum rating, excluding unrated places', async () => {
      expect(names(await api().get('/api/v1/places').query({ minRating: 4 }))).toEqual(['Ahsan Manzil']);
      expect((await api().get('/api/v1/places').query({ minRating: 3 })).body.meta.total).toBe(2);
    });

    it('combines geographic and attribute filters', async () => {
      const res = await nearby({ radiusKm: 12, category: 'museum', minRating: 4 });
      expect(names(res)).toEqual(['Ahsan Manzil']);
    });

    it('rejects invalid filter values', async () => {
      expect((await api().get('/api/v1/places').query({ minRating: 6 })).status).toBe(400);
      expect((await api().get('/api/v1/places').query({ maxEntryFee: -5 })).status).toBe(400);
      expect((await api().get('/api/v1/places').query({ category: 'Bad Slug' })).status).toBe(400);
    });

    it('search: matches whole words in name or description', async () => {
      const res = await api().get('/api/v1/places/search').query({ q: 'museum' });
      expect(names(res)).toEqual(['Bangladesh National Museum']);
    });

    it('search: tolerates typos in the name (trigram)', async () => {
      expect(names(await api().get('/api/v1/places/search').query({ q: 'Lalbag Fort' }))[0]).toBe('Lalbagh Fort');
    });

    it('search: combines with filters and never returns pending places', async () => {
      expect(names(await api().get('/api/v1/places/search').query({ q: 'museum', category: 'museum' }))).not.toContain(
        'Pending Museum',
      );
      expect((await api().get('/api/v1/places/search')).status).toBe(400); // q required
    });

    it('paginates with metadata', async () => {
      const page1 = await api().get('/api/v1/places').query({ limit: 2, page: 1 });
      const page3 = await api().get('/api/v1/places').query({ limit: 2, page: 3 });

      expect(page1.body.meta).toEqual({ page: 1, limit: 2, total: 5, totalPages: 3 });
      expect(page1.body.data).toHaveLength(2);
      expect(page3.body.data).toHaveLength(1);

      const all = [...names(page1), ...names(await api().get('/api/v1/places').query({ limit: 2, page: 2 })), ...names(page3)];
      expect(new Set(all).size).toBe(5); // no duplicates or gaps across pages
    });

    it('paginates nearby results in distance order', async () => {
      const page2 = await nearby({ radiusKm: 12, limit: 2, page: 2 });
      expect(names(page2)).toEqual(['Lalbagh Fort', 'Ahsan Manzil']);
      expect(page2.body.meta.total).toBe(4);
    });

    it('rejects out-of-range pagination', async () => {
      expect((await api().get('/api/v1/places').query({ limit: 51 })).status).toBe(400);
      expect((await api().get('/api/v1/places').query({ page: 0 })).status).toBe(400);
    });

    it('lists categories for the frontend', async () => {
      const res = await api().get('/api/v1/categories');
      expect(res.body.data).toContainEqual(expect.objectContaining({ slug: 'museum', name: 'Museum' }));
    });
  });
});

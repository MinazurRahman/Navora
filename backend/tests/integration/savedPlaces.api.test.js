import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createIntegrationApp, testDatabaseUrl } from '../helpers/integrationApp.js';

describe.skipIf(!testDatabaseUrl)('Saved places and my review (PostGIS)', () => {
  let ctx;
  let user;
  let other;
  let moderator;

  const api = () => request(ctx.app);
  const placeBody = (name) => ({
    name,
    category: 'museum',
    location: { latitude: 23.7375, longitude: 90.3949 },
  });
  const create = (session, name) => api().post('/api/v1/places').set(session.headers).send(placeBody(name));
  const save = (session, placeId) => api().post('/api/v1/saved-places').set(session.headers).send({ placeId });
  const list = (session, query = {}) => api().get('/api/v1/saved-places').set(session.headers).query(query);

  beforeAll(async () => {
    ctx = await createIntegrationApp();
  });

  beforeEach(async () => {
    await ctx.reset();
    user = await ctx.signUp('user');
    other = await ctx.signUp('other');
    moderator = await ctx.signUp('moderator', 'moderator');
  });

  afterAll(async () => {
    await ctx?.teardown();
  });

  describe('saved places', () => {
    it('saves idempotently, lists most recent first, reports status and removes', async () => {
      const first = (await create(moderator, 'National Museum')).body.data.id;
      const second = (await create(moderator, 'Liberation War Museum')).body.data.id;

      expect((await save(user, first)).body.data).toEqual({ placeId: first, saved: true });
      expect((await save(user, first)).status).toBe(200); // again: no error, no duplicate
      await save(user, second);

      const page = await list(user);
      expect(page.headers['cache-control']).toBe('private, no-store');
      expect(page.body.data.map((p) => p.name)).toEqual(['Liberation War Museum', 'National Museum']);
      expect(page.body.meta).toMatchObject({ total: 2, page: 1 });

      const status = await api().get(`/api/v1/saved-places/${first}`).set(user.headers);
      expect(status.body.data).toEqual({ placeId: first, saved: true });

      expect((await api().delete(`/api/v1/saved-places/${first}`).set(user.headers)).body.data).toEqual({ placeId: first, saved: false });
      expect((await api().delete(`/api/v1/saved-places/${first}`).set(user.headers)).status).toBe(200); // idempotent
      expect((await list(user)).body.data.map((p) => p.name)).toEqual(['Liberation War Museum']);
    });

    it('keeps each user’s saved places private', async () => {
      const place = (await create(moderator, 'National Museum')).body.data.id;
      await save(user, place);
      expect((await list(other)).body.meta.total).toBe(0);
      expect((await api().get(`/api/v1/saved-places/${place}`).set(other.headers)).body.data.saved).toBe(false);
      expect((await api().get('/api/v1/saved-places')).status).toBe(401);
    });

    it('refuses places that are not approved: 409 for their submitter, 404 for others', async () => {
      const pending = (await create(user, 'Pending gallery')).body.data.id;
      const mine = await save(user, pending);
      expect(mine.status).toBe(409);
      expect(mine.body.error.code).toBe('PLACE_NOT_SAVEABLE');
      expect((await save(other, pending)).body.error.code).toBe('PLACE_NOT_FOUND');
    });

    it('stops listing a saved place once it is archived', async () => {
      const place = (await create(moderator, 'National Museum')).body.data.id;
      await save(user, place);
      await api().delete(`/api/v1/places/${place}`).set(moderator.headers);
      expect((await list(user)).body.meta.total).toBe(0);
    });
  });

  describe('my review', () => {
    it('returns the caller’s own review, or null', async () => {
      const place = (await create(moderator, 'National Museum')).body.data.id;
      await api().post(`/api/v1/places/${place}/reviews`).set(user.headers).send({ rating: 4, comment: 'Worth it' });

      const mine = await api().get(`/api/v1/places/${place}/reviews/mine`).set(user.headers);
      expect(mine.status).toBe(200);
      expect(mine.body.data).toMatchObject({ rating: 4, comment: 'Worth it', author: { id: user.id } });

      expect((await api().get(`/api/v1/places/${place}/reviews/mine`).set(other.headers)).body.data).toBeNull();
      expect((await api().get(`/api/v1/places/${place}/reviews/mine`)).status).toBe(401);
    });

    it('answers 404 for a place the caller may not see', async () => {
      const pending = (await create(user, 'Pending gallery')).body.data.id;
      expect((await api().get(`/api/v1/places/${pending}/reviews/mine`).set(other.headers)).status).toBe(404);
    });
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createIntegrationApp, testDatabaseUrl } from '../helpers/integrationApp.js';

describe.skipIf(!testDatabaseUrl)('Place caching (PostGIS + in-memory Redis)', () => {
  let ctx;
  let user;
  let moderator;

  const api = () => request(ctx.app);
  const cacheKeys = () => [...ctx.redis.store.keys()];
  const near = { latitude: 23.8103, longitude: 90.4125, radiusKm: 20 };
  const body = (overrides = {}) => ({
    name: 'Lalbagh Fort',
    category: 'historical_site',
    location: { latitude: 23.7189, longitude: 90.3882 },
    entryFee: 20,
    ...overrides,
  });
  const createPlace = async (session, overrides) =>
    (await api().post('/api/v1/places').set(session.headers).send(body(overrides))).body.data;

  beforeAll(async () => {
    ctx = await createIntegrationApp();
  });

  beforeEach(async () => {
    await ctx.reset();
    user = await ctx.signUp('user');
    moderator = await ctx.signUp('moderator', 'moderator');
  });

  afterAll(async () => {
    await ctx?.teardown();
  });

  it('serves place details from the cache (proved by changing the DB behind its back)', async () => {
    const place = await createPlace(moderator);
    await api().get(`/api/v1/places/${place.id}`);
    await ctx.db('places').where({ id: place.id }).update({ name: 'Changed directly in SQL' });

    expect((await api().get(`/api/v1/places/${place.id}`)).body.data.name).toBe('Lalbagh Fort');
  });

  it('a place update through the API is visible immediately', async () => {
    const place = await createPlace(moderator);
    await api().get(`/api/v1/places/${place.id}`);
    await api().get('/api/v1/places');

    await api().patch(`/api/v1/places/${place.id}`).set(moderator.headers).send({ name: 'Lalbagh Kella' });

    expect((await api().get(`/api/v1/places/${place.id}`)).body.data.name).toBe('Lalbagh Kella');
    expect((await api().get('/api/v1/places')).body.data[0].name).toBe('Lalbagh Kella');
  });

  it('approving a submission makes it appear in cached nearby and search results', async () => {
    await createPlace(moderator);
    expect((await api().get('/api/v1/places/nearby').query(near)).body.meta.total).toBe(1);
    expect((await api().get('/api/v1/places/search').query({ q: 'mosque' })).body.meta.total).toBe(0);

    const pending = await createPlace(user, { name: 'Star Mosque', category: 'religious_site', location: { latitude: 23.7154, longitude: 90.4011 } });
    await api().post(`/api/v1/places/${pending.id}/approve`).set(moderator.headers).send({});

    expect((await api().get('/api/v1/places/nearby').query(near)).body.meta.total).toBe(2);
    expect((await api().get('/api/v1/places/search').query({ q: 'mosque' })).body.meta.total).toBe(1);
  });

  it('archiving removes the place from cached results', async () => {
    const place = await createPlace(moderator);
    await api().get(`/api/v1/places/${place.id}`);
    await api().get('/api/v1/places');

    await api().delete(`/api/v1/places/${place.id}`).set(moderator.headers);

    expect((await api().get(`/api/v1/places/${place.id}`)).status).toBe(404);
    expect((await api().get('/api/v1/places')).body.meta.total).toBe(0);
  });

  it('review changes update cached ratings immediately', async () => {
    const place = await createPlace(moderator);
    await api().get(`/api/v1/places/${place.id}`);
    await api().get('/api/v1/places').query({ minRating: 4 });

    const review = await api().post(`/api/v1/places/${place.id}/reviews`).set(user.headers).send({ rating: 5 });
    expect((await api().get(`/api/v1/places/${place.id}`)).body.data.rating).toEqual({ average: 5, count: 1 });
    expect((await api().get('/api/v1/places').query({ minRating: 4 })).body.meta.total).toBe(1);

    await api().patch(`/api/v1/reviews/${review.body.data.id}`).set(user.headers).send({ rating: 2 });
    expect((await api().get(`/api/v1/places/${place.id}`)).body.data.rating.average).toBe(2);

    await api().delete(`/api/v1/reviews/${review.body.data.id}`).set(user.headers);
    expect((await api().get(`/api/v1/places/${place.id}`)).body.data.rating).toEqual({ average: null, count: 0 });
  });

  it('never caches non-public or user-specific data', async () => {
    const pending = await createPlace(user);
    await api().get(`/api/v1/places/${pending.id}`).set(user.headers);
    await api().get(`/api/v1/places/${pending.id}`).set(moderator.headers);
    await api().get('/api/v1/places/mine').set(user.headers);
    await api().get('/api/v1/places/moderation').set(moderator.headers);

    expect(cacheKeys().some((key) => key.includes(pending.id))).toBe(false);
    expect(cacheKeys().filter((key) => !key.includes(':ver:'))).toEqual([]);
  });

  it('nearby searches from points ~30 m apart share one cache entry', async () => {
    await createPlace(moderator);
    await api().get('/api/v1/places/nearby').query(near);
    const entries = cacheKeys().length;

    const res = await api().get('/api/v1/places/nearby').query({ ...near, latitude: 23.8104, longitude: 90.4127 });
    expect(res.body.meta.total).toBe(1);
    expect(cacheKeys().length).toBe(entries);
  });

  it('equivalent queries share a key: category order and search case do not matter', async () => {
    await createPlace(moderator);
    await api().get('/api/v1/places').query({ category: 'museum,historical_site' });
    await api().get('/api/v1/places/search').query({ q: 'Lalbagh  Fort' });
    const entries = cacheKeys().length;

    await api().get('/api/v1/places').query({ category: 'historical_site,museum' });
    await api().get('/api/v1/places/search').query({ q: 'lalbagh fort' });
    expect(cacheKeys().length).toBe(entries);
  });
});

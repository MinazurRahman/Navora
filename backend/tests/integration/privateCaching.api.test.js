import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createIntegrationApp, testDatabaseUrl } from '../helpers/integrationApp.js';

const MONDAY = '2026-10-05';
const START = { latitude: 23.75, longitude: 90.39 };
const PRIVATE = 'private, no-store';
const MISSING_ID = '0b6b7c1e-2f4a-4c55-9d8e-3a1f2b4c5d6e';

// Trips and itineraries hold one user's private data: no browser or shared cache may store
// any of their responses. Public catalogue endpoints keep their existing (absent) header.
describe.skipIf(!testDatabaseUrl)('Cache-Control on private and public responses (PostGIS)', () => {
  let ctx;
  let owner;
  let stranger;
  let place;

  const api = () => request(ctx.app);
  const as = (session) => ({
    get: (path) => api().get(path).set(session.headers),
    post: (path, body) => api().post(path).set(session.headers).send(body),
    patch: (path, body) => api().patch(path).set(session.headers).send(body),
    delete: (path) => api().delete(path).set(session.headers),
  });
  const expectPrivate = (res, status) => {
    expect(res.status).toBe(status);
    expect(res.headers['cache-control']).toBe(PRIVATE);
  };

  beforeAll(async () => {
    ctx = await createIntegrationApp();
  });

  beforeEach(async () => {
    await ctx.reset();
    owner = await ctx.signUp('owner');
    stranger = await ctx.signUp('stranger');
    const moderator = await ctx.signUp('moderator', 'moderator');
    place = (await as(moderator).post('/api/v1/places', {
      name: 'Museum', category: 'museum', location: { latitude: 23.755, longitude: 90.395 }, typicalVisitMinutes: 60, entryFee: 0,
    })).body.data;
  });

  afterAll(async () => {
    await ctx?.teardown();
  });

  it('every trips endpoint, on success', async () => {
    const created = await as(owner).post('/api/v1/trips', { title: 'Trip', startLocation: START, startDate: MONDAY, durationDays: 1 });
    expectPrivate(created, 201);
    const path = `/api/v1/trips/${created.body.data.id}`;

    expectPrivate(await as(owner).get('/api/v1/trips'), 200);
    expectPrivate(await as(owner).get(path), 200);
    expectPrivate(await as(owner).patch(path, { title: 'Renamed' }), 200);
    expectPrivate(await as(owner).delete(path), 200);
  });

  it('every itineraries endpoint, on success', async () => {
    const trip = (await as(owner).post('/api/v1/trips', { title: 'Trip', startLocation: START, startDate: MONDAY, durationDays: 1 })).body.data;
    const generated = await as(owner).post('/api/v1/itineraries/generate', { tripId: trip.id });
    expectPrivate(generated, 201);
    const path = `/api/v1/itineraries/${generated.body.data.id}`;

    expectPrivate(await as(owner).get('/api/v1/itineraries'), 200);
    expectPrivate(await as(owner).get(path), 200);
    expectPrivate(await as(owner).patch(path, { days: [{ dayNumber: 1, placeIds: [place.id] }] }), 200);
    const regenerated = await as(owner).post(`${path}/regenerate`);
    expectPrivate(regenerated, 201);
    expectPrivate(await as(owner).delete(`/api/v1/itineraries/${regenerated.body.data.id}`), 200);
  });

  it('error responses from these routers too (they may describe the user\'s data)', async () => {
    const trip = (await as(owner).post('/api/v1/trips', { title: 'Trip', startLocation: START, startDate: MONDAY, durationDays: 1 })).body.data;

    expectPrivate(await as(stranger).get(`/api/v1/trips/${trip.id}`), 404);
    expectPrivate(await as(owner).get(`/api/v1/itineraries/${MISSING_ID}`), 404);
    expectPrivate(await as(owner).patch(`/api/v1/trips/${trip.id}`, { durationDays: 99 }), 400);
    expectPrivate(await as(owner).post('/api/v1/itineraries/generate', { tripId: 'not-a-uuid' }), 400);
    expectPrivate(await api().get('/api/v1/trips'), 401);
    expectPrivate(await api().get('/api/v1/itineraries'), 401);
  });

  it('public endpoints are unchanged: no Cache-Control header', async () => {
    const publicResponses = [
      await api().get('/api/v1/places'),
      await api().get(`/api/v1/places/${place.id}`),
      await api().get('/api/v1/places/search').query({ q: 'museum' }),
      await api().get('/api/v1/places/nearby').query(START),
      await api().get(`/api/v1/places/${place.id}/reviews`),
      await api().get('/api/v1/categories'),
      await api().get('/api/v1/tags'),
      await api().post('/api/v1/recommendations').send({ location: START, startDate: MONDAY }),
      await api().get('/health'),
    ];
    for (const res of publicResponses) {
      expect(res.status).toBe(200);
      expect(res.headers).not.toHaveProperty('cache-control');
    }
  });
});

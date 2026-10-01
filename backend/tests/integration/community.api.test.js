import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createIntegrationApp, testDatabaseUrl } from '../helpers/integrationApp.js';

describe.skipIf(!testDatabaseUrl)('Community: submissions, moderation, reviews (PostGIS)', () => {
  let ctx;
  let submitter;
  let reviewer;
  let otherUser;
  let moderator;

  const api = () => request(ctx.app);
  const placeBody = (overrides = {}) => ({
    name: 'Star Mosque',
    description: 'Mosque decorated with star mosaics',
    category: 'religious_site',
    location: { latitude: 23.7154, longitude: 90.4011 },
    entryFee: 0,
    ...overrides,
  });

  const submit = (session, overrides) => api().post('/api/v1/places').set(session.headers).send(placeBody(overrides));
  const approve = (session, id, body = {}) => api().post(`/api/v1/places/${id}/approve`).set(session.headers).send(body);
  const reject = (session, id, body) => api().post(`/api/v1/places/${id}/reject`).set(session.headers).send(body);

  async function approvedPlace() {
    const { body } = await submit(submitter);
    await approve(moderator, body.data.id);
    return body.data.id;
  }

  beforeAll(async () => {
    ctx = await createIntegrationApp();
  });

  beforeEach(async () => {
    await ctx.db.raw('TRUNCATE users, places CASCADE');
    submitter = await ctx.signUp('submitter');
    reviewer = await ctx.signUp('reviewer');
    otherUser = await ctx.signUp('other');
    moderator = await ctx.signUp('moderator', 'moderator');
  });

  afterAll(async () => {
    await ctx?.teardown();
  });

  describe('submissions', () => {
    it('accepts a valid submission as PENDING and lists it under "my submissions"', async () => {
      const res = await submit(submitter);
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('PENDING');

      const mine = await api().get('/api/v1/places/mine').set(submitter.headers);
      expect(mine.body.data.map((p) => [p.name, p.status])).toEqual([['Star Mosque', 'PENDING']]);
      expect((await api().get('/api/v1/places')).body.meta.total).toBe(0); // not public yet
    });

    it('rejects an invalid submission with field details', async () => {
      const res = await submit(submitter, { name: '', location: { latitude: 100, longitude: 90 }, category: 'nope_category' });
      expect(res.status).toBe(400);
      expect(res.body.error.details.map((d) => d.path)).toEqual(expect.arrayContaining(['name', 'location.latitude']));
    });

    it('"my submissions" shows only my own places and can filter by status', async () => {
      await submit(submitter);
      await submit(otherUser, { name: 'Other place' });
      const { body } = await submit(submitter, { name: 'Second' });
      await reject(moderator, body.data.id, { reason: 'Duplicate' });

      const all = await api().get('/api/v1/places/mine').set(submitter.headers);
      const rejected = await api().get('/api/v1/places/mine').query({ status: 'REJECTED' }).set(submitter.headers);

      expect(all.body.meta.total).toBe(2);
      expect(rejected.body.data.map((p) => p.name)).toEqual(['Second']);
      expect((await api().get('/api/v1/places/mine')).status).toBe(401);
    });
  });

  describe('moderation workflow', () => {
    it('queue: moderators see pending submissions, oldest first', async () => {
      await submit(submitter, { name: 'First' });
      await submit(otherUser, { name: 'Second' });

      const res = await api().get('/api/v1/places/moderation').set(moderator.headers);
      expect(res.status).toBe(200);
      expect(res.body.data.map((p) => p.name)).toEqual(['First', 'Second']);
      expect(res.body.meta.total).toBe(2);
    });

    it('approve: the place becomes public and the decision is recorded', async () => {
      const { body } = await submit(submitter);
      const res = await approve(moderator, body.data.id, { note: 'Verified on site' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('APPROVED');
      expect((await api().get(`/api/v1/places/${body.data.id}`)).status).toBe(200);
      expect((await api().get('/api/v1/places/moderation').set(moderator.headers)).body.meta.total).toBe(0);
    });

    it('reject: requires a reason, which the submitter can read in the history', async () => {
      const { body } = await submit(submitter);
      expect((await reject(moderator, body.data.id, {})).status).toBe(400);

      expect((await reject(moderator, body.data.id, { reason: 'Wrong location' })).body.data.status).toBe('REJECTED');

      const history = await api().get(`/api/v1/places/${body.data.id}/moderation-events`).set(submitter.headers);
      expect(history.status).toBe(200);
      expect(history.body.data.map((e) => e.action)).toEqual(['SUBMITTED', 'REJECTED']);
      expect(history.body.data[1]).toMatchObject({ fromStatus: 'PENDING', toStatus: 'REJECTED', note: 'Wrong location' });
    });

    it('full cycle: rejected → submitter fixes it (RESUBMITTED) → approved', async () => {
      const { body } = await submit(submitter);
      const id = body.data.id;
      await reject(moderator, id, { reason: 'Wrong location' });

      const fix = await api().patch(`/api/v1/places/${id}`).set(submitter.headers).send({ location: { latitude: 23.7155, longitude: 90.4012 } });
      expect(fix.body.data.status).toBe('PENDING');
      expect((await approve(moderator, id)).body.data.status).toBe('APPROVED');

      const history = await api().get(`/api/v1/places/${id}/moderation-events`).set(moderator.headers);
      expect(history.body.data.map((e) => e.action)).toEqual(['SUBMITTED', 'REJECTED', 'RESUBMITTED', 'APPROVED']);
    });

    it('only PENDING places can be approved or rejected (409)', async () => {
      const id = await approvedPlace();
      const res = await reject(moderator, id, { reason: 'Changed my mind' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
    });

    it('regular users cannot moderate (403) and anonymous users get 401', async () => {
      const { body } = await submit(submitter);
      const id = body.data.id;

      expect((await approve(submitter, id)).status).toBe(403); // not even their own
      expect((await reject(otherUser, id, { reason: 'x' })).status).toBe(403);
      expect((await api().get('/api/v1/places/moderation').set(submitter.headers)).status).toBe(403);
      expect((await api().post(`/api/v1/places/${id}/approve`)).status).toBe(401);
      expect((await api().get(`/api/v1/places/${id}`)).body.data).toBeUndefined(); // still hidden
    });

    it('moderation history is private to the submitter and moderators', async () => {
      const id = await approvedPlace();
      expect((await api().get(`/api/v1/places/${id}/moderation-events`).set(otherUser.headers)).status).toBe(404);
    });
  });

  describe('reviews and ratings', () => {
    let placeId;
    const reviewsPath = () => `/api/v1/places/${placeId}/reviews`;
    const postReview = (session, body) => api().post(reviewsPath()).set(session.headers).send(body);
    const placeRating = async () => (await api().get(`/api/v1/places/${placeId}`)).body.data.rating;

    beforeEach(async () => {
      placeId = await approvedPlace();
    });

    it('creates a review and updates the place average', async () => {
      const res = await postReview(reviewer, { rating: 4, comment: '  Beautiful tiles  ' });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        placeId,
        rating: 4,
        comment: 'Beautiful tiles',
        author: { id: reviewer.id, name: 'reviewer' },
      });
      await postReview(otherUser, { rating: 5 });
      expect(await placeRating()).toEqual({ average: 4.5, count: 2 });
    });

    it('allows one review per user per place (409)', async () => {
      await postReview(reviewer, { rating: 4 });
      const res = await postReview(reviewer, { rating: 2 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('REVIEW_ALREADY_EXISTS');
    });

    it.each([
      ['0', { rating: 0 }],
      ['6', { rating: 6 }],
      ['a fraction', { rating: 3.5 }],
      ['a string', { rating: '5' }],
      ['missing', {}],
    ])('rejects a rating of %s', async (_label, body) => {
      const res = await postReview(reviewer, body);
      expect(res.status).toBe(400);
      expect(res.body.error.details.map((d) => d.path)).toContain('rating');
    });

    it('rejects an over-long comment', async () => {
      expect((await postReview(reviewer, { rating: 3, comment: 'x'.repeat(2001) })).status).toBe(400);
    });

    it('cannot review places that are not approved', async () => {
      const { body } = await submit(submitter, { name: 'Pending place' });
      const pendingPath = `/api/v1/places/${body.data.id}/reviews`;

      expect((await api().post(pendingPath).set(reviewer.headers).send({ rating: 5 })).status).toBe(404); // hidden
      const own = await api().post(pendingPath).set(submitter.headers).send({ rating: 5 });
      expect(own.status).toBe(409);
      expect(own.body.error.code).toBe('PLACE_NOT_REVIEWABLE');
    });

    it('requires authentication to review', async () => {
      expect((await api().post(reviewsPath()).send({ rating: 5 })).status).toBe(401);
    });

    it('lists reviews publicly, newest first, paginated', async () => {
      await postReview(reviewer, { rating: 3, comment: 'first' });
      await postReview(otherUser, { rating: 5, comment: 'second' });

      const res = await api().get(reviewsPath()).query({ limit: 1 });
      expect(res.status).toBe(200);
      expect(res.body.data.map((r) => r.comment)).toEqual(['second']);
      expect(res.body.meta).toEqual({ page: 1, limit: 1, total: 2, totalPages: 2 });
    });

    it('the author can edit their review; the average follows', async () => {
      const { body } = await postReview(reviewer, { rating: 2, comment: 'Crowded' });
      await postReview(otherUser, { rating: 4 });

      const res = await api().patch(`/api/v1/reviews/${body.data.id}`).set(reviewer.headers).send({ rating: 4 });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ rating: 4, comment: 'Crowded' }); // untouched field kept
      expect(await placeRating()).toEqual({ average: 4, count: 2 });
    });

    it("prevents other users — even moderators — from editing someone's review", async () => {
      const { body } = await postReview(reviewer, { rating: 5 });
      const path = `/api/v1/reviews/${body.data.id}`;

      expect((await api().patch(path).set(otherUser.headers).send({ rating: 1 })).status).toBe(403);
      expect((await api().patch(path).set(moderator.headers).send({ rating: 1 })).status).toBe(403);
      expect((await api().patch(path).send({ rating: 1 })).status).toBe(401);
      expect(await placeRating()).toEqual({ average: 5, count: 1 });
    });

    it('validates review updates', async () => {
      const { body } = await postReview(reviewer, { rating: 5 });
      const path = `/api/v1/reviews/${body.data.id}`;
      expect((await api().patch(path).set(reviewer.headers).send({ rating: 9 })).status).toBe(400);
      expect((await api().patch(path).set(reviewer.headers).send({})).status).toBe(400);
    });

    it('the author can delete their review; the average follows', async () => {
      const { body } = await postReview(reviewer, { rating: 1 });
      await postReview(otherUser, { rating: 5 });

      const res = await api().delete(`/api/v1/reviews/${body.data.id}`).set(reviewer.headers);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ id: body.data.id, deleted: true });
      expect(await placeRating()).toEqual({ average: 5, count: 1 });
    });

    it("forbids deleting someone else's review, but moderators may remove it", async () => {
      const { body } = await postReview(reviewer, { rating: 5 });
      const path = `/api/v1/reviews/${body.data.id}`;

      expect((await api().delete(path).set(otherUser.headers)).status).toBe(403);
      expect((await api().delete(path).set(moderator.headers)).status).toBe(200);
      expect(await placeRating()).toEqual({ average: null, count: 0 });
    });

    it('returns 404 for unknown reviews and 400 for malformed IDs', async () => {
      expect((await api().delete('/api/v1/reviews/0b6b7c1e-2f4a-4c55-9d8e-3a1f2b4c5d6e').set(reviewer.headers)).status).toBe(404);
      expect((await api().patch('/api/v1/reviews/nope').set(reviewer.headers).send({ rating: 3 })).status).toBe(400);
    });

    it('rating filter on places uses the maintained average', async () => {
      await postReview(reviewer, { rating: 5 });
      const res = await api().get('/api/v1/places').query({ minRating: 4.5 });
      expect(res.body.data.map((p) => p.id)).toEqual([placeId]);
    });
  });
});

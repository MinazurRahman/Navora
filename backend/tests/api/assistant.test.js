import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp, buildTestConfig, createInMemoryRateLimiter } from '../helpers/testApp.js';
import { createTokenService } from '../../src/modules/auth/token.service.js';
import { createAiService } from '../../src/integrations/ai/index.js';

// HTTP behaviour of the AI Trip Assistant that needs no database: authentication, request
// validation, rate limits and the AI-disabled path. Data access is covered in
// tests/integration/assistant.api.test.js.
const USER_ID = '11111111-1111-4111-8111-111111111111';
const ITINERARY_ID = '22222222-2222-4222-8222-222222222222';
const token = createTokenService(buildTestConfig().auth).signAccessToken({ id: USER_ID, role: 'user' });
const auth = { Authorization: `Bearer ${token}` };
const valid = { itineraryId: ITINERARY_ID, task: 'summarize' };

const ask = (app, body, headers = auth) => request(app).post('/api/v1/ai/trip-assistant').set(headers).send(body);

describe('POST /api/v1/ai/trip-assistant: authentication', () => {
  it('requires a token', async () => {
    const res = await ask(buildTestApp(), valid, {});
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects an invalid token', async () => {
    const res = await ask(buildTestApp(), valid, { Authorization: 'Bearer not-a-jwt' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });
});

describe('POST /api/v1/ai/trip-assistant: request validation', () => {
  it.each([
    ['no target', { task: 'summarize' }, 'itineraryId'],
    ['both targets', { itineraryId: ITINERARY_ID, tripId: ITINERARY_ID, task: 'summarize' }, 'itineraryId'],
    ['malformed itinerary ID', { itineraryId: 'abc', task: 'summarize' }, 'itineraryId'],
    ['malformed trip ID', { tripId: '123', task: 'summarize' }, 'tripId'],
    ['unknown task', { ...valid, task: 'book_hotel' }, 'task'],
    ['question task without question', { ...valid, task: 'question' }, 'question'],
    ['question too long', { ...valid, task: 'question', question: 'x'.repeat(501) }, 'question'],
    ['explain_place without placeId', { ...valid, task: 'explain_place' }, 'placeId'],
    ['day out of range', { ...valid, dayNumber: 15 }, 'dayNumber'],
  ])('400 for %s', async (_label, body, path) => {
    const res = await ask(buildTestApp(), body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toContainEqual(expect.objectContaining({ location: 'body', path }));
  });

  it('400 INVALID_JSON for a malformed body', async () => {
    const res = await request(buildTestApp()).post('/api/v1/ai/trip-assistant').set(auth).set('Content-Type', 'application/json').send('{"task":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });
});

describe('POST /api/v1/ai/trip-assistant: rate limiting', () => {
  it('429 once the per-minute limit is reached, counted per user', async () => {
    const rateLimiter = createInMemoryRateLimiter({ assistant: 0 });
    const res = await ask(buildTestApp({ rateLimiter }), valid);
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(rateLimiter.calls).toContainEqual({ policyName: 'assistant', identifier: `user:${USER_ID}` });
  });

  it('429 once the daily limit is reached', async () => {
    const rateLimiter = createInMemoryRateLimiter({ assistantDaily: 0 });
    const res = await ask(buildTestApp({ rateLimiter }), valid);
    expect(res.status).toBe(429);
    expect(rateLimiter.calls.map((c) => c.policyName)).toEqual(['general', 'assistant', 'assistantDaily']);
  });

  it('counts requests before validating them, so invalid spam is limited too', async () => {
    const rateLimiter = createInMemoryRateLimiter({ assistant: 0 });
    expect((await ask(buildTestApp({ rateLimiter }), { task: 'nonsense' })).status).toBe(429);
  });

  it('fails closed: 503 RATE_LIMIT_UNAVAILABLE when the rate limiter is down', async () => {
    const failing = { limit: async () => { throw new Error('fetch failed'); } };
    const res = await ask(buildTestApp({ rateLimiter: failing }), valid);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('RATE_LIMIT_UNAVAILABLE');
  });
});

describe('POST /api/v1/ai/trip-assistant: AI unavailable', () => {
  it('503 AI_UNAVAILABLE (DISABLED) when AI is switched off, before touching any data', async () => {
    // The in-memory repositories have no itineraries: reaching them would be a 500.
    const res = await ask(buildTestApp(), valid);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'AI_UNAVAILABLE', message: 'The AI assistant is temporarily unavailable', details: { reason: 'DISABLED' }, requestId: expect.any(String) },
    });
  });

  it('keeps serving other requests afterwards', async () => {
    const app = buildTestApp();
    await ask(app, valid).expect(503);
    await request(app).get('/api/v1').expect(200);
  });
});

describe('GET /api/v1/ai/trip-assistant/status', () => {
  const status = (app, headers = auth) => request(app).get('/api/v1/ai/trip-assistant/status').set(headers);

  it('requires a token', async () => {
    expect((await status(buildTestApp(), {})).status).toBe(401);
  });

  it('reports a disabled assistant', async () => {
    const res = await status(buildTestApp());
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ enabled: false, available: false, reason: 'DISABLED' });
  });

  it('reports availability without provider, model, host or error details', async () => {
    const provider = {
      name: 'ollama',
      model: 'llama3.2:3b',
      generate: async () => ({}),
      checkHealth: async () => {
        throw Object.assign(new Error('Network error: ECONNREFUSED 10.0.0.5:11434'), { kind: 'UNAVAILABLE' });
      },
    };
    const res = await status(buildTestApp({ aiService: createAiService({ provider }) }));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ enabled: true, available: false, reason: 'UNAVAILABLE' });
    expect(JSON.stringify(res.body)).not.toMatch(/ollama|llama|11434|10\.0\.0\.5|ECONNREFUSED/i);
  });
});

import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { buildTestApp, createInMemoryRateLimiter } from '../helpers/testApp.js';
import { byIpAndEmail, createRateLimitMiddleware } from '../../src/middleware/rateLimit.middleware.js';
import { errorMiddleware } from '../../src/middleware/error.middleware.js';
import { createTokenService } from '../../src/modules/auth/token.service.js';

const credentials = { email: 'ayesha@example.com', password: 'wrong password' };
const failingLimiter = { limit: async () => { throw new Error('fetch failed'); } };

describe('general API limit', () => {
  it('sets RateLimit headers on API responses', async () => {
    const res = await request(buildTestApp()).get('/api/v1');

    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBeDefined();
    expect(res.headers['ratelimit-remaining']).toBeDefined();
    expect(res.headers['ratelimit-reset']).toBeDefined();
  });

  it('returns 429 RATE_LIMITED with Retry-After once the limit is reached', async () => {
    const app = buildTestApp({ rateLimiter: createInMemoryRateLimiter({ general: 2 }) });

    await request(app).get('/api/v1').expect(200);
    await request(app).get('/api/v1').expect(200);
    const res = await request(app).get('/api/v1');

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('never limits health probes', async () => {
    const rateLimiter = createInMemoryRateLimiter({ general: 0 });
    const app = buildTestApp({ rateLimiter });

    expect((await request(app).get('/health')).status).toBe(200);
    expect((await request(app).get('/ready')).status).toBe(200);
    expect(rateLimiter.calls).toHaveLength(0);
  });

  it('fails open: the API keeps working when Redis is down', async () => {
    const res = await request(buildTestApp({ rateLimiter: failingLimiter })).get('/api/v1');
    expect(res.status).toBe(200);
  });

  it('buckets authenticated users by user ID and anonymous clients by IP', async () => {
    const rateLimiter = createInMemoryRateLimiter();
    const app = buildTestApp({ rateLimiter });
    const { body } = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'A', email: 'a@example.com', password: 'long enough password' });

    await request(app).get('/api/v1').set('Authorization', `Bearer ${body.data.tokens.accessToken}`);
    await request(app).get('/api/v1').set('Authorization', 'Bearer invalid-token');

    const generalIds = rateLimiter.calls.filter((c) => c.policyName === 'general').map((c) => c.identifier);
    expect(generalIds.at(-2)).toBe(`user:${body.data.user.id}`);
    expect(generalIds.at(-1)).toMatch(/^ip:/);
  });
});

describe('credential endpoints (login, register)', () => {
  it('blocks repeated attempts on one account with 429', async () => {
    const app = buildTestApp({ rateLimiter: createInMemoryRateLimiter({ authAccount: 3 }) });

    for (let i = 0; i < 3; i += 1) await request(app).post('/api/v1/auth/login').send(credentials).expect(401);
    const res = await request(app).post('/api/v1/auth/login').send(credentials);

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });

  it('counts the same account regardless of email case or spacing', async () => {
    const app = buildTestApp({ rateLimiter: createInMemoryRateLimiter({ authAccount: 1 }) });

    await request(app).post('/api/v1/auth/login').send(credentials);
    const res = await request(app).post('/api/v1/auth/login').send({ ...credentials, email: ' AYESHA@Example.com ' });

    expect(res.status).toBe(429);
  });

  it('caps attempts across many emails from one IP', async () => {
    const app = buildTestApp({ rateLimiter: createInMemoryRateLimiter({ authIp: 2 }) });

    await request(app).post('/api/v1/auth/login').send({ ...credentials, email: 'one@example.com' });
    await request(app).post('/api/v1/auth/login').send({ ...credentials, email: 'two@example.com' });
    const res = await request(app).post('/api/v1/auth/login').send({ ...credentials, email: 'three@example.com' });

    expect(res.status).toBe(429);
  });

  it('fails closed: 503 RATE_LIMIT_UNAVAILABLE when Redis is down', async () => {
    const app = buildTestApp({ rateLimiter: failingLimiter });

    for (const path of ['/api/v1/auth/login', '/api/v1/auth/register']) {
      const res = await request(app).post(path).send({ ...credentials, name: 'A' });
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('RATE_LIMIT_UNAVAILABLE');
    }
  });

  it('does not apply credential limits to refresh', async () => {
    const app = buildTestApp({ rateLimiter: createInMemoryRateLimiter({ authIp: 0, authAccount: 0 }) });
    const res = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: 'unknown' });
    expect(res.status).toBe(401); // reached the handler, not 429
  });
});

describe('rate-limit timeout', () => {
  const tokenService = createTokenService({ jwtSecret: 's'.repeat(40), accessTokenTtlSeconds: 900, issuer: 'i', audience: 'a' });
  const hangingLimiter = { limit: () => new Promise(() => {}) };

  function appWith(failOpen) {
    const rateLimit = createRateLimitMiddleware({
      rateLimiter: hangingLimiter,
      policies: { test: { limit: 1, window: '1 m', failOpen } },
      timeoutMs: 50,
      tokenService,
    });
    const app = express();
    app.get('/x', rateLimit('test'), (req, res) => res.json({ ok: true }));
    app.use(errorMiddleware());
    return app;
  }

  it('fail-closed policies reject when Redis hangs (Upstash would have allowed it)', async () => {
    expect((await request(appWith(false)).get('/x')).status).toBe(503);
  });

  it('fail-open policies allow when Redis hangs', async () => {
    expect((await request(appWith(true)).get('/x')).status).toBe(200);
  });
});

describe('byIpAndEmail', () => {
  it('normalises the email and tolerates a missing body', () => {
    expect(byIpAndEmail({ ip: '1.2.3.4', body: { email: ' A@B.com ' } })).toBe('ip:1.2.3.4|email:a@b.com');
    expect(byIpAndEmail({ ip: '1.2.3.4', body: undefined })).toBe('ip:1.2.3.4|email:');
  });
});

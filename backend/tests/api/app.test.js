import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp, buildTestConfig, createInMemoryRepositories } from '../helpers/testApp.js';
import { createLifecycle } from '../../src/shared/lifecycle.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('GET /health', () => {
  it('returns 200 without checking dependencies', async () => {
    const app = buildTestApp({ repositories: createInMemoryRepositories({ dbHealthy: false }) });
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { status: 'ok', uptimeSeconds: expect.any(Number) } });
  });
});

describe('Cache-Control on private routers', () => {
  it.each(['/api/v1/trips', '/api/v1/itineraries', `/api/v1/trips/${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}`, '/api/v1/itineraries/no-such/route'])(
    'GET %s is never stored, even when unauthenticated',
    async (path) => {
      const res = await request(buildTestApp()).get(path);
      expect(res.status).toBe(401);
      expect(res.headers['cache-control']).toBe('private, no-store');
    },
  );

  it('leaves public and unrelated responses alone', async () => {
    const app = buildTestApp();
    for (const path of ['/health', '/ready', '/api/v1', '/api/v1/no-such-route']) {
      expect((await request(app).get(path)).headers).not.toHaveProperty('cache-control');
    }
  });
});

describe('GET /ready', () => {
  it('returns 200 when the database responds', async () => {
    const res = await request(buildTestApp()).get('/ready');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ status: 'ready', checks: { database: 'ok' } });
  });

  it('returns 503 when the database is unavailable', async () => {
    const res = await request(buildTestApp({ repositories: createInMemoryRepositories({ dbHealthy: false }) })).get('/ready');

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(res.body.error.details).toEqual({ checks: { database: 'fail' } });
    expect(JSON.stringify(res.body)).not.toContain('ECONNREFUSED');
  });

  it('returns 503 while the instance is shutting down', async () => {
    const lifecycle = createLifecycle();
    lifecycle.markShuttingDown();
    const res = await request(buildTestApp({ lifecycle })).get('/ready');

    expect(res.status).toBe(503);
    expect(res.body.error.details).toEqual({ shuttingDown: true });
  });

  it('returns 503 when the database check exceeds the readiness timeout', async () => {
    const repositories = createInMemoryRepositories();
    repositories.health.ping = () => new Promise(() => {});
    const config = buildTestConfig({ READINESS_TIMEOUT_MS: '100' });
    const res = await request(buildTestApp({ repositories, config })).get('/ready');

    expect(res.status).toBe(503);
  });
});

describe('API versioning', () => {
  it('serves the v1 API under /api/v1', async () => {
    const res = await request(buildTestApp()).get('/api/v1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { name: 'navora-api', version: 'v1' } });
  });

  it('returns the standard 404 envelope for unknown routes', async () => {
    const res = await request(buildTestApp()).get('/api/v1/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: 'Route GET /api/v1/does-not-exist not found',
        requestId: res.headers['x-request-id'],
      },
    });
  });
});

describe('request ID', () => {
  it('generates a UUID request ID when none is supplied', async () => {
    const res = await request(buildTestApp()).get('/health');
    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('reuses a safe upstream request ID', async () => {
    const res = await request(buildTestApp()).get('/health').set('X-Request-Id', 'lb-abc.123_x');
    expect(res.headers['x-request-id']).toBe('lb-abc.123_x');
  });

  it('replaces an unsafe upstream request ID', async () => {
    const res = await request(buildTestApp()).get('/health').set('X-Request-Id', 'bad id<script>');
    expect(res.headers['x-request-id']).toMatch(UUID);
  });
});

describe('security middleware', () => {
  it('sets security headers and hides the framework', async () => {
    const res = await request(buildTestApp()).get('/health');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('allows configured CORS origins', async () => {
    const config = buildTestConfig({ CORS_ORIGINS: 'http://localhost:5173' });
    const res = await request(buildTestApp({ config })).get('/api/v1').set('Origin', 'http://localhost:5173');

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-expose-headers']).toContain('X-Request-Id');
  });

  it('answers CORS preflight for allowed origins', async () => {
    const config = buildTestConfig({ CORS_ORIGINS: 'http://localhost:5173' });
    const res = await request(buildTestApp({ config }))
      .options('/api/v1')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-methods']).toContain('PATCH');
  });

  it('gives no CORS headers to other origins', async () => {
    const config = buildTestConfig({ CORS_ORIGINS: 'http://localhost:5173' });
    const res = await request(buildTestApp({ config })).get('/api/v1').set('Origin', 'https://evil.example');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('request body handling', () => {
  it('returns 400 INVALID_JSON for malformed JSON', async () => {
    const res = await request(buildTestApp())
      .post('/api/v1')
      .set('Content-Type', 'application/json')
      .send('{"broken":');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('returns 413 when the body exceeds the configured limit', async () => {
    const config = buildTestConfig({ JSON_BODY_LIMIT: '1kb' });
    const res = await request(buildTestApp({ config }))
      .post('/api/v1')
      .send({ data: 'x'.repeat(2_000) });

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});

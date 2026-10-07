import request from 'supertest';
import { createDb } from '../../src/config/database.js';
import { createApp } from '../../src/app.js';
import { createRepositories } from '../../src/repositories.js';
import { createLifecycle } from '../../src/shared/lifecycle.js';
import { createCache } from '../../src/integrations/redis/cache.js';
import { createEstimateProvider, createMapService, createMapServiceFromConfig } from '../../src/integrations/maps/index.js';
import { createAiService, createAiServiceFromConfig } from '../../src/integrations/ai/index.js';
import { PLANNING_CONFIG } from '../../src/config/planning.js';
import { buildTestConfig, createInMemoryRateLimiter, createInMemoryRedis } from './testApp.js';

export const testDatabaseUrl = process.env.TEST_DATABASE_URL;

// The full app on the real (disposable) PostGIS test database, with caching ON (in-memory
// Redis), so every integration test also proves cache invalidation is correct.
// mapProvider: optional fake routing provider (default: the distance estimate).
// aiProvider: optional fake AI provider (default: AI disabled). Tests never need Ollama.
export async function createIntegrationApp({ mapProvider, aiProvider } = {}) {
  // Same connection setup as production (incl. pg type parsers), pointed at the test DB.
  const db = createDb(buildTestConfig({ DATABASE_URL: testDatabaseUrl }));
  await db.migrate.latest();
  await db.seed.run();

  const config = buildTestConfig();
  const redis = createInMemoryRedis();
  const cache = createCache(redis);
  const mapService = mapProvider
    ? createMapService({ provider: mapProvider, fallback: createEstimateProvider(PLANNING_CONFIG), cache, ttlSeconds: 60 })
    : createMapServiceFromConfig(config, { cache });
  const app = createApp({
    config,
    lifecycle: createLifecycle(),
    repositories: createRepositories(db),
    rateLimiter: createInMemoryRateLimiter(),
    cache,
    mapService,
    aiService: aiProvider ? createAiService({ provider: aiProvider }) : createAiServiceFromConfig(config),
  });

  // Registers a user; with `role`, promotes them and logs in again so the token carries it.
  async function signUp(name, role) {
    const email = `${name}@example.com`;
    const password = 'long enough password';
    const res = await request(app).post('/api/v1/auth/register').send({ name, email, password });
    let token = res.body.data.tokens.accessToken;
    if (role) {
      await db('users').where({ email }).update({ role });
      token = (await request(app).post('/api/v1/auth/login').send({ email, password })).body.data.tokens.accessToken;
    }
    return { id: res.body.data.user.id, token, headers: { Authorization: `Bearer ${token}` } };
  }

  // Empties users/places and the cache between tests.
  async function reset() {
    await db.raw('TRUNCATE users, places CASCADE');
    redis.store.clear();
  }

  async function teardown() {
    await db.migrate.rollback(undefined, true);
    await db.destroy();
  }

  return { db, app, redis, signUp, reset, teardown };
}

import knex from 'knex';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { createRepositories } from '../../src/repositories.js';
import { createLifecycle } from '../../src/shared/lifecycle.js';
import { buildTestConfig, createInMemoryRateLimiter } from './testApp.js';

export const testDatabaseUrl = process.env.TEST_DATABASE_URL;

// The full app on the real (disposable) PostGIS test database.
export async function createIntegrationApp() {
  const db = knex({
    client: 'pg',
    connection: testDatabaseUrl,
    migrations: { directory: './migrations' },
    seeds: { directory: './seeds' },
  });
  await db.migrate.latest();
  await db.seed.run();

  const app = createApp({
    config: buildTestConfig(),
    lifecycle: createLifecycle(),
    repositories: createRepositories(db),
    rateLimiter: createInMemoryRateLimiter(),
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

  async function teardown() {
    await db.migrate.rollback(undefined, true);
    await db.destroy();
  }

  return { db, app, signUp, teardown };
}

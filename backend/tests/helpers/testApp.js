import { randomUUID } from 'node:crypto';
import { parseEnv } from '../../src/config/env.js';
import { createApp } from '../../src/app.js';
import { createLifecycle } from '../../src/shared/lifecycle.js';
import { createCache } from '../../src/integrations/redis/cache.js';

// Stand-in for the Upstash client (get/set/del/incr). Values round-trip through JSON like
// the real client, so tests see the same shapes (Dates become strings, no shared objects).
export function createInMemoryRedis() {
  const store = new Map();
  return {
    store,
    async get(key) {
      return store.has(key) ? JSON.parse(store.get(key)) : null;
    },
    async set(key, value) {
      store.set(key, JSON.stringify(value));
      return 'OK';
    },
    async del(key) {
      return store.delete(key) ? 1 : 0;
    },
    async incr(key) {
      const next = (store.has(key) ? JSON.parse(store.get(key)) : 0) + 1;
      store.set(key, JSON.stringify(next));
      return next;
    },
  };
}

export function buildTestConfig(overrides = {}) {
  return parseEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgres://test:test@localhost:5432/navora_unused',
    JWT_SECRET: 'test-only-jwt-secret-that-is-long-enough-123',
    UPSTASH_REDIS_REST_URL: 'https://upstash.invalid',
    UPSTASH_REDIS_REST_TOKEN: 'placeholder',
    ...overrides,
  });
}

// Counts requests per policy + identifier, like the Upstash limiter (fixed window is
// close enough for tests). `limits` overrides per policy; default is effectively unlimited.
export function createInMemoryRateLimiter(limits = {}) {
  const counts = new Map();
  return {
    calls: [],
    async limit(policyName, identifier) {
      this.calls.push({ policyName, identifier });
      const key = `${policyName}|${identifier}`;
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      const limit = limits[policyName] ?? 1_000_000;
      return { success: count <= limit, limit, remaining: limit - count, reset: Date.now() + 60_000 };
    },
  };
}

function withoutPasswordHash({ password_hash: _omit, ...rest }) {
  return rest;
}

// In-memory stand-ins with the same interface and the behaviours the services rely on
// (case-insensitive unique email, atomic claim). The real SQL is covered by
// tests/integration when a database is available.
export function createInMemoryRepositories({ dbHealthy = true } = {}) {
  const users = new Map();
  const refreshTokens = [];
  const findUserByEmail = (email) => [...users.values()].find((u) => u.email.toLowerCase() === email.toLowerCase());

  return {
    health: {
      async ping() {
        if (!dbHealthy) throw new Error('connect ECONNREFUSED');
      },
    },

    users: {
      async create({ name, email, passwordHash }) {
        if (findUserByEmail(email)) {
          throw Object.assign(new Error('duplicate key value'), { code: '23505', constraint: 'users_email_key' });
        }
        const now = new Date();
        const row = {
          id: randomUUID(),
          name,
          email,
          password_hash: passwordHash,
          role: 'user',
          profile_image_url: null,
          is_active: true,
          created_at: now,
          updated_at: now,
        };
        users.set(row.id, row);
        return withoutPasswordHash(row);
      },
      async findById(id) {
        const row = users.get(id);
        return row && withoutPasswordHash(row);
      },
      async findCredentialsByEmail(email) {
        const row = findUserByEmail(email);
        return row && { ...row };
      },
    },

    refreshTokens: {
      async create({ userId, familyId, tokenHash, expiresAt }) {
        const row = {
          id: randomUUID(),
          user_id: userId,
          family_id: familyId,
          token_hash: tokenHash,
          expires_at: expiresAt,
          revoked_at: null,
          replaced_by_id: null,
        };
        refreshTokens.push(row);
        return { id: row.id };
      },
      async claim(tokenHash) {
        const row = refreshTokens.find((t) => t.token_hash === tokenHash && t.revoked_at === null);
        if (!row) return undefined;
        row.revoked_at = new Date();
        return { ...row };
      },
      async findByHash(tokenHash) {
        const row = refreshTokens.find((t) => t.token_hash === tokenHash);
        return row && { ...row };
      },
      async setReplacedBy(id, replacedById) {
        refreshTokens.find((t) => t.id === id).replaced_by_id = replacedById;
      },
      async revokeFamily(familyId) {
        for (const t of refreshTokens) if (t.family_id === familyId && t.revoked_at === null) t.revoked_at = new Date();
      },
    },

    // Test-only access to stored rows.
    state: { users, refreshTokens },
  };
}

export function buildTestApp({
  config = buildTestConfig(),
  lifecycle = createLifecycle(),
  repositories = createInMemoryRepositories(),
  rateLimiter = createInMemoryRateLimiter(),
  cache = createCache(createInMemoryRedis()),
} = {}) {
  return createApp({ config, lifecycle, repositories, rateLimiter, cache });
}

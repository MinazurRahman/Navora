import { randomUUID } from 'node:crypto';
import { parseEnv } from '../../src/config/env.js';
import { createApp } from '../../src/app.js';
import { createLifecycle } from '../../src/shared/lifecycle.js';

export function buildTestConfig(overrides = {}) {
  return parseEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgres://test:test@localhost:5432/navora_unused',
    JWT_SECRET: 'test-only-jwt-secret-that-is-long-enough-123',
    ...overrides,
  });
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
} = {}) {
  return createApp({ config, lifecycle, repositories });
}

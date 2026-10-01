import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import knex from 'knex';
import { randomUUID } from 'node:crypto';
import { createUsersRepository } from '../../src/modules/users/users.repository.js';
import { createUsersService } from '../../src/modules/users/users.service.js';
import { createRefreshTokenRepository } from '../../src/modules/auth/refreshToken.repository.js';

// Runs only with TEST_DATABASE_URL (disposable PostGIS database; contents are wiped).
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('auth repositories against PostgreSQL', () => {
  let db;
  let users;
  let usersService;
  let refreshTokens;

  beforeAll(async () => {
    db = knex({ client: 'pg', connection: url, migrations: { directory: './migrations' } });
    await db.migrate.latest();
    users = createUsersRepository(db);
    usersService = createUsersService({ usersRepository: users });
    refreshTokens = createRefreshTokenRepository(db);
  });

  beforeEach(async () => {
    await db.raw('TRUNCATE users CASCADE');
  });

  afterAll(async () => {
    if (!db) return;
    await db.migrate.rollback(undefined, true);
    await db.destroy();
  });

  it('never returns password_hash from create or findById', async () => {
    const created = await users.create({ name: 'A', email: 'a@example.com', passwordHash: '$argon2id$x' });
    expect(created).not.toHaveProperty('password_hash');
    expect(await users.findById(created.id)).not.toHaveProperty('password_hash');
    expect((await users.findCredentialsByEmail('A@EXAMPLE.COM')).password_hash).toBe('$argon2id$x');
  });

  it('maps a case-insensitive duplicate email to EMAIL_ALREADY_REGISTERED', async () => {
    await usersService.createUser({ name: 'A', email: 'a@example.com', passwordHash: 'h' });
    await expect(usersService.createUser({ name: 'B', email: 'A@Example.com', passwordHash: 'h' })).rejects.toMatchObject({
      status: 409,
      code: 'EMAIL_ALREADY_REGISTERED',
    });
  });

  it('claims a refresh token exactly once, even concurrently', async () => {
    const user = await users.create({ name: 'A', email: 'a@example.com', passwordHash: 'h' });
    const tokenHash = 'a'.repeat(64);
    await refreshTokens.create({ userId: user.id, familyId: randomUUID(), tokenHash, expiresAt: new Date(Date.now() + 60_000) });

    const results = await Promise.all([refreshTokens.claim(tokenHash), refreshTokens.claim(tokenHash)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await refreshTokens.findByHash(tokenHash)).revoked_at).toBeInstanceOf(Date);
  });

  it('revokes every active token in a family', async () => {
    const user = await users.create({ name: 'A', email: 'a@example.com', passwordHash: 'h' });
    const familyId = randomUUID();
    const expiresAt = new Date(Date.now() + 60_000);
    await refreshTokens.create({ userId: user.id, familyId, tokenHash: 'b'.repeat(64), expiresAt });
    await refreshTokens.create({ userId: user.id, familyId, tokenHash: 'c'.repeat(64), expiresAt });

    await refreshTokens.revokeFamily(familyId);

    const rows = await db('refresh_tokens').where({ family_id: familyId });
    expect(rows.every((row) => row.revoked_at !== null)).toBe(true);
  });
});

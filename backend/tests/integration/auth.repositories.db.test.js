import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import knex from 'knex';
import { randomUUID } from 'node:crypto';
import { createUsersRepository } from '../../src/modules/users/users.repository.js';
import { createUsersService } from '../../src/modules/users/users.service.js';
import { createRefreshTokenRepository } from '../../src/modules/auth/refreshToken.repository.js';
import { createPasswordResetTokenRepository } from '../../src/modules/auth/passwordResetToken.repository.js';

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

  it('claims a reset token once, never after expiry, and deletes all tokens of a user', async () => {
    const resets = createPasswordResetTokenRepository(db);
    const user = await users.create({ name: 'A', email: 'a@example.com', passwordHash: 'h' });
    const soon = new Date(Date.now() + 60_000);
    await resets.create({ userId: user.id, tokenHash: 'live', expiresAt: soon });
    await resets.create({ userId: user.id, tokenHash: 'expired', expiresAt: new Date(Date.now() - 1000) });

    expect(await resets.claim('expired')).toBeUndefined();
    const [first, second] = await Promise.all([resets.claim('live'), resets.claim('live')]);
    expect([first, second].filter(Boolean)).toEqual([{ user_id: user.id }]);

    await resets.create({ userId: user.id, tokenHash: 'newer', expiresAt: soon });
    await resets.deleteForUser(user.id);
    expect(await resets.claim('newer')).toBeUndefined();
    expect((await db('password_reset_tokens').count({ n: '*' }))[0].n).toBe('0');
  });

  it('stores Google-only accounts, links a Google ID once, and requires a way to sign in', async () => {
    const googleOnly = await users.create({ name: 'G', email: 'g@example.com', passwordHash: null, googleSub: 'g-1' });
    expect(await users.findByGoogleSub('g-1')).toMatchObject({ id: googleOnly.id });
    expect(await users.findByGoogleSub('g-1')).not.toHaveProperty('google_sub');

    const withPassword = await users.create({ name: 'P', email: 'p@example.com', passwordHash: 'h' });
    expect(await users.linkGoogle(withPassword.id, 'g-2')).toMatchObject({ id: withPassword.id });
    expect(await users.linkGoogle(withPassword.id, 'g-3')).toBeUndefined(); // already linked
    await expect(users.create({ name: 'N', email: 'n@example.com', passwordHash: null })).rejects.toMatchObject({ code: '23514' });
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

  it("deletes only that user's expired tokens, keeping revoked-but-valid ones for reuse detection", async () => {
    const alice = await users.create({ name: 'A', email: 'a@example.com', passwordHash: 'h' });
    const bob = await users.create({ name: 'B', email: 'b@example.com', passwordHash: 'h' });
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 60_000);
    await refreshTokens.create({ userId: alice.id, familyId: randomUUID(), tokenHash: 'd'.repeat(64), expiresAt: past });
    await refreshTokens.create({ userId: alice.id, familyId: randomUUID(), tokenHash: 'e'.repeat(64), expiresAt: future });
    await refreshTokens.claim('e'.repeat(64)); // revoked, not expired
    await refreshTokens.create({ userId: bob.id, familyId: randomUUID(), tokenHash: 'f'.repeat(64), expiresAt: past });

    await refreshTokens.deleteExpiredForUser(alice.id);

    expect((await db('refresh_tokens').select('token_hash')).map((r) => r.token_hash).sort()).toEqual(['e'.repeat(64), 'f'.repeat(64)]);
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

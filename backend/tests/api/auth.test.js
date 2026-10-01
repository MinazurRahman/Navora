import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { buildTestApp, buildTestConfig, createInMemoryRepositories } from '../helpers/testApp.js';

const PASSWORD = 'correct horse battery staple';
const newUser = (overrides = {}) => ({ name: 'Ayesha Rahman', email: 'ayesha@example.com', password: PASSWORD, ...overrides });

let repositories;
let app;

beforeEach(() => {
  repositories = createInMemoryRepositories();
  app = buildTestApp({ repositories });
});

const register = (body = newUser()) => request(app).post('/api/v1/auth/register').send(body);
const login = (body) => request(app).post('/api/v1/auth/login').send(body);
const me = (token) => request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
const refresh = (refreshToken) => request(app).post('/api/v1/auth/refresh').send({ refreshToken });
const logout = (refreshToken) => request(app).post('/api/v1/auth/logout').send({ refreshToken });

function expectNoSecrets(res) {
  const body = JSON.stringify(res.body);
  expect(body).not.toContain('password');
  expect(body).not.toContain('$argon2');
  expect(body).not.toContain(PASSWORD);
}

describe('POST /api/v1/auth/register', () => {
  it('creates the account and returns the user with a session', async () => {
    const res = await register();

    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toEqual({
      id: expect.any(String),
      name: 'Ayesha Rahman',
      email: 'ayesha@example.com',
      role: 'user',
      profileImageUrl: null,
      createdAt: expect.any(String),
    });
    expect(res.body.data.tokens).toEqual({
      tokenType: 'Bearer',
      accessToken: expect.any(String),
      expiresIn: 900,
      refreshToken: expect.any(String),
      refreshTokenExpiresAt: expect.any(String),
    });
    expectNoSecrets(res);
  });

  it('stores an Argon2id hash, never the plaintext password', async () => {
    await register();
    const [stored] = repositories.state.users.values();

    expect(stored.password_hash).toMatch(/^\$argon2id\$/);
    expect(stored.password_hash).not.toContain(PASSWORD);
  });

  it('normalises the email (trim + lowercase)', async () => {
    const res = await register(newUser({ email: '  Ayesha@Example.COM ' }));
    expect(res.body.data.user.email).toBe('ayesha@example.com');
  });

  it('ignores a client-supplied role', async () => {
    const res = await register(newUser({ role: 'admin' }));
    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe('user');
  });

  it('returns 409 EMAIL_ALREADY_REGISTERED for a duplicate email, case-insensitively', async () => {
    await register();
    const res = await register(newUser({ email: 'AYESHA@example.com', name: 'Someone Else' }));

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ success: false, error: { code: 'EMAIL_ALREADY_REGISTERED' } });
  });

  it.each([
    ['missing fields', {}, ['name', 'email', 'password']],
    ['an invalid email', newUser({ email: 'not-an-email' }), ['email']],
    ['a short password', newUser({ password: 'short' }), ['password']],
    ['an over-long password', newUser({ password: 'x'.repeat(129) }), ['password']],
    ['a blank name', newUser({ name: '   ' }), ['name']],
  ])('returns 400 VALIDATION_ERROR for %s', async (_label, body, fields) => {
    const res = await register(body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d) => d.path)).toEqual(expect.arrayContaining(fields));
  });
});

describe('POST /api/v1/auth/login', () => {
  beforeEach(async () => {
    await register();
  });

  it('returns a session for valid credentials', async () => {
    const res = await login({ email: 'Ayesha@Example.com', password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe('ayesha@example.com');
    expect(res.body.data.tokens.accessToken).toEqual(expect.any(String));
    expectNoSecrets(res);
  });

  it('gives the same 401 for a wrong password and an unknown email', async () => {
    const wrongPassword = await login({ email: 'ayesha@example.com', password: 'wrong password' });
    const unknownEmail = await login({ email: 'nobody@example.com', password: PASSWORD });

    for (const res of [wrongPassword, unknownEmail]) {
      expect(res.status).toBe(401);
      expect(res.body.error).toMatchObject({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
    }
  });

  it('rejects a deactivated account with the same generic error', async () => {
    const [stored] = repositories.state.users.values();
    stored.is_active = false;

    const res = await login({ email: 'ayesha@example.com', password: PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns 400 for a malformed request', async () => {
    const res = await login({ email: 'ayesha@example.com' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/v1/auth/me', () => {
  it('returns the current user for a valid access token', async () => {
    const { body } = await register();
    const res = await me(body.data.tokens.accessToken);

    expect(res.status).toBe(200);
    expect(res.body.data.user).toEqual(body.data.user);
    expectNoSecrets(res);
  });

  it('returns 401 UNAUTHORIZED without a token', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 INVALID_TOKEN for a malformed Authorization header', async () => {
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', 'Token abc');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('returns 401 INVALID_TOKEN for a tampered token', async () => {
    const { body } = await register();
    const [header, payload, signature] = body.data.tokens.accessToken.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ ...jwt.decode(body.data.tokens.accessToken), role: 'admin' })).toString('base64url');

    const res = await me([header, forgedPayload, signature].join('.'));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
    expect(payload).not.toBe(forgedPayload);
  });

  it('returns 401 TOKEN_EXPIRED for an expired token', async () => {
    const { body } = await register();
    const config = buildTestConfig();
    const expired = jwt.sign({ role: 'user' }, config.auth.jwtSecret, {
      subject: body.data.user.id,
      issuer: config.auth.issuer,
      audience: config.auth.audience,
      expiresIn: -1,
    });

    const res = await me(expired);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('returns 401 once the account is deactivated', async () => {
    const { body } = await register();
    repositories.state.users.get(body.data.user.id).is_active = false;

    const res = await me(body.data.tokens.accessToken);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/auth/refresh', () => {
  it('rotates: returns a new session and the old refresh token stops working', async () => {
    const { body } = await register();
    const original = body.data.tokens.refreshToken;

    const rotated = await refresh(original);
    expect(rotated.status).toBe(200);
    expect(rotated.body.data.tokens.refreshToken).not.toBe(original);
    expect((await me(rotated.body.data.tokens.accessToken)).status).toBe(200);

    const replay = await refresh(original);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('revokes the whole session when a used refresh token is replayed', async () => {
    const { body } = await register();
    const stolen = body.data.tokens.refreshToken;
    const legitimate = (await refresh(stolen)).body.data.tokens.refreshToken;

    await refresh(stolen); // attacker replays the old token
    const res = await refresh(legitimate);

    expect(res.status).toBe(401);
  });

  it('rejects unknown and expired refresh tokens', async () => {
    expect((await refresh('made-up-token')).status).toBe(401);

    const { body } = await register();
    for (const token of repositories.state.refreshTokens) token.expires_at = new Date(Date.now() - 1000);
    expect((await refresh(body.data.tokens.refreshToken)).status).toBe(401);
  });

  it('does not issue tokens for a deactivated account', async () => {
    const { body } = await register();
    repositories.state.users.get(body.data.user.id).is_active = false;

    expect((await refresh(body.data.tokens.refreshToken)).status).toBe(401);
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('revokes the session so its refresh token can no longer be used', async () => {
    const { body } = await register();

    const res = await logout(body.data.tokens.refreshToken);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { loggedOut: true } });

    expect((await refresh(body.data.tokens.refreshToken)).status).toBe(401);
  });

  it('only ends that session; other logins stay valid', async () => {
    const first = (await register()).body.data.tokens.refreshToken;
    const second = (await login({ email: 'ayesha@example.com', password: PASSWORD })).body.data.tokens.refreshToken;

    await logout(first);
    expect((await refresh(second)).status).toBe(200);
  });

  it('succeeds for an unknown token, so it cannot be used to probe tokens', async () => {
    const res = await logout('unknown-token');
    expect(res.status).toBe(200);
  });

  it('requires a refresh token in the body', async () => {
    const res = await request(app).post('/api/v1/auth/logout').send({});
    expect(res.status).toBe(400);
  });
});

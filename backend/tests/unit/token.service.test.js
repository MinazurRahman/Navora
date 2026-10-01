import { describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { createTokenService, generateRefreshToken, hashRefreshToken } from '../../src/modules/auth/token.service.js';

const options = { jwtSecret: 's'.repeat(40), accessTokenTtlSeconds: 900, issuer: 'navora-api', audience: 'navora-app' };
const tokens = createTokenService(options);
const user = { id: '0b6b7c1e-2f4a-4c55-9d8e-3a1f2b4c5d6e', role: 'user' };

function decode(token) {
  return jwt.decode(token);
}

describe('access tokens', () => {
  it('signs a 15-minute HS256 token carrying only id and role', () => {
    const token = tokens.signAccessToken({ ...user, email: 'x@example.com', password_hash: 'h' });
    const payload = decode(token);

    expect(jwt.decode(token, { complete: true }).header.alg).toBe('HS256');
    expect(payload).toMatchObject({ sub: user.id, role: 'user', iss: 'navora-api', aud: 'navora-app' });
    expect(payload.exp - payload.iat).toBe(900);
    expect(payload.jti).toBeDefined();
    expect(payload).not.toHaveProperty('email');
    expect(payload).not.toHaveProperty('password_hash');
  });

  it('verifies its own tokens', () => {
    expect(tokens.verifyAccessToken(tokens.signAccessToken(user))).toEqual(user);
  });

  it('rejects expired tokens with TOKEN_EXPIRED', () => {
    const expired = jwt.sign({ role: 'user' }, options.jwtSecret, {
      subject: user.id,
      issuer: options.issuer,
      audience: options.audience,
      expiresIn: -10,
    });
    expect(() => tokens.verifyAccessToken(expired)).toThrow(expect.objectContaining({ code: 'TOKEN_EXPIRED', status: 401 }));
  });

  it.each([
    ['a different secret', () => jwt.sign({ role: 'user' }, 'x'.repeat(40), { subject: user.id, issuer: 'navora-api', audience: 'navora-app' })],
    ['the wrong audience', () => jwt.sign({ role: 'user' }, options.jwtSecret, { subject: user.id, issuer: 'navora-api', audience: 'other' })],
    ['the wrong issuer', () => jwt.sign({ role: 'user' }, options.jwtSecret, { subject: user.id, issuer: 'evil', audience: 'navora-app' })],
    ['alg "none"', () => jwt.sign({ role: 'admin' }, null, { algorithm: 'none', subject: user.id, issuer: 'navora-api', audience: 'navora-app' })],
    ['an unknown role', () => jwt.sign({ role: 'superuser' }, options.jwtSecret, { subject: user.id, issuer: 'navora-api', audience: 'navora-app' })],
    ['a non-UUID subject', () => jwt.sign({ role: 'user' }, options.jwtSecret, { subject: '1 OR 1=1', issuer: 'navora-api', audience: 'navora-app' })],
    ['garbage', () => 'not.a.jwt'],
  ])('rejects a token with %s as INVALID_TOKEN', (_label, makeToken) => {
    expect(() => tokens.verifyAccessToken(makeToken())).toThrow(expect.objectContaining({ code: 'INVALID_TOKEN', status: 401 }));
  });
});

describe('refresh tokens', () => {
  it('generates unguessable tokens and stores only a SHA-256 hash', () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();

    expect(a.token).not.toBe(b.token);
    expect(a.token.length).toBeGreaterThanOrEqual(43); // 32 random bytes, base64url
    expect(a.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.tokenHash).not.toContain(a.token);
    expect(hashRefreshToken(a.token)).toBe(a.tokenHash);
  });
});

import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { createGoogleVerifier, createGoogleVerifierFromConfig, GOOGLE_CERTS_URL } from '../../src/integrations/google/index.js';

const CLIENT_ID = 'navora-test.apps.googleusercontent.com';
const keyPair = (kid) => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { kid, privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' } };
};
const k1 = keyPair('k1');
const k2 = keyPair('k2');

const sign = (claims = {}, key = k1, options = {}) =>
  jwt.sign({ email: 'ayesha@example.com', email_verified: true, name: 'Ayesha', ...claims }, key.privateKey, {
    algorithm: 'RS256', keyid: key.kid, audience: CLIENT_ID, issuer: 'https://accounts.google.com', subject: 'g-123', expiresIn: 300, ...options,
  });

function fakeFetch(keySets) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    const keys = keySets[Math.min(calls.length - 1, keySets.length - 1)];
    if (keys === 'down') throw new Error('ECONNREFUSED');
    return { ok: true, status: 200, headers: new Headers({ 'cache-control': 'public, max-age=3600' }), json: async () => ({ keys: keys.map((k) => k.jwk) }) };
  };
  return { impl, calls };
}

describe('Google ID token verifier', () => {
  it('accepts a valid token and caches the keys', async () => {
    const f = fakeFetch([[k1]]);
    const verifier = createGoogleVerifier({ clientId: CLIENT_ID, fetchImpl: f.impl });
    expect(await verifier.verify(sign())).toEqual({ sub: 'g-123', email: 'ayesha@example.com', name: 'Ayesha' });
    await verifier.verify(sign());
    expect(f.calls).toEqual([GOOGLE_CERTS_URL]);
  });

  it.each([
    ['another app', sign({}, k1, { audience: 'someone-else.apps.googleusercontent.com' })],
    ['another issuer', sign({}, k1, { issuer: 'https://evil.example' })],
    ['an expired token', sign({}, k1, { expiresIn: -10 })],
    ['an unverified email', sign({ email_verified: false })],
    ['a forged signature', sign({}, keyPair('k1'))],
    ['garbage', 'not.a.jwt'],
  ])('rejects %s as INVALID', async (_, token) => {
    const verifier = createGoogleVerifier({ clientId: CLIENT_ID, fetchImpl: fakeFetch([[k1]]).impl });
    await expect(verifier.verify(token)).rejects.toMatchObject({ kind: 'INVALID' });
  });

  it('refetches once for a newly rotated key', async () => {
    const f = fakeFetch([[k1], [k1, k2]]);
    const verifier = createGoogleVerifier({ clientId: CLIENT_ID, fetchImpl: f.impl });
    await verifier.verify(sign());
    expect((await verifier.verify(sign({}, k2))).sub).toBe('g-123');
    expect(f.calls).toHaveLength(2);
  });

  it('reports UNAVAILABLE when the keys cannot be fetched', async () => {
    const verifier = createGoogleVerifier({ clientId: CLIENT_ID, fetchImpl: fakeFetch(['down']).impl });
    await expect(verifier.verify(sign())).rejects.toMatchObject({ kind: 'UNAVAILABLE' });
  });

  it('is off without a client ID', () => {
    expect(createGoogleVerifierFromConfig({ google: { clientId: null } }).enabled).toBe(false);
  });
});

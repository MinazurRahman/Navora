import { createPublicKey } from 'node:crypto';
import jwt from 'jsonwebtoken';

// Verifies the ID token that Google's sign-in button gives the browser ("credential").
// Only Google's public keys are fetched; no user data is sent anywhere. The rest of the app
// sees verify(credential) -> { sub, email, name } or a GoogleTokenError.

export const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
// Google rotates keys every few days and announces them early; an hour is safe.
const DEFAULT_KEYS_MAX_AGE_MS = 60 * 60 * 1000;

export class GoogleTokenError extends Error {
  // kind: INVALID (bad, expired or foreign token) | UNAVAILABLE (keys could not be fetched)
  constructor(kind, message) {
    super(message);
    this.name = 'GoogleTokenError';
    this.kind = kind;
  }
}

function maxAgeMs(cacheControl) {
  const seconds = Number(/max-age=(\d+)/.exec(cacheControl ?? '')?.[1]);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 24 * 60 * 60 * 1000) : DEFAULT_KEYS_MAX_AGE_MS;
}

export function createGoogleVerifier({ clientId, fetchImpl = fetch, timeoutMs = 5000, now = () => Date.now() }) {
  // Google's public keys, shared by every request on this instance: a cache of public
  // data, not per-user state.
  let keys = null;
  let expiresAt = 0;

  async function loadKeys() {
    let res;
    try {
      res = await fetchImpl(GOOGLE_CERTS_URL, { signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new GoogleTokenError('UNAVAILABLE', 'Google keys could not be fetched');
    }
    if (!res.ok) throw new GoogleTokenError('UNAVAILABLE', `Google keys request failed (${res.status})`);
    const body = await res.json();
    keys = new Map((body.keys ?? []).filter((k) => k.kty === 'RSA' && k.kid).map((k) => [k.kid, createPublicKey({ key: k, format: 'jwk' })]));
    expiresAt = now() + maxAgeMs(res.headers.get('cache-control'));
  }

  async function keyFor(kid) {
    if (!keys || now() >= expiresAt) await loadKeys();
    // An unknown key ID may be a key Google rotated in since the last fetch: refresh once.
    if (!keys.has(kid)) await loadKeys();
    const key = keys.get(kid);
    if (!key) throw new GoogleTokenError('INVALID', 'Token signed with an unknown key');
    return key;
  }

  return {
    enabled: true,

    async verify(credential) {
      const kid = jwt.decode(credential, { complete: true })?.header?.kid;
      if (!kid) throw new GoogleTokenError('INVALID', 'Malformed Google token');
      const key = await keyFor(kid);

      let payload;
      try {
        payload = jwt.verify(credential, key, { algorithms: ['RS256'], audience: clientId, issuer: ISSUERS });
      } catch (err) {
        throw new GoogleTokenError('INVALID', `Google token rejected: ${err.message}`);
      }
      // Only a verified address may be matched to an existing NAVORA account.
      if (!payload.sub || !payload.email || payload.email_verified !== true) {
        throw new GoogleTokenError('INVALID', 'Google account has no verified email');
      }
      return { sub: payload.sub, email: payload.email.toLowerCase(), name: payload.name || payload.email.split('@')[0] };
    },
  };
}

// Off unless GOOGLE_CLIENT_ID is set: the app and CI run without Google.
export function createGoogleVerifierFromConfig(config) {
  if (!config.google.clientId) return { enabled: false };
  return createGoogleVerifier({ clientId: config.google.clientId });
}

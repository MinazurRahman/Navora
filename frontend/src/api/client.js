import { clearSession, getSession, setSession } from './session.js';

// Base URL of the versioned API, e.g. http://localhost:3000/api/v1 (see .env.example).
const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

// Every failed request becomes an ApiError. Branch on `code` (stable, from the backend),
// never on `message`. Client-side failures use their own codes: NETWORK_ERROR (status 0),
// INVALID_RESPONSE (a non-JSON or malformed body, e.g. from a proxy).
export class ApiError extends Error {
  constructor({ status, code, message, details, requestId, retryAfter }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
    this.retryAfter = retryAfter; // seconds, from Retry-After on 429
  }
}

// Query values: undefined, null and '' are left out; arrays are comma-separated (the
// backend's convention, e.g. category=museum,park).
export function buildUrl(path, query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length) params.set(key, value.join(','));
    } else {
      params.set(key, String(value));
    }
  }
  const search = params.toString();
  return `${BASE_URL}${path}${search ? `?${search}` : ''}`;
}

async function send(path, { method = 'GET', query, body, signal, token }) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error; // cancelled on purpose: let callers ignore it
    throw new ApiError({ status: 0, code: 'NETWORK_ERROR', message: 'Could not reach the server' });
  }

  const requestId = response.headers.get('X-Request-Id') ?? undefined;
  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }

  if (response.ok && payload?.success === true) {
    return { data: payload.data, meta: payload.meta };
  }

  const error = payload?.error;
  throw new ApiError({
    status: response.status,
    code: error?.code ?? 'INVALID_RESPONSE',
    message: error?.message ?? `Unexpected response (HTTP ${response.status})`,
    details: error?.details,
    requestId: error?.requestId ?? requestId,
    retryAfter: Number(response.headers.get('Retry-After')) || undefined,
  });
}

// One refresh at a time: every request that hits TOKEN_EXPIRED while a refresh is running
// waits for the same one. Refresh tokens are single use; sending one twice ends the session.
let refreshing = null;

function refreshSession() {
  refreshing ??= (async () => {
    const session = getSession();
    if (!session) throw new ApiError({ status: 401, code: 'UNAUTHORIZED', message: 'Not signed in' });
    try {
      const { data } = await send('/auth/refresh', {
        method: 'POST',
        body: { refreshToken: session.refreshToken },
      });
      setSession({ accessToken: data.tokens.accessToken, refreshToken: data.tokens.refreshToken, user: data.user });
    } catch (error) {
      // A rejected refresh token means the session is over. Network or rate-limit failures
      // keep it: the request fails, but the user is not signed out by a blip.
      if (error.status === 401 || error.status === 400) clearSession();
      throw error;
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

// Codes that mean the stored session is no longer usable.
const SESSION_ENDED = new Set(['INVALID_TOKEN', 'UNAUTHORIZED']);

// The only function that talks to the API. Resolves to { data, meta }.
// A request rejected with 401 TOKEN_EXPIRED is retried once after a refresh. That is safe
// even for POST: the backend checks the token before running anything.
export async function request(path, options = {}) {
  const token = getSession()?.accessToken;
  try {
    return await send(path, { ...options, token });
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401 || !token) throw error;
    if (error.code === 'TOKEN_EXPIRED') {
      await refreshSession();
      return send(path, { ...options, token: getSession()?.accessToken });
    }
    if (SESSION_ENDED.has(error.code)) clearSession();
    throw error;
  }
}

// Ends the session on the server (revokes the refresh token) and locally. Local sign-out
// happens even if the server cannot be reached; the access token expires within 15 minutes.
export async function logout() {
  const session = getSession();
  clearSession();
  if (!session) return;
  try {
    await send('/auth/logout', { method: 'POST', body: { refreshToken: session.refreshToken } });
  } catch {
    // Best effort.
  }
}

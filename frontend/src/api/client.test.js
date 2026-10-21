import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fail, mockFetch, ok, sessionData, user } from '../test/fetchMock.js';
import { ApiError, buildUrl, logout, request } from './client.js';
import { clearSession, getSession, setSession } from './session.js';

const signedIn = () => setSession({ accessToken: 'access-1', refreshToken: 'refresh-1', user });
const bearer = (init) => init.headers.Authorization;

beforeEach(() => clearSession());
afterEach(() => vi.unstubAllGlobals());

describe('buildUrl', () => {
  it('drops empty values and joins arrays with commas', () => {
    const url = buildUrl('/places', { category: ['museum', 'park'], minRating: 4, q: '', page: undefined, x: null, tags: [] });
    expect(url.endsWith('/places?category=museum%2Cpark&minRating=4')).toBe(true);
  });
});

describe('request', () => {
  it('resolves to data and meta from the success envelope', async () => {
    mockFetch(() => ok([{ id: 'p1' }], { page: 1, limit: 20, total: 1, totalPages: 1 }));
    const result = await request('/places');
    expect(result).toEqual({ data: [{ id: 'p1' }], meta: { page: 1, limit: 20, total: 1, totalPages: 1 } });
  });

  it('turns an error envelope into an ApiError with code, details, request id and Retry-After', async () => {
    mockFetch(() => ({ ...fail(429, 'RATE_LIMITED'), headers: { 'Retry-After': '42' } }));
    const error = await request('/places').catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 429, code: 'RATE_LIMITED', requestId: 'req-1', retryAfter: 42 });
  });

  it('reports a non-JSON response as INVALID_RESPONSE', async () => {
    mockFetch(() => ({ status: 502, body: '<html>Bad gateway</html>', headers: { 'X-Request-Id': 'proxy-1' } }));
    await expect(request('/places')).rejects.toMatchObject({ status: 502, code: 'INVALID_RESPONSE', requestId: 'proxy-1' });
  });

  it('reports a failed connection as NETWORK_ERROR', async () => {
    mockFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    await expect(request('/places')).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  });

  it('sends the access token only when signed in', async () => {
    const fetchMock = mockFetch(() => ok({}));
    await request('/categories');
    signedIn();
    await request('/trips');
    expect(bearer(fetchMock.mock.calls[0][1])).toBeUndefined();
    expect(bearer(fetchMock.mock.calls[1][1])).toBe('Bearer access-1');
  });
});

describe('token refresh', () => {
  it('refreshes once for concurrent expired requests, retries them and stores the new tokens', async () => {
    signedIn();
    let refreshCalls = 0;
    mockFetch((path, init) => {
      if (path.endsWith('/auth/refresh')) {
        refreshCalls += 1;
        expect(init.body).toEqual({ refreshToken: 'refresh-1' });
        return ok(sessionData('access-2', 'refresh-2'));
      }
      return bearer(init) === 'Bearer access-2' ? ok({ path }) : fail(401, 'TOKEN_EXPIRED');
    });

    const results = await Promise.all([request('/trips'), request('/itineraries'), request('/places/mine')]);
    expect(results.map((r) => r.data.path)).toEqual(['/trips', '/itineraries', '/places/mine']);
    expect(refreshCalls).toBe(1);
    expect(getSession()).toMatchObject({ accessToken: 'access-2', refreshToken: 'refresh-2' });
  });

  it('retries a POST once after refreshing (the expired request never reached the handler)', async () => {
    signedIn();
    const posts = [];
    mockFetch((path, init) => {
      if (path.endsWith('/auth/refresh')) return ok(sessionData());
      posts.push(bearer(init));
      return bearer(init) === 'Bearer access-2' ? ok({ id: 't1' }) : fail(401, 'TOKEN_EXPIRED');
    });
    await request('/trips', { method: 'POST', body: { title: 'x' } });
    expect(posts).toEqual(['Bearer access-1', 'Bearer access-2']);
  });

  it('ends the session when the refresh token is rejected', async () => {
    signedIn();
    mockFetch((path) => (path.endsWith('/auth/refresh') ? fail(401, 'INVALID_REFRESH_TOKEN') : fail(401, 'TOKEN_EXPIRED')));
    await expect(request('/trips')).rejects.toMatchObject({ code: 'INVALID_REFRESH_TOKEN' });
    expect(getSession()).toBeNull();
  });

  it('keeps the session when the refresh fails for a temporary reason', async () => {
    signedIn();
    mockFetch((path) => {
      if (path.endsWith('/auth/refresh')) throw new TypeError('offline');
      return fail(401, 'TOKEN_EXPIRED');
    });
    await expect(request('/trips')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(getSession()).not.toBeNull();
  });

  it('does not loop when the retried request is rejected again', async () => {
    signedIn();
    const fetchMock = mockFetch((path) => (path.endsWith('/auth/refresh') ? ok(sessionData()) : fail(401, 'TOKEN_EXPIRED')));
    await expect(request('/trips')).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
    expect(fetchMock).toHaveBeenCalledTimes(3); // request, refresh, one retry
  });

  it('ends the session on an invalid token', async () => {
    signedIn();
    mockFetch(() => fail(401, 'INVALID_TOKEN'));
    await expect(request('/trips')).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    expect(getSession()).toBeNull();
  });

  it('leaves auth alone for a 401 on a request sent without a token (wrong password)', async () => {
    const fetchMock = mockFetch(() => fail(401, 'INVALID_CREDENTIALS'));
    await expect(request('/auth/login', { method: 'POST', body: {} })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('logout', () => {
  it('clears the session locally and revokes the refresh token on the server', async () => {
    signedIn();
    const fetchMock = mockFetch(() => ok({ loggedOut: true }));
    await logout();
    expect(getSession()).toBeNull();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url.endsWith('/auth/logout')).toBe(true);
    expect(JSON.parse(init.body)).toEqual({ refreshToken: 'refresh-1' });
  });

  it('still signs out locally when the server cannot be reached', async () => {
    signedIn();
    mockFetch(() => {
      throw new TypeError('offline');
    });
    await logout();
    expect(getSession()).toBeNull();
  });
});

import { vi } from 'vitest';

// Replaces fetch with `handler(path, { method, headers, body })`, which returns
// { status = 200, body, headers } or throws to simulate a network failure. `path` is the
// URL without the API base URL; `body` is the parsed JSON request body.
export function mockFetch(handler) {
  const fetchMock = vi.fn(async (url, init = {}) => {
    const { pathname, search } = new URL(url, 'http://localhost');
    const result = await handler(pathname + search, {
      method: init.method ?? 'GET',
      headers: init.headers ?? {},
      body: init.body ? JSON.parse(init.body) : undefined,
    });
    const { status = 200, body, headers = {} } = result;
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export const ok = (data, meta) => ({ body: meta ? { success: true, data, meta } : { success: true, data } });

export const fail = (status, code, extra = {}) => ({
  status,
  body: { success: false, error: { code, message: `${code} message`, requestId: 'req-1', ...extra } },
});

export const user = { id: 'u1', name: 'Ayesha Rahman', email: 'ayesha@example.com', role: 'user' };

export function sessionData(accessToken = 'access-2', refreshToken = 'refresh-2', who = user) {
  return { user: who, tokens: { tokenType: 'Bearer', accessToken, expiresIn: 900, refreshToken } };
}

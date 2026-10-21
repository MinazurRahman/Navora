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

// A Place as returned by the API (openapi.yaml Place schema).
export function place(overrides = {}) {
  return {
    id: 'p1',
    name: 'Lalbagh Fort',
    description: 'Mughal fort complex from the 17th century',
    category: { slug: 'historical_site', name: 'Historical Site' },
    location: { latitude: 23.7189, longitude: 90.3882 },
    address: 'Lalbagh Road',
    city: 'Dhaka',
    entryFee: 20,
    currency: 'BDT',
    typicalVisitMinutes: 90,
    tags: ['history'],
    openingHours: [],
    facilities: { parking: 'YES', petFriendly: 'NO', wheelchairAccessible: 'UNKNOWN', accessibilityNotes: null, restrictions: null, verifiedAt: null },
    rating: { average: 4.5, count: 12 },
    status: 'APPROVED',
    createdBy: null,
    createdAt: '2026-10-01T08:24:19.955Z',
    updatedAt: '2026-10-01T08:24:19.955Z',
    ...overrides,
  };
}

export const page = (items) => ok(items, { page: 1, limit: 20, total: items.length, totalPages: 1 });

// A fake NAVORA API for browser tests, answering with the shapes in backend/docs/openapi.yaml.
// Map tiles are blocked so tests never depend on the network.

export const user = { id: 'u1', name: 'Ayesha Rahman', email: 'ayesha@example.com', role: 'user', profileImageUrl: null, createdAt: '2026-10-01T08:00:00Z' };

export function place(overrides = {}) {
  return {
    id: 'p1',
    name: 'Lalbagh Fort',
    description: 'Mughal fort complex from the 17th century.',
    category: { slug: 'historical_site', name: 'Historical Site' },
    location: { latitude: 23.7189, longitude: 90.3882 },
    address: 'Lalbagh Road',
    city: 'Dhaka',
    entryFee: null,
    currency: 'BDT',
    typicalVisitMinutes: 90,
    tags: ['history'],
    openingHours: [],
    facilities: { parking: 'YES', petFriendly: 'UNKNOWN', wheelchairAccessible: 'UNKNOWN', accessibilityNotes: null, restrictions: null, verifiedAt: null },
    images: [],
    rating: { average: null, count: 0 },
    status: 'APPROVED',
    createdBy: null,
    createdAt: '2026-10-01T08:00:00Z',
    updatedAt: '2026-10-01T08:00:00Z',
    ...overrides,
  };
}

const PLACES = [
  place(),
  place({ id: 'p2', name: 'Ahsan Manzil', category: { slug: 'museum', name: 'Museum' }, location: { latitude: 23.7086, longitude: 90.4061 } }),
  place({ id: 'p3', name: 'Armenian Church of the Holy Resurrection', category: { slug: 'religious_site', name: 'Religious Site' } }),
];

const ok = (data, meta) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(meta ? { success: true, data, meta } : { success: true, data }) });
const pageOf = (items) => ok(items, { page: 1, limit: 20, total: items.length, totalPages: 1 });

// signedIn: starts the page with a stored session that /auth/me accepts.
export async function useFakeApi(page, { signedIn = false } = {}) {
  await page.route(/tile\.openstreetmap\.org/, (route) => route.abort());
  if (signedIn) {
    await page.addInitScript((session) => sessionStorage.setItem('navora.session', session), JSON.stringify({ accessToken: 'a', refreshToken: 'r', user }));
  }
  await page.route('http://api.test/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    if (path === '/auth/me') return route.fulfill(ok({ user }));
    if (path === '/categories') return route.fulfill(ok([{ slug: 'historical_site', name: 'Historical Site', description: null }, { slug: 'museum', name: 'Museum', description: null }]));
    if (path === '/tags') return route.fulfill(ok([{ slug: 'history', name: 'History' }]));
    if (path === '/places/search') {
      const q = url.searchParams.get('q')?.toLowerCase() ?? '';
      return route.fulfill(pageOf(PLACES.filter((p) => p.name.toLowerCase().includes(q))));
    }
    if (path === '/places' || path === '/places/nearby' || path === '/places/mine') return route.fulfill(pageOf(PLACES));
    const placeMatch = path.match(/^\/places\/([^/]+)$/);
    if (placeMatch) return route.fulfill(ok(PLACES.find((p) => p.id === placeMatch[1]) ?? PLACES[0]));
    if (/^\/places\/[^/]+\/reviews$/.test(path)) return route.fulfill(ok([], { page: 1, limit: 10, total: 0, totalPages: 0 }));
    if (/^\/places\/[^/]+\/reviews\/mine$/.test(path)) return route.fulfill(ok(null));
    if (path.startsWith('/saved-places/')) return route.fulfill(ok({ placeId: 'p1', saved: false }));
    if (path === '/saved-places' || path === '/trips') return route.fulfill(pageOf([]));
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'Not found', requestId: 'e2e' } }) });
  });
}

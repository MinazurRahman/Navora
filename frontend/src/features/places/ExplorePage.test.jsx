import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { AuthProvider } from '../auth/AuthProvider.jsx';
import { createQueryClient } from '../../lib/queryClient.js';
import { routes } from '../../routes.jsx';
import { fail, mockFetch, ok, place } from '../../test/fetchMock.js';

// Stand-in for the Leaflet map: one button per marker, plus "Search this area".
vi.mock('./PlacesMap.jsx', () => ({
  default: ({ places, selectedId, onSelect, onSearchArea }) => (
    <div>
      <p>Selected on map: {selectedId ?? 'none'}</p>
      {places.map((p) => (
        <button key={p.id} type="button" onClick={() => onSelect(p.id)}>
          Marker {p.name}
        </button>
      ))}
      <button type="button" onClick={() => onSearchArea({ latitude: 23.7, longitude: 90.4 })}>
        Search this area
      </button>
    </div>
  ),
}));

const CATEGORIES = [
  { slug: 'museum', name: 'Museum', description: null },
  { slug: 'park', name: 'Park', description: null },
];
const PLACES = [place(), place({ id: 'p2', name: 'Ramna Park', category: { slug: 'park', name: 'Park' } })];
const pageOf = (items, meta = {}) => ok(items, { page: 1, limit: 20, total: items.length, totalPages: 1, ...meta });

let requests;
function serve(handler = () => pageOf(PLACES)) {
  requests = [];
  return mockFetch((path, init) => {
    if (path.endsWith('/categories')) return ok(CATEGORIES);
    requests.push(path);
    return handler(path, init);
  });
}

function renderExplore(url = '/explore') {
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return router;
}

const lastRequest = () => requests.at(-1);

beforeEach(() => serve());
afterEach(() => vi.unstubAllGlobals());

describe('explore', () => {
  it('reads filters from the URL and lists the matching places', async () => {
    renderExplore('/explore?category=museum&minRating=4');
    expect(await screen.findByRole('link', { name: 'Lalbagh Fort' })).toBeDefined();
    expect(lastRequest()).toMatch(/\/places\?/);
    expect(lastRequest()).toContain('category=museum');
    expect(lastRequest()).toContain('minRating=4');
    expect((await screen.findByLabelText('Museum')).checked).toBe(true);
    expect(screen.getByText('2 places')).toBeDefined();
  });

  it('searches as you type, after a pause', async () => {
    const router = renderExplore();
    await screen.findByRole('link', { name: 'Lalbagh Fort' });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search places' }), 'fort');
    await vi.waitFor(() => expect(lastRequest()).toContain('/places/search?q=fort'));
    expect(router.state.location.search).toBe('?q=fort');
  });

  it('updates the URL and request when a filter changes, and explains empty results', async () => {
    serve((path) => (path.includes('maxEntryFee=0') ? pageOf([]) : pageOf(PLACES)));
    const router = renderExplore();
    await screen.findByRole('link', { name: 'Lalbagh Fort' });
    await userEvent.selectOptions(screen.getByLabelText(/^Entry fee/), 'Free entry only');
    expect(await screen.findByRole('heading', { name: 'No places match' })).toBeDefined();
    expect(router.state.location.search).toBe('?maxEntryFee=0');
    expect(screen.getByText(/places with an unknown entry fee are not included/)).toBeDefined();
    await userEvent.click(screen.getAllByRole('button', { name: 'Clear filters' }).at(-1));
    expect(await screen.findByRole('link', { name: 'Lalbagh Fort' })).toBeDefined();
    expect(router.state.location.search).toBe('');
  });

  it('finds places near the user and shows distances', async () => {
    serve((path) => (path.includes('/places/nearby') ? pageOf([place({ distanceMeters: 1250 })]) : pageOf(PLACES)));
    vi.stubGlobal('navigator', {
      ...navigator,
      geolocation: { getCurrentPosition: (success) => success({ coords: { latitude: 23.81234, longitude: 90.41256 } }) },
    });
    const router = renderExplore();
    await screen.findAllByRole('link', { name: 'Lalbagh Fort' });
    await userEvent.click(screen.getByRole('button', { name: 'Near me' }));
    expect(await screen.findByText('1.3 km away')).toBeDefined();
    // Sent rounded to ~110 m, like the URL.
    expect(lastRequest()).toContain('latitude=23.812&longitude=90.413&radiusKm=5');
    expect(router.state.location.search).toBe('?lat=23.812&lng=90.413');
    await userEvent.click(screen.getByRole('button', { name: 'Clear location' }));
    expect(router.state.location.search).toBe('');
  });

  it('explains when location access is denied', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      geolocation: { getCurrentPosition: (_success, error) => error({ code: 1, PERMISSION_DENIED: 1 }) },
    });
    renderExplore();
    await userEvent.click(await screen.findByRole('button', { name: 'Near me' }));
    expect(await screen.findByText(/Location access was denied/)).toBeDefined();
  });

  it('keeps list and map selection in sync', async () => {
    renderExplore();
    await screen.findByRole('link', { name: 'Lalbagh Fort' });
    const fortCard = screen.getByRole('link', { name: 'Lalbagh Fort' }).closest('article');
    await userEvent.click(within(fortCard).getByRole('button', { name: 'Show on map' }));
    expect(screen.getByText('Selected on map: p1')).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'Marker Ramna Park' }));
    expect(screen.getByText('Selected on map: p2')).toBeDefined();
  });

  it('searches the visible map area', async () => {
    const router = renderExplore('/explore?q=fort');
    await screen.findByRole('link', { name: 'Lalbagh Fort' });
    await userEvent.click(screen.getByRole('button', { name: 'Search this area' }));
    expect(router.state.location.search).toBe('?lat=23.7&lng=90.4');
    await vi.waitFor(() => expect(lastRequest()).toContain('/places/nearby?'));
  });

  it('pages through results', async () => {
    serve((path) =>
      path.includes('page=2')
        ? pageOf([place({ id: 'p9', name: 'Page Two Place' })], { page: 2, total: 21, totalPages: 2 })
        : pageOf(PLACES, { total: 21, totalPages: 2 }),
    );
    renderExplore();
    await screen.findByRole('link', { name: 'Lalbagh Fort' });
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('link', { name: 'Page Two Place' })).toBeDefined();
    expect(screen.getByText('Page 2 of 2')).toBeDefined();
  });

  it('offers a retry when loading fails', async () => {
    let calls = 0;
    serve(() => (++calls <= 2 ? fail(500, 'INTERNAL_ERROR') : pageOf(PLACES)));
    renderExplore();
    // A 500 is retried once automatically (after about a second) before the error shows.
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }, { timeout: 4000 }));
    expect(await screen.findByRole('link', { name: 'Lalbagh Fort' })).toBeDefined();
  });
});

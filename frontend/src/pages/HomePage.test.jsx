import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { AuthProvider } from '../features/auth/AuthProvider.jsx';
import { createQueryClient } from '../lib/queryClient.js';
import { routes } from '../routes.jsx';
import { fail, mockFetch, ok, page, place } from '../test/fetchMock.js';

const CATEGORIES = [
  { slug: 'museum', name: 'Museum', description: null },
  { slug: 'park', name: 'Park', description: null },
];

function renderHome() {
  const router = createMemoryRouter(routes, { initialEntries: ['/'] });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return router;
}

afterEach(() => vi.unstubAllGlobals());

describe('home page', () => {
  it('shows real places with honest unknown values', async () => {
    mockFetch((path) => {
      if (path.endsWith('/categories')) return ok(CATEGORIES);
      if (path.includes('minRating=4')) return page([place({ id: 'r1', name: 'Ahsan Manzil' })]);
      return page([
        place(),
        place({ id: 'p2', name: 'Hidden Tea Stall', entryFee: null, rating: { average: null, count: 0 }, description: null }),
      ]);
    });
    renderHome();

    const recent = await screen.findByRole('region', { name: 'Recently added' });
    const unknown = (await within(recent).findByRole('link', { name: 'Hidden Tea Stall' })).closest('article');
    expect(within(unknown).getByText('Entry fee unknown')).toBeDefined();
    expect(within(unknown).getByText('No reviews yet')).toBeDefined();
    expect(within(recent).getByText('4.5 (12 reviews)')).toBeDefined();
    expect(within(recent).getByRole('link', { name: 'Lalbagh Fort' }).getAttribute('href')).toBe('/places/p1');

    const rated = screen.getByRole('region', { name: 'Rated 4 stars and above' });
    expect(await within(rated).findByRole('link', { name: 'Ahsan Manzil' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Museum' }).getAttribute('href')).toBe('/explore?category=museum');
  });

  it('sends the search to Explore', async () => {
    mockFetch((path) => (path.endsWith('/categories') ? ok(CATEGORIES) : page([])));
    const router = renderHome();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search places' }), '  lalbagh fort ');
    await userEvent.click(screen.getByRole('button', { name: 'Explore' }));
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/explore'));
    expect(router.state.location.search).toBe('?q=lalbagh%20fort');
  });

  it('offers a retry when places fail to load', async () => {
    let attempts = 0;
    mockFetch((path) => {
      if (path.endsWith('/categories')) return ok(CATEGORIES);
      attempts += 1;
      return attempts <= 2 ? fail(503, 'TIMEOUT') : page([place()]);
    });
    renderHome();
    const retry = (await screen.findAllByRole('button', { name: 'Try again' }))[0];
    expect(screen.getAllByText('This service is temporarily unavailable. Try again shortly.').length).toBeGreaterThan(0);
    await userEvent.click(retry);
    expect(await screen.findAllByRole('link', { name: 'Lalbagh Fort' })).toBeDefined();
  });
});

describe('home page with no well-rated places', () => {
  it('leaves the rated section out', async () => {
    mockFetch((path) => {
      if (path.endsWith('/categories')) return ok(CATEGORIES);
      return path.includes('minRating=4') ? page([]) : page([place()]);
    });
    renderHome();
    await screen.findByRole('link', { name: 'Lalbagh Fort' });
    await vi.waitFor(() => expect(screen.queryByRole('region', { name: 'Rated 4 stars and above' })).toBeNull());
  });
});

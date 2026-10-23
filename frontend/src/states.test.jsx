import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { clearSession } from './api/session.js';
import { ErrorAlert } from './components/ErrorState.jsx';
import { ToastProvider } from './components/Toast.jsx';
import { AuthProvider } from './features/auth/AuthProvider.jsx';
import { createQueryClient } from './lib/queryClient.js';
import { routes } from './routes.jsx';
import { fail, mockFetch, ok, place } from './test/fetchMock.js';

vi.mock('./features/places/PlacesMap.jsx', () => ({ default: () => <div>Map</div> }));

function renderAt(url) {
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <AuthProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return router;
}

const pageOf = (items) => ok(items, { page: 1, limit: 20, total: items.length, totalPages: 1 });
let placeCalls;
function serve(placesHandler) {
  placeCalls = 0;
  return mockFetch((path) => {
    if (path.endsWith('/categories')) return ok([]);
    placeCalls += 1;
    return placesHandler(placeCalls, path);
  });
}

beforeEach(() => clearSession());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('offline', () => {
  it('says so while offline and goes away when back online', async () => {
    serve(() => pageOf([place()]));
    renderAt('/explore');
    await screen.findByRole('link', { name: 'Lalbagh Fort' });

    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => window.dispatchEvent(new Event('offline')));
    expect(screen.getByText(/You are offline/)).toBeDefined();

    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    act(() => window.dispatchEvent(new Event('online')));
    expect(screen.queryByText(/You are offline/)).toBeNull();
  });
});

describe('failures', () => {
  it('shows the wait time for rate limits and does not retry them', async () => {
    serve(() => ({ ...fail(429, 'RATE_LIMITED'), headers: { 'Retry-After': '30' } }));
    renderAt('/explore');
    expect(await screen.findByText('Too many requests. Try again in 30 seconds.')).toBeDefined();
    expect(placeCalls).toBe(1);
  });

  it('retries a failed connection once, then explains it', async () => {
    serve(() => {
      throw new TypeError('Failed to fetch');
    });
    renderAt('/explore');
    expect(await screen.findByText(/Could not reach NAVORA/, {}, { timeout: 4000 })).toBeDefined();
    expect(placeCalls).toBe(2);
  });

  it('replaces results with a retryable error when a new search fails, never stale results', async () => {
    serve((n, path) => (path.includes('minRating') ? fail(400, 'BAD_FILTER', { message: 'That filter is not available' }) : pageOf([place()])));
    renderAt('/explore');
    await screen.findByRole('link', { name: 'Lalbagh Fort' });
    await userEvent.selectOptions(screen.getByLabelText(/^Rating/), '4 stars and above');
    expect(await screen.findByText('That filter is not available')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined();
    expect(screen.queryByRole('link', { name: 'Lalbagh Fort' })).toBeNull();
  });
});

describe('ErrorAlert', () => {
  it('adds the request reference for server failures only', () => {
    const { rerender } = render(<ErrorAlert error={{ status: 500, code: 'INTERNAL_ERROR', requestId: 'req-9' }} />);
    expect(screen.getByText('Reference: req-9')).toBeDefined();
    rerender(<ErrorAlert error={{ status: 422, code: 'ITINERARY_DAY_INFEASIBLE', message: 'Day 1 does not fit', requestId: 'req-10' }} />);
    expect(screen.getByText('Day 1 does not fit')).toBeDefined();
    expect(screen.queryByText(/Reference/)).toBeNull();
  });
});

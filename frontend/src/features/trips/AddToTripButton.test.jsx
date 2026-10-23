import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { clearSession, setSession } from '../../api/session.js';
import { ToastProvider } from '../../components/Toast.jsx';
import { createQueryClient } from '../../lib/queryClient.js';
import { routes } from '../../routes.jsx';
import { mockFetch, ok, page, place, user } from '../../test/fetchMock.js';
import { AuthProvider } from '../auth/AuthProvider.jsx';

vi.mock('../places/PlacesMap.jsx', () => ({ default: () => <div>Map</div> }));
vi.mock('../../components/LocationPicker.jsx', () => ({ default: () => <div>Map</div> }));

const PLACE_ID = '0401b197-7838-4821-8b82-1e06c54a037b';
const thePlace = place({ id: PLACE_ID });
const trip = (overrides) => ({ id: 't1', title: 'Old Dhaka weekend', startDate: '2026-11-01', durationDays: 2, selectedPlaceIds: [], ...overrides });

let calls;
function serve(trips) {
  calls = [];
  mockFetch((path, init) => {
    calls.push({ method: init.method, path, body: init.body });
    if (path.endsWith('/auth/me')) return ok({ user });
    if (path.endsWith('/reviews/mine')) return ok(null);
    if (path.startsWith('/trips') && init.method === 'GET') return page(trips);
    if (path === '/trips/t1' && init.method === 'PATCH') return ok({ ...trips[0], ...init.body });
    if (path.includes('/saved-places/')) return ok({ placeId: PLACE_ID, saved: false });
    if (path.startsWith('/saved-places')) return page([]);
    if (path === `/places/${PLACE_ID}`) return ok(thePlace);
    return page([]);
  });
}

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

beforeEach(() => {
  clearSession();
  setSession({ accessToken: 'a', refreshToken: 'r', user });
});
afterEach(() => vi.unstubAllGlobals());

describe('add to trip', () => {
  it('adds the place to a trip as a must-visit place, keeping the others', async () => {
    serve([trip({ selectedPlaceIds: ['other'] }), trip({ id: 't2', title: 'Already there', selectedPlaceIds: [PLACE_ID] })]);
    renderAt(`/places/${PLACE_ID}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Add to trip' }));
    const dialog = screen.getByRole('dialog', { name: 'Add to a trip' });
    expect(await within(dialog).findByText('Added')).toBeDefined(); // the second trip has it already
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add to Old Dhaka weekend' }));
    expect(await screen.findByText('Added to Old Dhaka weekend.')).toBeDefined();
    expect(calls.find((c) => c.method === 'PATCH').body).toEqual({ selectedPlaceIds: ['other', PLACE_ID] });
  });

  it('starts a new trip with the place chosen, even though it is not saved', async () => {
    serve([]);
    const router = renderAt(`/places/${PLACE_ID}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Add to trip' }));
    expect(await screen.findByText('You have no trips yet.')).toBeDefined();
    await userEvent.click(screen.getByRole('link', { name: 'New trip with this place' }));
    await vi.waitFor(() => expect(router.state.location.search).toBe(`?place=${PLACE_ID}`));
    expect(await screen.findByRole('heading', { level: 1, name: /plan/i })).toBeDefined();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { clearSession, getSession, setSession } from '../../api/session.js';
import { ToastProvider } from '../../components/Toast.jsx';
import { AuthProvider } from '../auth/AuthProvider.jsx';
import { createQueryClient } from '../../lib/queryClient.js';
import { routes } from '../../routes.jsx';
import { mockFetch, ok, user } from '../../test/fetchMock.js';

const trip = (overrides) => ({
  id: 't1',
  title: 'Old Dhaka weekend',
  startLocation: { latitude: 23.71, longitude: 90.4 },
  startAddress: null,
  startDate: '2026-10-24',
  durationDays: 2,
  dailyStartTime: '09:00',
  dailyEndTime: '20:00',
  searchRadiusKm: 10,
  budget: null,
  travelMode: 'walking',
  travelingWithPet: false,
  parkingRequired: false,
  wheelchairAccessRequired: false,
  partySize: 2,
  minimumRating: null,
  interests: [],
  preferredCategories: [],
  selectedPlaceIds: [],
  currentItineraryId: 'i1',
  createdAt: '2026-10-22T08:00:00Z',
  updatedAt: '2026-10-22T08:00:00Z',
  ...overrides,
});

let calls;
function serve(trips, who = user) {
  const list = [...trips];
  calls = [];
  mockFetch((path, init) => {
    calls.push(`${init.method} ${path}`);
    if (path.endsWith('/auth/me')) return ok({ user: who });
    if (path.endsWith('/auth/logout')) return ok({ loggedOut: true });
    if (init.method === 'DELETE') {
      list.splice(list.findIndex((t) => path.endsWith(t.id)), 1);
      return ok({ id: 't1', deleted: true });
    }
    return ok(list, { page: 1, limit: 20, total: list.length, totalPages: 1 });
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

const signInAs = (role = 'user') => {
  const who = { ...user, role, createdAt: '2026-10-01T08:00:00Z' };
  setSession({ accessToken: 'a', refreshToken: 'r', user: who });
  return who;
};

beforeEach(() => clearSession());
afterEach(() => vi.unstubAllGlobals());

describe('my trips', () => {
  it('lists trips with their dates and itinerary state', async () => {
    serve([trip(), trip({ id: 't2', title: 'Museum day', startDate: null, durationDays: 1, currentItineraryId: null, partySize: 1 })], signInAs());
    renderAt('/trips');
    const first = (await screen.findByRole('link', { name: 'Old Dhaka weekend' })).closest('li');
    expect(within(first).getByText('Itinerary ready')).toBeDefined();
    expect(within(first).getByText('From Saturday 24 October, 2 days')).toBeDefined();
    const second = screen.getByRole('link', { name: 'Museum day' }).closest('li');
    expect(within(second).getByText('No itinerary yet')).toBeDefined();
    expect(within(second).getByText('1 day, starting the day you generate it')).toBeDefined();
  });

  it('deletes a trip after confirmation', async () => {
    serve([trip()], signInAs());
    renderAt('/trips');
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Old Dhaka weekend' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete this trip?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete trip' }));
    expect(await screen.findByText('Old Dhaka weekend was deleted.')).toBeDefined();
    expect(await screen.findByRole('heading', { name: 'No trips yet' })).toBeDefined();
    expect(calls).toContain('DELETE /trips/t1');
  });

  it('suggests planning a trip when there are none', async () => {
    serve([], signInAs());
    renderAt('/trips');
    expect(await screen.findByRole('heading', { name: 'No trips yet' })).toBeDefined();
  });
});

describe('profile', () => {
  it('shows the account and links to the user’s areas', async () => {
    serve([], signInAs());
    renderAt('/profile');
    expect(await screen.findByText('ayesha@example.com')).toBeDefined();
    expect(screen.getByText('Member')).toBeDefined();
    expect(screen.getByText('October 1, 2026')).toBeDefined();
    const nav = screen.getByRole('navigation', { name: 'Your activity' });
    expect(within(nav).getByRole('link', { name: /My submissions/ }).getAttribute('href')).toBe('/community/mine');
    expect(within(nav).queryByRole('link', { name: /Moderation/ })).toBeNull();
  });

  it('links moderators to the moderation queue', async () => {
    serve([], signInAs('moderator'));
    renderAt('/profile');
    const nav = await screen.findByRole('navigation', { name: 'Your activity' });
    expect(within(nav).getByRole('link', { name: /Moderation/ }).getAttribute('href')).toBe('/moderation');
  });

  it('signs out to the home page', async () => {
    serve([], signInAs());
    const router = renderAt('/profile');
    const main = await screen.findByRole('main');
    await userEvent.click(within(main).getByRole('button', { name: 'Sign out' }));
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(getSession()).toBeNull();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { clearSession, setSession } from '../../api/session.js';
import { ToastProvider } from '../../components/Toast.jsx';
import { createQueryClient } from '../../lib/queryClient.js';
import { routes } from '../../routes.jsx';
import { mockFetch, ok, page, place, user } from '../../test/fetchMock.js';
import { AuthProvider } from './AuthProvider.jsx';

// Leaflet cannot run in jsdom; these tests are about the session, not the map.
vi.mock('../places/PlacesMap.jsx', () => ({ default: () => <div>Map</div> }));

function renderAt(url, queryClient = createQueryClient()) {
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { router, queryClient };
}

beforeEach(() => {
  clearSession();
  mockFetch((path) => (path.endsWith('/auth/me') ? ok({ user }) : page([place()])));
});
afterEach(() => vi.unstubAllGlobals());

describe('when the server ends the session', () => {
  it('explains it in a banner with a sign-in link back to the current page', async () => {
    setSession({ accessToken: 'a', refreshToken: 'r', user });
    renderAt('/explore?q=fort');
    await screen.findByRole('heading', { level: 1, name: 'Explore places' });
    act(() => clearSession({ reason: 'expired' }));
    expect(await screen.findByText(/Your session has ended/)).toBeDefined();
    expect(screen.getByRole('link', { name: 'Sign in again' }).getAttribute('href')).toBe(
      `/login?next=${encodeURIComponent('/explore?q=fort')}`,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/Your session has ended/)).toBeNull();
  });

  it('sends private pages to sign in, which explains why', async () => {
    setSession({ accessToken: 'a', refreshToken: 'r', user });
    const { router } = renderAt('/saved');
    await screen.findByRole('heading', { level: 1, name: 'Saved places' });
    act(() => clearSession({ reason: 'expired' }));
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toBe(`?next=${encodeURIComponent('/saved')}`);
    expect(screen.getByText('Your session has ended. Sign in again to continue where you left off.')).toBeDefined();
  });

  it('shows no notice after a normal sign-out', async () => {
    setSession({ accessToken: 'a', refreshToken: 'r', user });
    renderAt('/explore');
    await screen.findByRole('heading', { level: 1, name: 'Explore places' });
    act(() => clearSession({ reason: 'signed-out' }));
    await screen.findAllByRole('link', { name: 'Sign in' });
    expect(screen.queryByText(/Your session has ended/)).toBeNull();
  });
});

describe('cached data never outlives its user', () => {
  it('is dropped on sign-out and when a different user signs in', async () => {
    setSession({ accessToken: 'a', refreshToken: 'r', user });
    const { queryClient } = renderAt('/explore');
    await screen.findByRole('heading', { level: 1, name: 'Explore places' });

    queryClient.setQueryData(['saved', 'list', 1, 20], { data: [place()] });
    act(() => clearSession());
    expect(queryClient.getQueryData(['saved', 'list', 1, 20])).toBeUndefined();

    act(() => setSession({ accessToken: 'b', refreshToken: 'rb', user: { ...user, id: 'u2', name: 'Second User' } }));
    queryClient.setQueryData(['trips', 'list', 1], { data: ['second user trip'] });
    act(() => setSession({ accessToken: 'c', refreshToken: 'rc', user }));
    expect(queryClient.getQueryData(['trips', 'list', 1])).toBeUndefined();
  });

  it('is kept when the same user only refreshes tokens', async () => {
    setSession({ accessToken: 'a', refreshToken: 'r', user });
    const { queryClient } = renderAt('/explore');
    await screen.findByRole('heading', { level: 1, name: 'Explore places' });
    queryClient.setQueryData(['trips', 'list', 1], { data: ['kept'] });
    act(() => setSession({ accessToken: 'a2', refreshToken: 'r2', user }));
    expect(queryClient.getQueryData(['trips', 'list', 1])).toEqual({ data: ['kept'] });
  });
});

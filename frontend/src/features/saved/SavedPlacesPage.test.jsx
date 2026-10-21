import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { clearSession, setSession } from '../../api/session.js';
import { ToastProvider } from '../../components/Toast.jsx';
import { AuthProvider } from '../auth/AuthProvider.jsx';
import { createQueryClient } from '../../lib/queryClient.js';
import { routes } from '../../routes.jsx';
import { mockFetch, ok, place, user } from '../../test/fetchMock.js';

function renderSaved() {
  const router = createMemoryRouter(routes, { initialEntries: ['/saved'] });
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

function serve(saved) {
  const list = [...saved];
  mockFetch((path, init) => {
    if (path.endsWith('/auth/me')) return ok({ user });
    if (init.method === 'DELETE') {
      const id = path.split('/').pop();
      list.splice(list.findIndex((p) => p.id === id), 1);
      return ok({ placeId: id, saved: false });
    }
    return ok(list, { page: 1, limit: 20, total: list.length, totalPages: 1 });
  });
}

beforeEach(() => {
  clearSession();
  setSession({ accessToken: 'a', refreshToken: 'r', user });
});
afterEach(() => vi.unstubAllGlobals());

describe('saved places page', () => {
  it('lists saved places and removes one', async () => {
    serve([place(), place({ id: 'p2', name: 'Ramna Park' })]);
    renderSaved();
    expect(await screen.findByText('2 saved places')).toBeDefined();
    const card = screen.getByRole('link', { name: 'Ramna Park' }).closest('article');
    await userEvent.click(within(card).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('1 saved place')).toBeDefined();
    expect(screen.queryByRole('link', { name: 'Ramna Park' })).toBeNull();
    expect(screen.getByText('Ramna Park was removed from your saved places.')).toBeDefined();
  });

  it('explains how to save places when there are none', async () => {
    serve([]);
    renderSaved();
    expect(await screen.findByRole('heading', { name: 'No saved places yet' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Explore places' }).getAttribute('href')).toBe('/explore');
  });

  it('is only for signed-in users', () => {
    clearSession();
    serve([]);
    const router = renderSaved();
    expect(router.state.location.pathname).toBe('/login');
  });
});

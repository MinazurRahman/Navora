import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { clearSession, getSession } from '../../api/session.js';
import { ToastProvider } from '../../components/Toast.jsx';
import { createQueryClient } from '../../lib/queryClient.js';
import { routes } from '../../routes.jsx';
import { fail, mockFetch, ok, sessionData, user } from '../../test/fetchMock.js';
import { AuthProvider } from './AuthProvider.jsx';

let googleCallback;
let calls;

function stubGoogle() {
  window.google = {
    accounts: {
      id: {
        initialize: vi.fn(({ callback }) => {
          googleCallback = callback;
        }),
        renderButton: vi.fn((el) => {
          el.innerHTML = '<button type="button">Sign in with Google</button>';
        }),
      },
    },
  };
}

function serve(handler) {
  calls = [];
  mockFetch((path, init) => {
    calls.push({ path, body: init.body });
    if (path === '/auth/google') return handler(init.body);
    if (path.endsWith('/auth/me')) return ok({ user });
    return ok([], { page: 1, limit: 20, total: 0, totalPages: 0 });
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

beforeEach(() => clearSession());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  delete window.google;
});

describe('sign in with Google', () => {
  it('is hidden when no client ID is configured', async () => {
    serve(() => fail(503, 'GOOGLE_SIGNIN_DISABLED'));
    renderAt('/login');
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(screen.queryByText('or use your email')).toBeNull();
  });

  it('sends the Google credential and signs in, returning to the requested page', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'navora-test.apps.googleusercontent.com');
    stubGoogle();
    serve(() => ok(sessionData('a-google', 'r-google')));
    const router = renderAt('/login?next=/trips');
    expect(await screen.findByRole('button', { name: 'Sign in with Google' })).toBeDefined();
    expect(window.google.accounts.id.initialize).toHaveBeenCalledWith(expect.objectContaining({ client_id: 'navora-test.apps.googleusercontent.com' }));

    await act(async () => googleCallback({ credential: 'google-id-token-from-the-button' }));
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/trips'));
    expect(calls.find((c) => c.path === '/auth/google').body).toEqual({ credential: 'google-id-token-from-the-button' });
    expect(getSession()).toMatchObject({ accessToken: 'a-google' });
  });

  it('explains a Google account that does not match the existing account', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'navora-test.apps.googleusercontent.com');
    stubGoogle();
    serve(() => fail(409, 'GOOGLE_ACCOUNT_MISMATCH'));
    renderAt('/register');
    await screen.findByRole('button', { name: 'Sign in with Google' });
    await act(async () => googleCallback({ credential: 'google-id-token-from-the-button' }));
    expect(await screen.findByText(/linked to a different Google account/)).toBeDefined();
  });
});

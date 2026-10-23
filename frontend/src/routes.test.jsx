import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { clearSession, getSession, setSession } from './api/session.js';
import { ToastProvider } from './components/Toast.jsx';
import { AuthProvider } from './features/auth/AuthProvider.jsx';
import { createQueryClient } from './lib/queryClient.js';
import { routes } from './routes.jsx';
import { fail, mockFetch, ok, page, sessionData, user } from './test/fetchMock.js';

async function renderAt(path) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <AuthProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>,
  );
  // Pages are lazy routes: wait until the page's chunk has loaded and rendered.
  await vi.waitFor(() => {
    if (!router.state.initialized || router.state.navigation.state !== 'idle') throw new Error('page loading');
  });
  return router;
}

// A stored session; the app verifies it with GET /auth/me on start.
function signInAs(role = 'user') {
  const who = { ...user, role };
  setSession({ accessToken: 'access', refreshToken: 'refresh', user: who });
  return mockFetch((path) => {
    if (path.endsWith('/auth/me')) return ok({ user: who });
    if (path.endsWith('/auth/logout')) return ok({ loggedOut: true });
    return page([]);
  });
}

beforeEach(() => {
  clearSession();
  // Public pages load catalogue and place lists; individual tests replace this.
  mockFetch((path) => (path.endsWith('/categories') ? ok([]) : page([])));
});
afterEach(() => vi.unstubAllGlobals());

describe('navigation', () => {
  it('marks the current page in the main navigation', async () => {
    await renderAt('/explore');
    // The desktop nav is the first "Main" navigation; the mobile one exists only while open.
    const nav = (await screen.findAllByRole('navigation', { name: 'Main' }))[0];
    expect(within(nav).getByRole('link', { name: 'Explore' }).getAttribute('aria-current')).toBe('page');
    expect(within(nav).getByRole('link', { name: 'Community' }).hasAttribute('aria-current')).toBe(false);
  });

  it('shows sign-in actions to anonymous visitors', async () => {
    await renderAt('/');
    expect(screen.getAllByRole('link', { name: 'Sign in' }).length).toBeGreaterThan(0);
  });

  it('shows a not-found page for unknown paths', async () => {
    await renderAt('/no-such-page');
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeDefined();
  });

  it('opens and closes the mobile menu', async () => {
    await renderAt('/');
    const toggle = screen.getByRole('button', { name: 'Open menu' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Close menu' }).getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById('mobile-menu')).not.toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(document.getElementById('mobile-menu')).toBeNull();
  });
});

describe('private routes', () => {
  it('send anonymous visitors to sign in, remembering where they were going', async () => {
    const router = await renderAt('/trips?sort=new');
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toBe(`?next=${encodeURIComponent('/trips?sort=new')}`);
  });

  it('wait for the stored session to be verified, then render', async () => {
    setSession({ accessToken: 'access', refreshToken: 'refresh', user });
    let verify;
    mockFetch((path) => (path.endsWith('/auth/me') ? new Promise((resolve) => (verify = () => resolve(ok({ user })))) : page([])));
    const router = createMemoryRouter(routes, { initialEntries: ['/trips'] });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <AuthProvider>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>,
    );
    await vi.waitFor(() => expect(verify).toBeDefined()); // /auth/me is in flight
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('heading', { level: 1, name: 'My trips' })).toBeNull();
    verify();
    expect(await screen.findByRole('heading', { level: 1, name: 'My trips' })).toBeDefined();
    expect(screen.getAllByText('Ayesha Rahman').length).toBeGreaterThan(0);
  });

  it('send the user to sign in when the stored session is rejected', async () => {
    setSession({ accessToken: 'bad', refreshToken: 'bad', user });
    mockFetch(() => fail(401, 'INVALID_TOKEN'));
    const router = await renderAt('/trips');
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(getSession()).toBeNull();
  });

  it('sign out returns to the home page and revokes the session', async () => {
    const fetchMock = signInAs('user');
    const router = await renderAt('/trips');
    await userEvent.click((await screen.findAllByRole('button', { name: 'Sign out' }))[0]);
    expect(router.state.location.pathname).toBe('/');
    expect(getSession()).toBeNull();
    expect(screen.queryByText('Ayesha Rahman')).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/auth/logout'))).toBe(true);
  });

  it('refuse the moderation page to ordinary users and hide its link', async () => {
    signInAs('user');
    await renderAt('/moderation');
    expect(await screen.findByRole('heading', { name: 'You do not have access to this page' })).toBeDefined();
    expect(screen.queryByRole('link', { name: 'Moderation' })).toBeNull();
  });

  it('open the moderation page for moderators', async () => {
    signInAs('moderator');
    await renderAt('/moderation');
    expect(await screen.findByRole('heading', { level: 1, name: 'Moderation' })).toBeDefined();
    expect(screen.getAllByRole('link', { name: 'Moderation' }).length).toBeGreaterThan(0);
  });
});

describe('sign in', () => {
  it('validates required fields before calling the API', async () => {
    const fetchMock = mockFetch(() => ok({}));
    await renderAt('/login');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter your email address.')).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows a clear message for wrong credentials', async () => {
    mockFetch(() => fail(401, 'INVALID_CREDENTIALS'));
    await renderAt('/login');
    await userEvent.type(screen.getByLabelText('Email'), 'ayesha@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('The email or password is incorrect.')).toBeDefined();
    expect(getSession()).toBeNull();
  });

  it('stores the session and continues to the page that asked for sign-in', async () => {
    mockFetch((path, init) => {
      expect(init.body).toEqual({ email: 'ayesha@example.com', password: 'correct horse' });
      return ok(sessionData('a', 'r'));
    });
    const router = await renderAt(`/login?next=${encodeURIComponent('/trips')}`);
    await userEvent.type(screen.getByLabelText('Email'), ' ayesha@example.com ');
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/trips'));
    expect(getSession()).toMatchObject({ accessToken: 'a', refreshToken: 'r', user: { name: 'Ayesha Rahman' } });
  });

  it('ignores an off-site next link', async () => {
    mockFetch(() => ok(sessionData()));
    const router = await renderAt(`/login?next=${encodeURIComponent('//evil.example')}`);
    await userEvent.type(screen.getByLabelText('Email'), 'ayesha@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });
});

describe('register', () => {
  it('puts server validation and duplicate-email errors beside the fields', async () => {
    mockFetch(() => fail(409, 'EMAIL_ALREADY_REGISTERED'));
    await renderAt('/register');
    await userEvent.type(screen.getByLabelText('Name'), 'Ayesha');
    await userEvent.type(screen.getByLabelText('Email'), 'ayesha@example.com');
    await userEvent.type(screen.getByLabelText(/^Password/), 'long enough');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    const email = screen.getByLabelText('Email');
    await vi.waitFor(() => expect(email.getAttribute('aria-invalid')).toBe('true'));
    expect(screen.getByText('An account with this email already exists. Sign in instead.')).toBeDefined();
  });

  it('requires an 8-character password', async () => {
    const fetchMock = mockFetch(() => ok({}));
    await renderAt('/register');
    await userEvent.type(screen.getByLabelText('Name'), 'Ayesha');
    await userEvent.type(screen.getByLabelText('Email'), 'ayesha@example.com');
    await userEvent.type(screen.getByLabelText(/^Password/), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByText('Use at least 8 characters.')).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

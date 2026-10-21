import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { clearSession, getSession, setSession } from './api/session.js';
import { AuthProvider } from './features/auth/AuthProvider.jsx';
import { createQueryClient } from './lib/queryClient.js';
import { routes } from './routes.jsx';
import { fail, mockFetch, ok, sessionData, user } from './test/fetchMock.js';

function renderAt(path) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return router;
}

// A stored session; the app verifies it with GET /auth/me on start.
function signInAs(role = 'user') {
  const who = { ...user, role };
  setSession({ accessToken: 'access', refreshToken: 'refresh', user: who });
  return mockFetch((path) => (path.endsWith('/auth/me') ? ok({ user: who }) : ok({ loggedOut: true })));
}

// The desktop nav is the first "Main" navigation; the mobile one exists only while open.
const mainNav = () => screen.getAllByRole('navigation', { name: 'Main' })[0];

beforeEach(() => clearSession());
afterEach(() => vi.unstubAllGlobals());

describe('navigation', () => {
  it('marks the current page in the main navigation', () => {
    renderAt('/explore');
    const nav = mainNav();
    expect(within(nav).getByRole('link', { name: 'Explore' }).getAttribute('aria-current')).toBe('page');
    expect(within(nav).getByRole('link', { name: 'Community' }).hasAttribute('aria-current')).toBe(false);
  });

  it('shows sign-in actions to anonymous visitors', () => {
    renderAt('/');
    expect(screen.getAllByRole('link', { name: 'Sign in' }).length).toBeGreaterThan(0);
  });

  it('shows a not-found page for unknown paths', () => {
    renderAt('/no-such-page');
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeDefined();
  });

  it('opens and closes the mobile menu', async () => {
    renderAt('/');
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
  it('send anonymous visitors to sign in, remembering where they were going', () => {
    const router = renderAt('/trips?sort=new');
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toBe(`?next=${encodeURIComponent('/trips?sort=new')}`);
  });

  it('wait for the stored session to be verified, then render', async () => {
    signInAs('user');
    renderAt('/trips');
    expect(screen.queryByRole('heading', { name: 'My trips is not available yet' })).toBeNull();
    expect(await screen.findByRole('heading', { name: 'My trips is not available yet' })).toBeDefined();
    expect(screen.getAllByText('Ayesha Rahman').length).toBeGreaterThan(0);
  });

  it('send the user to sign in when the stored session is rejected', async () => {
    setSession({ accessToken: 'bad', refreshToken: 'bad', user });
    mockFetch(() => fail(401, 'INVALID_TOKEN'));
    const router = renderAt('/trips');
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(getSession()).toBeNull();
  });

  it('sign out returns to the home page and revokes the session', async () => {
    const fetchMock = signInAs('user');
    const router = renderAt('/trips');
    await userEvent.click((await screen.findAllByRole('button', { name: 'Sign out' }))[0]);
    expect(router.state.location.pathname).toBe('/');
    expect(getSession()).toBeNull();
    expect(screen.queryByText('Ayesha Rahman')).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/auth/logout'))).toBe(true);
  });

  it('refuse the moderation page to ordinary users and hide its link', async () => {
    signInAs('user');
    renderAt('/moderation');
    expect(await screen.findByRole('heading', { name: 'You do not have access to this page' })).toBeDefined();
    expect(screen.queryByRole('link', { name: 'Moderation' })).toBeNull();
  });

  it('open the moderation page for moderators', async () => {
    signInAs('moderator');
    renderAt('/moderation');
    expect(await screen.findByRole('heading', { name: 'Moderation is not available yet' })).toBeDefined();
    expect(screen.getAllByRole('link', { name: 'Moderation' }).length).toBeGreaterThan(0);
  });
});

describe('sign in', () => {
  it('validates required fields before calling the API', async () => {
    const fetchMock = mockFetch(() => ok({}));
    renderAt('/login');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter your email address.')).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows a clear message for wrong credentials', async () => {
    mockFetch(() => fail(401, 'INVALID_CREDENTIALS'));
    renderAt('/login');
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
    const router = renderAt(`/login?next=${encodeURIComponent('/trips')}`);
    await userEvent.type(screen.getByLabelText('Email'), ' ayesha@example.com ');
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/trips'));
    expect(getSession()).toMatchObject({ accessToken: 'a', refreshToken: 'r', user: { name: 'Ayesha Rahman' } });
  });

  it('ignores an off-site next link', async () => {
    mockFetch(() => ok(sessionData()));
    const router = renderAt(`/login?next=${encodeURIComponent('//evil.example')}`);
    await userEvent.type(screen.getByLabelText('Email'), 'ayesha@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });
});

describe('register', () => {
  it('puts server validation and duplicate-email errors beside the fields', async () => {
    mockFetch(() => fail(409, 'EMAIL_ALREADY_REGISTERED'));
    renderAt('/register');
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
    renderAt('/register');
    await userEvent.type(screen.getByLabelText('Name'), 'Ayesha');
    await userEvent.type(screen.getByLabelText('Email'), 'ayesha@example.com');
    await userEvent.type(screen.getByLabelText(/^Password/), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByText('Use at least 8 characters.')).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

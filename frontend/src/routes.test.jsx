import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { writeSession } from './api/session.js';
import { AuthProvider } from './features/auth/AuthProvider.jsx';
import { routes } from './routes.jsx';

function renderAt(path) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
  return router;
}

function signInAs(role = 'user') {
  writeSession({
    accessToken: 'access',
    refreshToken: 'refresh',
    user: { id: '1', name: 'Ayesha Rahman', email: 'ayesha@example.com', role },
  });
}

// The desktop nav is the first "Main" navigation; the mobile one exists only while open.
const mainNav = () => screen.getAllByRole('navigation', { name: 'Main' })[0];

afterEach(() => sessionStorage.clear());

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

  it('render for a signed-in user, and signing out returns to anonymous', async () => {
    signInAs('user');
    const router = renderAt('/trips');
    expect(screen.getByRole('heading', { name: 'My trips is not available yet' })).toBeDefined();
    expect(screen.getAllByText('Ayesha Rahman').length).toBeGreaterThan(0);

    await userEvent.click(screen.getAllByRole('button', { name: 'Sign out' })[0]);
    expect(router.state.location.pathname).toBe('/');
    expect(sessionStorage.length).toBe(0);
    expect(screen.queryByText('Ayesha Rahman')).toBeNull();
  });

  it('refuse the moderation page to ordinary users and hide its link', () => {
    signInAs('user');
    renderAt('/moderation');
    expect(screen.getByRole('heading', { name: 'You do not have access to this page' })).toBeDefined();
    expect(screen.queryByRole('link', { name: 'Moderation' })).toBeNull();
  });

  it('open the moderation page for moderators', () => {
    signInAs('moderator');
    renderAt('/moderation');
    expect(screen.getByRole('heading', { name: 'Moderation is not available yet' })).toBeDefined();
    expect(screen.getAllByRole('link', { name: 'Moderation' }).length).toBeGreaterThan(0);
  });
});

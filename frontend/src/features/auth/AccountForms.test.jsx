import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { clearSession, getSession, setSession } from '../../api/session.js';
import { ToastProvider } from '../../components/Toast.jsx';
import { createQueryClient } from '../../lib/queryClient.js';
import { routes } from '../../routes.jsx';
import { fail, mockFetch, ok, sessionData, user } from '../../test/fetchMock.js';
import { AuthProvider } from './AuthProvider.jsx';

let calls;
function serve(handlers = {}) {
  calls = [];
  mockFetch((path, init) => {
    calls.push({ method: init.method, path, body: init.body });
    const handler = handlers[`${init.method} ${path}`];
    if (handler) return handler(init.body);
    if (path.endsWith('/auth/me')) return ok({ user });
    return ok([], { page: 1, limit: 20, total: 0, totalPages: 0 });
  });
}

function renderProfile() {
  const router = createMemoryRouter(routes, { initialEntries: ['/profile'] });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <AuthProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

const form = async (name) => (await screen.findByRole('heading', { name })).closest('form');

beforeEach(() => {
  clearSession();
  setSession({ accessToken: 'a', refreshToken: 'r', user });
});
afterEach(() => vi.unstubAllGlobals());

describe('edit profile', () => {
  it('saves a new name and shows it everywhere', async () => {
    serve({ 'PATCH /auth/me': (body) => ok({ user: { ...user, ...body } }) });
    renderProfile();
    const edit = await form('Edit profile');
    const name = within(edit).getByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Ayesha R.');
    await userEvent.click(within(edit).getByRole('button', { name: 'Save profile' }));
    expect(await screen.findByText('Your profile was updated.')).toBeDefined();
    expect(calls.find((c) => c.method === 'PATCH').body).toEqual({ name: 'Ayesha R.' });
    expect(getSession().user.name).toBe('Ayesha R.');
  });

  it('asks for the current password only when the email changes, and shows its error', async () => {
    serve({
      'PATCH /auth/me': () => fail(400, 'VALIDATION_ERROR', { details: [{ location: 'body', path: 'currentPassword', message: 'Current password is incorrect' }] }),
    });
    renderProfile();
    const edit = await form('Edit profile');
    expect(within(edit).queryByLabelText(/^Current password/)).toBeNull();
    const email = within(edit).getByLabelText('Email');
    await userEvent.clear(email);
    await userEvent.type(email, 'new@example.com');
    await userEvent.click(within(edit).getByRole('button', { name: 'Save profile' }));
    expect(within(edit).getByText('Enter your current password to change your email.')).toBeDefined();
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);

    await userEvent.type(within(edit).getByLabelText(/^Current password/), 'wrong');
    await userEvent.click(within(edit).getByRole('button', { name: 'Save profile' }));
    expect(await within(edit).findByText('Current password is incorrect')).toBeDefined();
    expect(calls.find((c) => c.method === 'PATCH').body).toEqual({ email: 'new@example.com', currentPassword: 'wrong' });
  });
});

describe('change password', () => {
  it('checks the fields, then stores the new session', async () => {
    serve({ 'POST /auth/change-password': () => ok(sessionData('a-new', 'r-new')) });
    renderProfile();
    const change = await form('Change password');
    await userEvent.type(within(change).getByLabelText('Current password'), 'old password');
    await userEvent.type(within(change).getByLabelText(/^New password/), 'short');
    await userEvent.type(within(change).getByLabelText('Confirm new password'), 'different');
    await userEvent.click(within(change).getByRole('button', { name: 'Change password' }));
    expect(within(change).getByText('Use at least 8 characters.')).toBeDefined();
    expect(within(change).getByText('The passwords do not match.')).toBeDefined();

    const next = within(change).getByLabelText(/^New password/);
    await userEvent.clear(next);
    await userEvent.type(next, 'a brand new passphrase');
    const confirm = within(change).getByLabelText('Confirm new password');
    await userEvent.clear(confirm);
    await userEvent.type(confirm, 'a brand new passphrase');
    await userEvent.click(within(change).getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText('Password changed. You were signed out on your other devices.')).toBeDefined();
    expect(calls.find((c) => c.path.endsWith('/change-password')).body).toEqual({ currentPassword: 'old password', newPassword: 'a brand new passphrase' });
    expect(getSession()).toMatchObject({ accessToken: 'a-new', refreshToken: 'r-new' });
  });
});

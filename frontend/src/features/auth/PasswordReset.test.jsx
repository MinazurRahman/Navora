import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { clearSession } from '../../api/session.js';
import { ToastProvider } from '../../components/Toast.jsx';
import { createQueryClient } from '../../lib/queryClient.js';
import { routes } from '../../routes.jsx';
import { fail, mockFetch, ok } from '../../test/fetchMock.js';
import { AuthProvider } from './AuthProvider.jsx';

let calls;
function serve(handlers = {}) {
  calls = [];
  mockFetch((path, init) => {
    calls.push({ method: init.method, path, body: init.body });
    const handler = handlers[`${init.method} ${path}`];
    return handler ? handler(init.body) : fail(404, 'NOT_FOUND');
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
afterEach(() => vi.unstubAllGlobals());

describe('forgot password', () => {
  it('is linked from sign in and confirms without saying whether the account exists', async () => {
    serve({ 'POST /auth/forgot-password': () => ({ status: 202, body: { success: true, data: { requested: true } } }) });
    const router = renderAt('/login');
    await userEvent.click(await screen.findByRole('link', { name: 'Forgot your password?' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Send reset link' }));
    expect(screen.getByText('Enter your email address.')).toBeDefined();
    await userEvent.type(screen.getByLabelText('Email'), 'ayesha@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText(/If an account uses ayesha@example.com/)).toBeDefined();
    expect(calls.at(-1).body).toEqual({ email: 'ayesha@example.com' });
    expect(router.state.location.pathname).toBe('/forgot-password');
  });
});

describe('reset password', () => {
  it('takes the token from the link, removes it from the address bar, and sets the password', async () => {
    serve({ 'POST /auth/reset-password': () => ok({ reset: true }) });
    const router = renderAt('/reset-password#token=abc-123');
    await screen.findByRole('heading', { name: 'Choose a new password' });
    await vi.waitFor(() => expect(router.state.location.hash).toBe(''));
    await userEvent.type(screen.getByLabelText(/^New password/), 'a new passphrase');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'a new passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Your password was changed')).toBeDefined();
    expect(calls.at(-1).body).toEqual({ token: 'abc-123', newPassword: 'a new passphrase' });
  });

  it('explains a used or expired link and offers a new one', async () => {
    serve({ 'POST /auth/reset-password': () => fail(400, 'INVALID_RESET_TOKEN') });
    renderAt('/reset-password#token=old');
    await userEvent.type(await screen.findByLabelText(/^New password/), 'a new passphrase');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'a new passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('This reset link cannot be used')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Ask for a new link' })).toBeDefined();
  });

  it('says so straight away when the link has no token', async () => {
    serve();
    renderAt('/reset-password');
    expect(await screen.findByText('This reset link cannot be used')).toBeDefined();
    expect(calls).toHaveLength(0);
  });
});

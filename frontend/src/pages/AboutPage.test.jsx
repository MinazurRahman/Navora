import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { clearSession } from '../api/session.js';
import { ToastProvider } from '../components/Toast.jsx';
import { AuthProvider } from '../features/auth/AuthProvider.jsx';
import { createQueryClient } from '../lib/queryClient.js';
import { routes } from '../routes.jsx';
import { mockFetch, page } from '../test/fetchMock.js';

afterEach(() => vi.unstubAllGlobals());

describe('about page', () => {
  it('is linked from the footer and explains moderation and photo credits', async () => {
    clearSession();
    mockFetch(() => page([]));
    const router = createMemoryRouter(routes, { initialEntries: ['/'] });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <AuthProvider>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>,
    );
    await userEvent.click(await screen.findByRole('link', { name: 'About NAVORA' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'About NAVORA' })).toBeDefined();
    expect(screen.getByRole('heading', { name: /How places are checked/ })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Wikimedia Commons' })).toBeDefined();
  });
});

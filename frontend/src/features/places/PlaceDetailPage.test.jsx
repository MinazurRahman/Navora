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
import { fail, mockFetch, ok, place, user } from '../../test/fetchMock.js';

vi.mock('./PlacesMap.jsx', () => ({ default: () => <div>Map</div> }));

const TAGS = [{ slug: 'history', name: 'History' }];
const pageOf = (items) => ok(items, { page: 1, limit: 10, total: items.length, totalPages: 1 });

// A small stateful fake of the API for one place.
function fakeServer({ thePlace = place(), myReview = null, saved = false } = {}) {
  const state = { place: thePlace, myReview, saved, reviews: myReview ? [myReview] : [], calls: [] };
  const fetchMock = mockFetch((path, init) => {
    state.calls.push(`${init.method} ${path}`);
    if (path.endsWith('/auth/me')) return ok({ user });
    if (path.endsWith('/tags')) return ok(TAGS);
    if (path.endsWith('/reviews/mine')) return ok(state.myReview);
    if (path.includes('/reviews') && init.method === 'GET') return pageOf(state.reviews);
    if (path.includes('/reviews') && init.method === 'POST') {
      state.myReview = { id: 'r1', placeId: state.place.id, ...init.body, author: { id: user.id, name: user.name }, createdAt: '2026-10-20T10:00:00Z', updatedAt: '2026-10-20T10:00:00Z' };
      state.reviews = [state.myReview];
      return { status: 201, body: { success: true, data: state.myReview } };
    }
    if (path.includes('/reviews/r1') && init.method === 'PATCH') {
      state.myReview = { ...state.myReview, ...init.body, updatedAt: '2026-10-21T10:00:00Z' };
      state.reviews = [state.myReview];
      return ok(state.myReview);
    }
    if (path.includes('/reviews/r1') && init.method === 'DELETE') {
      state.myReview = null;
      state.reviews = [];
      return ok({ id: 'r1', deleted: true });
    }
    if (path.includes('/saved-places') && init.method === 'GET') return ok({ placeId: state.place.id, saved: state.saved });
    if (path.endsWith('/saved-places') && init.method === 'POST') {
      state.saved = true;
      return ok({ placeId: init.body.placeId, saved: true });
    }
    if (path.includes('/saved-places/') && init.method === 'DELETE') {
      state.saved = false;
      return ok({ placeId: state.place.id, saved: false });
    }
    if (path.includes(`/places/${state.place.id}`)) return ok(state.place);
    return fail(404, 'PLACE_NOT_FOUND');
  });
  return { state, fetchMock };
}

function renderPlace(id = 'p1') {
  const router = createMemoryRouter(routes, { initialEntries: [`/places/${id}`] });
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

const signIn = () => setSession({ accessToken: 'a', refreshToken: 'r', user });

beforeEach(() => clearSession());
afterEach(() => vi.unstubAllGlobals());

describe('place details', () => {
  it('shows the facts, with unknown values stated as unknown', async () => {
    fakeServer({ thePlace: place({ entryFee: null, typicalVisitMinutes: null, openingHours: [] }) });
    renderPlace();
    expect(await screen.findByRole('heading', { level: 1, name: 'Lalbagh Fort' })).toBeDefined();

    const facts = screen.getByRole('complementary', { name: 'Key facts' });
    expect(within(facts).getByText('Entry fee unknown')).toBeDefined();
    expect(within(facts).getByText('Not known')).toBeDefined();
    expect(screen.getByText('Opening hours could not be verified')).toBeDefined();

    const facilities = screen.getByRole('region', { name: 'Facilities' });
    const value = (label) => within(facilities).getByText(label).nextElementSibling.textContent;
    expect(value('Parking')).toBe('Yes');
    expect(value('Pet-friendly')).toBe('No');
    expect(value('Wheelchair accessible')).toBe('Not verified');
    expect(await screen.findByText('History')).toBeDefined();
  });

  it('lists opening hours with closed days', async () => {
    fakeServer({ thePlace: place({ openingHours: [{ dayOfWeek: 1, opensAt: '10:00', closesAt: '17:00' }] }) });
    renderPlace();
    const table = await screen.findByRole('table');
    expect(within(table).getByRole('row', { name: /Monday/ }).textContent).toContain('10:00–17:00');
    expect(within(table).getByRole('row', { name: /Friday/ }).textContent).toContain('Closed');
  });

  it('shows a not-found state for an unknown or hidden place', async () => {
    fakeServer();
    renderPlace('missing');
    expect(await screen.findByRole('heading', { name: 'Place not found' })).toBeDefined();
  });

  it('asks anonymous visitors to sign in to save or review, returning here', async () => {
    fakeServer();
    renderPlace();
    const save = await screen.findByRole('link', { name: 'Sign in to save' });
    expect(save.getAttribute('href')).toBe('/login?next=%2Fplaces%2Fp1');
    const reviews = screen.getByRole('region', { name: /Reviews/ });
    expect(within(reviews).getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/login?next=%2Fplaces%2Fp1');
  });

  it('hides save and reviews on a place that is not approved', async () => {
    signIn();
    fakeServer({ thePlace: place({ status: 'PENDING', createdBy: user.id }) });
    renderPlace();
    expect(await screen.findByText('This place is waiting for moderator review and is not public yet.')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Save place' })).toBeNull();
    expect(screen.queryByRole('heading', { name: /Reviews/ })).toBeNull();
  });
});

describe('saving', () => {
  it('saves and unsaves the place', async () => {
    signIn();
    const { state } = fakeServer();
    renderPlace();
    await userEvent.click(await screen.findByRole('button', { name: 'Save place' }));
    const savedButton = await screen.findByRole('button', { name: 'Saved' });
    expect(savedButton.getAttribute('aria-pressed')).toBe('true');
    expect(state.saved).toBe(true);
    expect(await screen.findByText('Saved to your places.')).toBeDefined();

    await userEvent.click(savedButton);
    expect(await screen.findByRole('button', { name: 'Save place' })).toBeDefined();
    expect(state.saved).toBe(false);
  });
});

describe('reviews', () => {
  it('requires a rating, then posts the review and shows it as yours', async () => {
    signIn();
    const { state } = fakeServer();
    renderPlace();
    await userEvent.click(await screen.findByRole('button', { name: 'Write a review' }));
    await userEvent.click(screen.getByRole('button', { name: 'Post review' }));
    expect(screen.getByText('Choose a rating from 1 to 5.')).toBeDefined();
    expect(state.calls.some((c) => c.startsWith('POST') && c.includes('/reviews'))).toBe(false);

    await userEvent.click(screen.getByRole('radio', { name: '4 stars' }));
    await userEvent.type(screen.getByLabelText(/^Comment/), 'Beautiful gardens');
    await userEvent.click(screen.getByRole('button', { name: 'Post review' }));

    expect(await screen.findByRole('heading', { name: 'Your review' })).toBeDefined();
    expect(state.myReview).toMatchObject({ rating: 4, comment: 'Beautiful gardens' });
    expect(screen.getAllByRole('img', { name: 'Rated 4 out of 5' }).length).toBeGreaterThan(0);
  });

  it('edits and deletes your review after confirmation', async () => {
    signIn();
    const existing = { id: 'r1', placeId: 'p1', rating: 3, comment: 'Fine', author: { id: user.id, name: user.name }, createdAt: '2026-10-20T10:00:00Z', updatedAt: '2026-10-20T10:00:00Z' };
    const { state } = fakeServer({ myReview: existing });
    renderPlace();

    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('radio', { name: '3 stars' }).checked).toBe(true);
    await userEvent.click(screen.getByRole('radio', { name: '5 stars' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Your review was updated.')).toBeDefined();
    expect(state.myReview.rating).toBe(5);

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete your review?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete review' }));
    expect(await screen.findByRole('button', { name: 'Write a review' })).toBeDefined();
    expect(state.myReview).toBeNull();
  });
});

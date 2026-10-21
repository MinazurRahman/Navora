import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { clearSession, setSession } from '../../api/session.js';
import { AuthProvider } from '../auth/AuthProvider.jsx';
import { createQueryClient } from '../../lib/queryClient.js';
import { routes } from '../../routes.jsx';
import { fail, mockFetch, ok, place, user } from '../../test/fetchMock.js';

// Stand-in for the Leaflet picker: one button that picks a point.
vi.mock('./LocationPicker.jsx', () => ({
  default: ({ onChange }) => (
    <button type="button" onClick={() => onChange({ latitude: 23.7104, longitude: 90.4074 })}>
      Pick a point on the map
    </button>
  ),
}));

const TAGS = [
  { slug: 'history', name: 'History' },
  { slug: 'food', name: 'Food' },
];
const CATEGORIES = [{ slug: 'museum', name: 'Museum', description: null }];
const SAVED = [place({ id: 'p1', name: 'Lalbagh Fort' })];

let calls;
function serve({ generate = () => ({ status: 201, body: { success: true, data: { id: 'i1' } } }), createTrip } = {}) {
  calls = [];
  mockFetch((path, init) => {
    calls.push({ method: init.method, path, body: init.body });
    if (path.endsWith('/auth/me')) return ok({ user });
    if (path.endsWith('/tags')) return ok(TAGS);
    if (path.endsWith('/categories')) return ok(CATEGORIES);
    if (path.includes('/saved-places')) return ok(SAVED, { page: 1, limit: 50, total: 1, totalPages: 1 });
    if (path.endsWith('/trips') && init.method === 'POST') {
      return createTrip ? createTrip(init.body) : { status: 201, body: { success: true, data: { id: 't1', ...init.body } } };
    }
    if (path.endsWith('/trips/t1') && init.method === 'PATCH') return ok({ id: 't1', ...init.body });
    if (path.endsWith('/itineraries/generate')) return generate(init.body);
    return ok({});
  });
}

function renderPlan() {
  const router = createMemoryRouter(routes, { initialEntries: ['/plan'] });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return router;
}

const next = () => userEvent.click(screen.getByRole('button', { name: 'Continue' }));
const stepHeading = (name) => screen.findByRole('heading', { level: 2, name });

async function fillBasics() {
  await stepHeading('Where and when');
  await userEvent.type(screen.getByLabelText('Trip name'), 'Old Dhaka weekend');
  await userEvent.click(await screen.findByRole('button', { name: 'Pick a point on the map' }));
  const days = screen.getByLabelText(/^Number of days/);
  await userEvent.clear(days);
  await userEvent.type(days, '3');
}

async function goToReview() {
  await fillBasics();
  await next();
  await stepHeading('Interests');
  await next();
  await stepHeading('Categories and places');
  await next();
  await stepHeading('Travel and budget');
  await next();
  await stepHeading('Requirements');
  await next();
  await stepHeading('Review');
}

beforeEach(() => {
  clearSession();
  setSession({ accessToken: 'a', refreshToken: 'r', user });
});
afterEach(() => vi.unstubAllGlobals());

describe('trip wizard', () => {
  it('checks the first step before moving on', async () => {
    serve();
    renderPlan();
    await stepHeading('Where and when');
    await next();
    expect(screen.getByText('Give your trip a name.')).toBeDefined();
    expect(screen.getByText('Choose where each day starts.')).toBeDefined();
    expect(screen.getByRole('heading', { level: 2, name: 'Where and when' })).toBeDefined();
  });

  it('fills the coordinates from the map pick', async () => {
    serve();
    renderPlan();
    await userEvent.click(await screen.findByRole('button', { name: 'Pick a point on the map' }));
    expect(screen.getByLabelText('Latitude').value).toBe('23.71040');
    expect(screen.getByLabelText('Longitude').value).toBe('90.40740');
  });

  it('keeps answers when going back, then sends the exact trip and opens it', async () => {
    serve();
    const router = renderPlan();
    await fillBasics();
    await next();

    await stepHeading('Interests');
    await userEvent.click(await screen.findByLabelText('History'));
    await next();

    await stepHeading('Categories and places');
    await userEvent.click(await screen.findByLabelText('Museum'));
    await userEvent.click(await screen.findByLabelText('Lalbagh Fort'));
    await next();

    await stepHeading('Travel and budget');
    await userEvent.click(screen.getByLabelText('Walking'));
    await userEvent.type(screen.getByLabelText(/^Budget for entry fees/), '500');
    await userEvent.selectOptions(screen.getByLabelText('Budget is'), 'Per day');
    await next();

    await stepHeading('Requirements');
    await userEvent.click(screen.getByLabelText('Parking required'));

    // Back and forward: earlier answers are still there.
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    await stepHeading('Categories and places');
    expect(screen.getByLabelText('Museum').checked).toBe(true);
    await next();
    await next();
    expect(screen.getByLabelText('Parking required').checked).toBe(true);
    await next();

    await stepHeading('Review');
    const summary = screen.getByRole('region', { name: 'Interests' });
    expect(within(summary).getByText('History')).toBeDefined();
    expect(screen.getByText('BDT 500 per day')).toBeDefined();

    await userEvent.click(screen.getByRole('button', { name: 'Generate itinerary' }));
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/trips/t1'));

    const created = calls.find((c) => c.method === 'POST' && c.path.endsWith('/trips'));
    expect(created.body).toEqual({
      title: 'Old Dhaka weekend',
      startLocation: { latitude: 23.7104, longitude: 90.4074 },
      startAddress: null,
      startDate: null,
      durationDays: 3,
      dailyStartTime: '09:00',
      dailyEndTime: '20:00',
      searchRadiusKm: 10,
      budget: { amount: 500, type: 'per_day' },
      travelMode: 'walking',
      travelingWithPet: false,
      parkingRequired: true,
      wheelchairAccessRequired: false,
      partySize: 1,
      minimumRating: null,
      interests: ['history'],
      preferredCategories: ['museum'],
      selectedPlaceIds: ['p1'],
    });
    expect(calls.find((c) => c.path.endsWith('/itineraries/generate')).body).toEqual({ tripId: 't1' });
  });

  it('explains a failed generation and updates the same trip on retry', async () => {
    let attempts = 0;
    serve({
      generate: () =>
        ++attempts === 1
          ? fail(422, 'INSUFFICIENT_MATCHING_PLACES', {
              details: { emptyDays: [{ dayNumber: 3, date: '2026-10-23' }], suggestions: ['Increase the search radius (currently 10 km)'] },
            })
          : { status: 201, body: { success: true, data: { id: 'i1' } } },
    });
    const router = renderPlan();
    await goToReview();
    await userEvent.click(screen.getByRole('button', { name: 'Generate itinerary' }));

    expect(await screen.findByText('No itinerary could be made with these requirements')).toBeDefined();
    expect(screen.getByText('Increase the search radius (currently 10 km)')).toBeDefined();

    await userEvent.click(screen.getByRole('button', { name: 'Change distance or budget' }));
    await stepHeading('Travel and budget');
    await userEvent.selectOptions(screen.getByLabelText(/^Search distance/), 'Within 20 km');
    await next();
    await next();
    await userEvent.click(await screen.findByRole('button', { name: 'Update and try again' }));
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/trips/t1'));

    expect(calls.filter((c) => c.method === 'POST' && c.path.endsWith('/trips'))).toHaveLength(1);
    expect(calls.find((c) => c.method === 'PATCH').body.searchRadiusKm).toBe(20);
  });

  it('shows server validation errors on the step they belong to', async () => {
    serve({
      createTrip: () =>
        fail(400, 'VALIDATION_ERROR', { details: [{ location: 'body', path: 'title', message: 'Too long' }] }),
    });
    renderPlan();
    await goToReview();
    await userEvent.click(screen.getByRole('button', { name: 'Generate itinerary' }));
    await stepHeading('Where and when');
    expect(screen.getByText('Too long')).toBeDefined();
    expect(screen.getByLabelText('Trip name').getAttribute('aria-invalid')).toBe('true');
  });
});

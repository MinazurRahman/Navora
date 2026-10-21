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
import { fail, mockFetch, ok, user } from '../../test/fetchMock.js';

vi.mock('./ItineraryMap.jsx', () => ({ default: ({ day }) => <div>Map of day {day.dayNumber}</div> }));
vi.mock('../../components/LocationPicker.jsx', () => ({ default: () => <div>Location picker</div> }));

const stopPlace = (id, name) => ({ id, name, category: { slug: 'museum', name: 'Museum' }, location: { latitude: 23.72, longitude: 90.4 } });
const stop = (order, place, extra = {}) => ({
  order,
  place,
  plannedStart: order === 1 ? '09:25' : '11:10',
  plannedEnd: order === 1 ? '10:55' : '12:10',
  visitMinutes: order === 1 ? 90 : 60,
  travelFromPrevious: { minutes: 25, distanceMeters: 4200 },
  estimatedCost: 40,
  openingHoursVerified: true,
  ...extra,
});

const FORT = stopPlace('a', 'Lalbagh Fort');
const MUSEUM = stopPlace('b', 'National Museum');
const MOSQUE = stopPlace('c', 'Star Mosque');

function itinerary(overrides = {}) {
  return {
    id: 'i1',
    tripId: 't1',
    version: 1,
    isCurrent: true,
    userModified: false,
    routing: { provider: 'estimate', algorithm: 'nearest-neighbor+2opt', travelTimesEstimated: true },
    totals: { distanceMeters: 12000, travelMinutes: 70, visitMinutes: 210, plannedMinutes: 400, estimatedCost: 40, currency: 'BDT' },
    days: [
      {
        dayNumber: 1,
        date: '2026-10-24',
        startTime: '09:00',
        endTime: '13:00',
        totals: { distanceMeters: 8000, travelMinutes: 50, visitMinutes: 150, plannedMinutes: 240 },
        routePolyline: null,
        stops: [stop(1, FORT), stop(2, MUSEUM, { estimatedCost: null, openingHoursVerified: false })],
      },
      {
        dayNumber: 2,
        date: '2026-10-25',
        startTime: '09:00',
        endTime: '11:00',
        totals: { distanceMeters: 4000, travelMinutes: 20, visitMinutes: 60, plannedMinutes: 120 },
        routePolyline: null,
        stops: [stop(1, MOSQUE)],
      },
    ],
    warnings: [
      { code: 'TRAVEL_TIMES_ESTIMATED', message: 'Travel times are estimated from distance.' },
      { code: 'OPENING_HOURS_UNVERIFIED', message: 'National Museum: opening hours are unknown.', placeId: 'b', dayNumber: 1 },
      { code: 'ENTRY_FEE_UNKNOWN', message: 'National Museum: entry fee is unknown.', placeId: 'b', dayNumber: 1 },
    ],
    generatedFrom: {},
    createdAt: '2026-10-22T08:00:00Z',
    updatedAt: '2026-10-22T08:00:00Z',
    ...overrides,
  };
}

const TRIP = {
  id: 't1',
  title: 'Old Dhaka weekend',
  startLocation: { latitude: 23.7104, longitude: 90.4074 },
  startAddress: 'Hotel Sonargaon',
  startDate: '2026-10-24',
  durationDays: 2,
  dailyStartTime: '09:00',
  dailyEndTime: '20:00',
  searchRadiusKm: 10,
  budget: null,
  travelMode: 'walking',
  travelingWithPet: false,
  parkingRequired: false,
  wheelchairAccessRequired: false,
  partySize: 2,
  minimumRating: null,
  interests: ['history'],
  preferredCategories: [],
  selectedPlaceIds: [],
  currentItineraryId: 'i1',
  createdAt: '2026-10-22T08:00:00Z',
  updatedAt: '2026-10-22T08:00:00Z',
};

let state;
function serve({ trip = TRIP, plan = itinerary(), assistant = { enabled: false, available: false }, handlers = {} } = {}) {
  state = { trip, plan, calls: [] };
  mockFetch((path, init) => {
    state.calls.push({ method: init.method, path, body: init.body });
    for (const [match, handler] of Object.entries(handlers)) {
      if (`${init.method} ${path}`.includes(match)) return handler(init.body);
    }
    if (path.endsWith('/auth/me')) return ok({ user });
    if (path.endsWith('/ai/trip-assistant/status')) return ok(assistant);
    if (path.endsWith('/trips/t1') && init.method === 'GET') return state.trip ? ok(state.trip) : fail(404, 'TRIP_NOT_FOUND');
    if (path.endsWith('/trips/t1') && init.method === 'DELETE') return ok({ id: 't1', deleted: true });
    if (path.endsWith('/itineraries/i1') && init.method === 'GET') return ok(state.plan);
    if (path.endsWith('/tags') || path.endsWith('/categories')) return ok([]);
    if (path.includes('/saved-places')) return ok([], { page: 1, limit: 50, total: 0, totalPages: 0 });
    return fail(404, 'NOT_FOUND');
  });
}

function renderAt(url = '/trips/t1') {
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

beforeEach(() => {
  clearSession();
  setSession({ accessToken: 'a', refreshToken: 'r', user });
});
afterEach(() => vi.unstubAllGlobals());

describe('trip page', () => {
  it('shows the plan with its warnings, times and honest totals', async () => {
    serve();
    renderAt();
    expect(await screen.findByRole('heading', { level: 1, name: 'Old Dhaka weekend' })).toBeDefined();
    expect(screen.getByText('Saturday 24 October to Sunday 25 October')).toBeDefined();
    expect(screen.getByText('At least BDT 40')).toBeDefined(); // one fee unknown
    expect(screen.getByText(/not a guaranteed shortest one/)).toBeDefined();

    const warnings = screen.getByRole('region', { name: 'Before you go' });
    expect(within(warnings).getByText('National Museum: opening hours are unknown.')).toBeDefined();

    const day1 = screen.getByRole('region', { name: 'Day 1, Saturday 24 October' });
    expect(within(day1).getByText('From start point: 25 min, 4.2 km')).toBeDefined();
    expect(within(day1).getAllByText('(estimated)').length).toBe(2);
    expect(within(day1).getByText('Opening hours not verified')).toBeDefined();
    expect(within(day1).getByText('Entry fee unknown')).toBeDefined();
    expect(within(day1).getByText('Back at the start point by 13:00')).toBeDefined();
  });

  it('calls the fee total unknown when no stop has a known fee', async () => {
    const plan = itinerary();
    plan.totals.estimatedCost = 0;
    for (const d of plan.days) for (const s of d.stops) s.estimatedCost = null;
    serve({ plan });
    renderAt();
    const totals = await screen.findByText('Entry fees');
    expect(totals.nextElementSibling.textContent).toBe('Unknown');
  });

  it('switches between days', async () => {
    serve();
    renderAt();
    await userEvent.click(await screen.findByRole('button', { name: 'Day 2' }));
    expect(screen.getByRole('link', { name: 'Star Mosque' })).toBeDefined();
    expect(screen.queryByRole('link', { name: 'Lalbagh Fort' })).toBeNull();
    expect(screen.getByText('Map of day 2')).toBeDefined();
  });

  it('generates an itinerary for a trip that has none', async () => {
    serve({
      trip: { ...TRIP, currentItineraryId: null },
      handlers: {
        'POST /itineraries/generate': () => {
          state.trip = { ...TRIP };
          return { status: 201, body: { success: true, data: itinerary() } };
        },
      },
    });
    renderAt();
    await userEvent.click(await screen.findByRole('button', { name: 'Generate itinerary' }));
    expect(await screen.findByRole('link', { name: 'Lalbagh Fort' })).toBeDefined();
  });

  it('regenerates a new version', async () => {
    serve({
      handlers: {
        'POST /itineraries/i1/regenerate': () => {
          state.trip = { ...TRIP, currentItineraryId: 'i2' };
          return { status: 201, body: { success: true, data: itinerary({ id: 'i2', version: 2 }) } };
        },
      },
    });
    renderAt();
    await userEvent.click(await screen.findByRole('button', { name: 'Regenerate' }));
    expect(await screen.findByText('Version 2 of your itinerary is ready.')).toBeDefined();
    expect(screen.getByText('Version 2')).toBeDefined();
  });

  it('edits a day: reorders stops and saves through the backend', async () => {
    serve({
      handlers: {
        'PATCH /itineraries/i1': (body) => {
          const plan = itinerary({ userModified: true, updatedAt: '2026-10-22T09:00:00Z' });
          plan.days[0].stops = [stop(1, MUSEUM), stop(2, FORT)];
          state.patched = body;
          return ok(plan);
        },
      },
    });
    renderAt();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit day' }));
    await userEvent.click(screen.getByRole('button', { name: 'Move Lalbagh Fort down' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save day 1' }));
    expect(await screen.findByText('Day 1 was updated and re-scheduled.')).toBeDefined();
    expect(state.patched).toEqual({ days: [{ dayNumber: 1, placeIds: ['b', 'a'], optimizeOrder: false }] });
    expect(screen.getByText('Edited by you')).toBeDefined();
  });

  it('keeps the day unchanged when the backend refuses an edit', async () => {
    serve({
      handlers: {
        'PATCH /itineraries/i1': () => fail(422, 'ITINERARY_DAY_INFEASIBLE', { message: 'Day 1 no longer fits between 09:00 and 13:00' }),
      },
    });
    renderAt();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit day' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove Lalbagh Fort' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save day 1' }));
    expect(await screen.findByText('Day 1 no longer fits between 09:00 and 13:00')).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('link', { name: 'Lalbagh Fort' })).toBeDefined();
  });

  it('deletes the trip after confirmation', async () => {
    serve();
    const router = renderAt();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete trip' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete this trip?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete trip' }));
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/trips'));
    expect(state.calls.some((c) => c.method === 'DELETE' && c.path.endsWith('/trips/t1'))).toBe(true);
  });

  it("answers 404 with a not-found state (another user's trip looks the same)", async () => {
    serve({ trip: null });
    renderAt();
    expect(await screen.findByRole('heading', { name: 'Trip not found' })).toBeDefined();
  });

  it('opens the wizard pre-filled to change settings, saving as a new version', async () => {
    serve({
      handlers: {
        'PATCH /trips/t1': (body) => ok({ ...TRIP, ...body }),
        'POST /itineraries/generate': () => ({ status: 201, body: { success: true, data: itinerary({ id: 'i2', version: 2 }) } }),
      },
    });
    const router = renderAt('/plan?trip=t1');
    expect(await screen.findByRole('heading', { level: 1, name: 'Change trip settings' })).toBeDefined();
    expect(screen.getByLabelText('Trip name').value).toBe('Old Dhaka weekend');
    for (let i = 0; i < 5; i += 1) await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Save and regenerate' }));
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/trips/t1'));
    expect(state.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/trips'))).toHaveLength(0);
    expect(state.calls.find((c) => c.method === 'PATCH').body.travelMode).toBe('walking');
  });
});

describe('AI trip assistant', () => {
  const answer = (extra = {}) =>
    ok({
      task: 'summarize',
      itinerary: { id: 'i1', version: 1, isCurrent: true },
      answer: 'Day 1 covers <b>Old Dhaka</b> landmarks.\nDay 2 is a short visit.',
      truncated: false,
      places: [{ id: 'a', name: 'Lalbagh Fort' }],
      suggestions: [],
      source: { generatedBy: 'ai' },
      disclaimer: "AI-generated explanation of Navora's plan.",
      ...extra,
    });

  it('is hidden when the assistant is switched off', async () => {
    serve({ assistant: { enabled: false, available: false, reason: 'DISABLED' } });
    renderAt();
    await screen.findByRole('heading', { level: 1, name: 'Old Dhaka weekend' });
    await vi.waitFor(() => expect(state.calls.some((c) => c.path.endsWith('/status'))).toBe(true));
    expect(screen.queryByRole('heading', { name: 'Trip assistant' })).toBeNull();
  });

  it('summarises the trip as plain text with the disclaimer', async () => {
    serve({ assistant: { enabled: true, available: true }, handlers: { 'POST /ai/trip-assistant': () => answer() } });
    renderAt();
    await userEvent.click(await screen.findByRole('button', { name: 'Summarise this trip' }));
    const result = await screen.findByRole('article', { name: 'Assistant answer' });
    expect(within(result).getByText('AI-generated')).toBeDefined();
    expect(result.textContent).toContain('<b>Old Dhaka</b>'); // shown as text, not markup
    expect(result.querySelector('b')).toBeNull();
    expect(within(result).getByText("AI-generated explanation of Navora's plan.")).toBeDefined();
    expect(within(result).getByRole('link', { name: 'Lalbagh Fort' }).getAttribute('href')).toBe('/places/a');
    expect(state.calls.find((c) => c.path.endsWith('/ai/trip-assistant')).body).toEqual({ task: 'summarize', itineraryId: 'i1' });
  });

  it('asks a question about one day and shows suggestions as advice', async () => {
    serve({
      assistant: { enabled: true, available: true },
      handlers: {
        'POST /ai/trip-assistant': () =>
          answer({
            task: 'question',
            suggestions: [{ type: 'MOVE_STOP', placeId: 'b', placeName: 'National Museum', dayNumber: 1, targetDayNumber: 2, rationale: 'Day 1 is long.' }],
          }),
      },
    });
    renderAt();
    const ask = await screen.findByRole('button', { name: 'Ask' });
    await userEvent.type(screen.getByLabelText(/^Ask a question/), 'Hi');
    await userEvent.click(ask);
    expect(screen.getByText('Ask a question of at least 3 characters.')).toBeDefined();

    await userEvent.selectOptions(screen.getByLabelText('About'), 'Day 1');
    await userEvent.type(screen.getByLabelText(/^Ask a question/), ' there, why the museum?');
    await userEvent.click(ask);
    expect(await screen.findByText('Suggestions (not applied)')).toBeDefined();
    expect(screen.getByText('Day 1 is long.')).toBeDefined();
    expect(state.calls.find((c) => c.path.endsWith('/ai/trip-assistant')).body).toEqual({
      task: 'question',
      question: 'Hi there, why the museum?',
      itineraryId: 'i1',
      dayNumber: 1,
    });
  });

  it('explains a timeout without breaking the page', async () => {
    serve({
      assistant: { enabled: true, available: true },
      handlers: { 'POST /ai/trip-assistant': () => fail(503, 'AI_UNAVAILABLE', { details: { reason: 'TIMEOUT' } }) },
    });
    renderAt();
    await userEvent.click(await screen.findByRole('button', { name: 'Why this plan?' }));
    expect(await screen.findByText(/took too long to answer/)).toBeDefined();
    expect(screen.getByRole('link', { name: 'Lalbagh Fort' })).toBeDefined();
  });

  it('says when the assistant is on but unreachable', async () => {
    serve({ assistant: { enabled: true, available: false, reason: 'UNAVAILABLE' } });
    renderAt();
    expect(await screen.findByText('The assistant is temporarily unavailable. Your itinerary is not affected.')).toBeDefined();
  });
});

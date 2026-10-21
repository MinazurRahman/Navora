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

vi.mock('../../components/LocationPicker.jsx', () => ({
  default: ({ onChange }) => (
    <button type="button" onClick={() => onChange({ latitude: 23.7154, longitude: 90.4011 })}>
      Pick on map
    </button>
  ),
}));

const CATEGORIES = [{ slug: 'religious_site', name: 'Religious Site', description: null }];
const TAGS = [{ slug: 'history', name: 'History' }];
const pageOf = (items) => ok(items, { page: 1, limit: 20, total: items.length, totalPages: 1 });

let calls;
function serve(handlers = {}, who = user) {
  calls = [];
  mockFetch((path, init) => {
    calls.push({ method: init.method, path, body: init.body });
    for (const [match, handler] of Object.entries(handlers)) {
      if (`${init.method} ${path}`.startsWith(match)) return handler(init.body, path);
    }
    if (path.endsWith('/auth/me')) return ok({ user: who });
    if (path.endsWith('/categories')) return ok(CATEGORIES);
    if (path.endsWith('/tags')) return ok(TAGS);
    return pageOf([]);
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

const signInAs = (role = 'user') => {
  const who = { ...user, role };
  setSession({ accessToken: 'a', refreshToken: 'r', user: who });
  return who;
};
const callTo = (method, ending) => calls.find((c) => c.method === method && c.path.split('?')[0].endsWith(ending));

beforeEach(() => clearSession());
afterEach(() => vi.unstubAllGlobals());

describe('community feed', () => {
  it('lists approved places and links to suggesting one', async () => {
    serve({ 'GET /places?': () => pageOf([place()]) });
    renderAt('/community');
    expect(await screen.findByRole('link', { name: 'Lalbagh Fort' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Suggest a place' }).getAttribute('href')).toBe('/community/submit');
  });
});

describe('suggest a place', () => {
  it('checks required fields, then sends the place with unknown values kept unknown', async () => {
    signInAs();
    serve({ 'POST /places': (body) => ({ status: 201, body: { success: true, data: place({ ...body, id: 'new', status: 'PENDING', category: CATEGORIES[0] }) } }) });
    const router = renderAt('/community/submit');

    const submit = await screen.findByRole('button', { name: 'Submit for review' });
    await userEvent.click(submit);
    expect(screen.getByText('Enter the place name.')).toBeDefined();
    expect(screen.getByText('Choose a category.')).toBeDefined();
    expect(callTo('POST', '/places')).toBeUndefined();

    await userEvent.type(screen.getByLabelText('Name'), 'Star Mosque');
    await userEvent.selectOptions(await screen.findByLabelText('Category'), 'Religious Site');
    await userEvent.click(screen.getByRole('button', { name: 'Pick on map' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Free' }));
    const parking = screen.getByRole('group', { name: 'Parking' });
    await userEvent.click(within(parking).getByRole('radio', { name: 'Yes' }));
    await userEvent.click(screen.getByRole('radio', { name: 'I know the hours' }));
    await userEvent.click(screen.getByRole('button', { name: 'Set Friday hours' }));
    await userEvent.click(submit);

    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/community/mine'));
    expect(callTo('POST', '/places').body).toEqual({
      name: 'Star Mosque',
      description: null,
      category: 'religious_site',
      location: { latitude: 23.7154, longitude: 90.4011 },
      address: null,
      city: 'Dhaka',
      entryFee: 0,
      typicalVisitMinutes: null,
      parkingAvailable: 'YES',
      petFriendly: 'UNKNOWN',
      wheelchairAccessible: 'UNKNOWN',
      accessibilityNotes: null,
      restrictions: null,
      tags: [],
      openingHours: [{ dayOfWeek: 5, opensAt: '09:00', closesAt: '17:00' }],
    });
    expect(await screen.findByText('Thank you. Your place was submitted for review.')).toBeDefined();
  });

  it('shows server validation errors beside the field', async () => {
    signInAs();
    serve({ 'POST /places': () => fail(400, 'VALIDATION_ERROR', { details: [{ location: 'body', path: 'name', message: 'Too long' }] }) });
    renderAt('/community/submit');
    await userEvent.type(await screen.findByLabelText('Name'), 'X');
    await userEvent.selectOptions(await screen.findByLabelText('Category'), 'Religious Site');
    await userEvent.click(screen.getByRole('button', { name: 'Pick on map' }));
    await userEvent.click(screen.getByRole('button', { name: 'Submit for review' }));
    expect(await screen.findByText('Too long')).toBeDefined();
    expect(screen.getByLabelText('Name').getAttribute('aria-invalid')).toBe('true');
  });

  it('tells moderators their places are published straight away', async () => {
    signInAs('moderator');
    serve({}, { ...user, role: 'moderator' });
    renderAt('/community/submit');
    expect(await screen.findByRole('button', { name: 'Publish place' })).toBeDefined();
  });
});

describe('my submissions', () => {
  it('shows status, the rejection reason, and withdraws after confirmation', async () => {
    signInAs();
    serve({
      'GET /places/mine': () =>
        pageOf([place({ id: 'p1', name: 'Pending gallery', status: 'PENDING' }), place({ id: 'p2', name: 'Old shop', status: 'REJECTED' })]),
      'GET /places/p2/moderation-events': () =>
        ok([
          { action: 'SUBMITTED', fromStatus: null, toStatus: 'PENDING', note: null, createdAt: '2026-10-20T10:00:00Z' },
          { action: 'REJECTED', fromStatus: 'PENDING', toStatus: 'REJECTED', note: 'The pin is on the wrong street', createdAt: '2026-10-21T10:00:00Z' },
        ]),
      'DELETE /places/p1': () => ok(place({ id: 'p1', name: 'Pending gallery', status: 'ARCHIVED' })),
    });
    renderAt('/community/mine');

    const rejected = (await screen.findByRole('link', { name: 'Old shop' })).closest('li');
    expect(within(rejected).getByText('Rejected')).toBeDefined();
    expect(await within(rejected).findByText('The pin is on the wrong street')).toBeDefined();
    expect(within(rejected).getByRole('link', { name: 'Edit and resubmit' }).getAttribute('href')).toBe('/community/p2/edit');

    const pending = screen.getByRole('link', { name: 'Pending gallery' }).closest('li');
    await userEvent.click(within(pending).getByRole('button', { name: 'Withdraw' }));
    const dialog = screen.getByRole('dialog', { name: 'Withdraw this suggestion?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Withdraw' }));
    expect(await screen.findByText('Pending gallery was withdrawn.')).toBeDefined();
    expect(callTo('DELETE', '/places/p1')).toBeDefined();
  });
});

describe('editing a submission', () => {
  it('resubmits a rejected place after showing why it was rejected', async () => {
    const who = signInAs();
    serve({
      'GET /places/p2/moderation-events': () => ok([{ action: 'REJECTED', fromStatus: 'PENDING', toStatus: 'REJECTED', note: 'Add the opening hours', createdAt: '2026-10-21T10:00:00Z' }]),
      'GET /places/p2': () => ok(place({ id: 'p2', name: 'Old shop', status: 'REJECTED', createdBy: who.id })),
      'PATCH /places/p2': (body) => ok(place({ ...body, id: 'p2', status: 'PENDING', category: CATEGORIES[0] })),
    });
    const router = renderAt('/community/p2/edit');
    expect(await screen.findByText('Add the opening hours')).toBeDefined();
    expect(screen.getByLabelText('Name').value).toBe('Old shop');
    await userEvent.click(screen.getByRole('button', { name: 'Save and resubmit' }));
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/community/mine'));
    expect(callTo('PATCH', '/places/p2').body.name).toBe('Old shop');
    expect(await screen.findByText('Your changes were saved and sent for review again.')).toBeDefined();
  });

  it('does not offer editing an approved place to its submitter', async () => {
    const who = signInAs();
    serve({ 'GET /places/p3': () => ok(place({ id: 'p3', status: 'APPROVED', createdBy: who.id })) });
    renderAt('/community/p3/edit');
    expect(await screen.findByRole('heading', { name: 'This place cannot be edited' })).toBeDefined();
    expect(screen.getByText('Approved places can only be changed by moderators.')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
  });
});

describe('moderation', () => {
  beforeEach(() => signInAs('moderator'));

  const queueHandlers = (extra = {}) => ({
    'GET /places/moderation': () => pageOf([place({ id: 'q1', name: 'Star Mosque', status: 'PENDING' })]),
    ...extra,
  });

  it('approves with an optional note', async () => {
    serve(queueHandlers({ 'POST /places/q1/approve': () => ok(place({ id: 'q1', name: 'Star Mosque' })) }), { ...user, role: 'moderator' });
    renderAt('/moderation');
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    const dialog = screen.getByRole('dialog', { name: 'Approve Star Mosque?' });
    await userEvent.type(within(dialog).getByLabelText(/^Note/), 'Verified on site');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Star Mosque was approved.')).toBeDefined();
    expect(callTo('POST', '/places/q1/approve').body).toEqual({ note: 'Verified on site' });
  });

  it('requires a reason to reject', async () => {
    serve(queueHandlers({ 'POST /places/q1/reject': () => ok(place({ id: 'q1', name: 'Star Mosque', status: 'REJECTED' })) }), { ...user, role: 'moderator' });
    renderAt('/moderation');
    await userEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    const dialog = screen.getByRole('dialog', { name: 'Reject Star Mosque?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
    expect(within(dialog).getByText('Tell the submitter why, so they can fix it.')).toBeDefined();
    expect(callTo('POST', '/places/q1/reject')).toBeUndefined();

    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Duplicate of Tara Masjid');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
    expect(await screen.findByText('Star Mosque was rejected.')).toBeDefined();
    expect(callTo('POST', '/places/q1/reject').body).toEqual({ reason: 'Duplicate of Tara Masjid' });
  });
});

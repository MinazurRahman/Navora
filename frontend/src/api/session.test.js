import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fail, mockFetch, ok, sessionData, user } from '../test/fetchMock.js';
import { logout, request } from './client.js';
import { clearSession, getEndedReason, getSession, rotateSession, setSession, subscribe } from './session.js';

// Another browser tab, as seen by this one: the same BroadcastChannel name.
let otherTab;
const nextMessage = () => new Promise((resolve) => (otherTab.onmessage = ({ data }) => resolve(data)));
const sessionChange = () => new Promise((resolve) => {
  const stop = subscribe(() => {
    stop();
    resolve(getSession());
  });
});

const tokens = (n) => ({ accessToken: `a${n}`, refreshToken: `r${n}`, user });

beforeEach(() => {
  clearSession();
  otherTab = new BroadcastChannel('navora-session');
});
afterEach(() => {
  otherTab.close();
  vi.unstubAllGlobals();
});

describe('session sharing between duplicated tabs', () => {
  it('adopts tokens another tab rotated from the same refresh token', async () => {
    setSession(tokens(1));
    const changed = sessionChange();
    otherTab.postMessage({ type: 'rotated', previous: 'r1', session: tokens(2) });
    expect(await changed).toEqual(tokens(2));
  });

  it('ignores rotations and sign-outs of unrelated sessions', async () => {
    setSession(tokens(1));
    otherTab.postMessage({ type: 'rotated', previous: 'someone-else', session: tokens(9) });
    otherTab.postMessage({ type: 'ended', refreshToken: 'someone-else', reason: 'signed-out' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getSession()).toEqual(tokens(1));
  });

  it('signs out when a tab sharing the session signs out', async () => {
    setSession(tokens(1));
    const changed = sessionChange();
    otherTab.postMessage({ type: 'ended', refreshToken: 'r1', reason: 'signed-out' });
    expect(await changed).toBeNull();
    expect(getEndedReason()).toBe('signed-out');
  });

  it('tells other tabs about its own rotations and sign-outs', async () => {
    setSession(tokens(1));
    let message = nextMessage();
    rotateSession(tokens(2));
    expect(await message).toEqual({ type: 'rotated', previous: 'r1', session: tokens(2) });
    message = nextMessage();
    clearSession({ reason: 'expired' });
    expect(await message).toEqual({ type: 'ended', refreshToken: 'r2', reason: 'expired' });
  });

  it('does not refresh (replaying a used token) when another tab already did', async () => {
    setSession(tokens(1));
    const seen = [];
    mockFetch((path, init) => {
      seen.push(`${path} ${init.headers.Authorization ?? ''}`);
      if (path.endsWith('/auth/refresh')) return ok(sessionData('a-from-us', 'r-from-us'));
      if (init.headers.Authorization === 'Bearer a1') {
        // The other tab refreshed with r1 at the same moment and broadcasts its new tokens.
        otherTab.postMessage({ type: 'rotated', previous: 'r1', session: tokens(2) });
        return fail(401, 'TOKEN_EXPIRED');
      }
      return ok({ ok: true });
    });
    await request('/trips');
    expect(seen.some((s) => s.includes('/auth/refresh'))).toBe(false);
    expect(seen.at(-1)).toBe('/trips Bearer a2');
    expect(getSession()).toEqual(tokens(2));
  });
});

describe('refresh across tabs', () => {
  it('runs inside a Web Lock shared by all tabs of the site', async () => {
    const locks = { request: vi.fn((name, work) => work()) };
    vi.stubGlobal('navigator', { ...navigator, locks });
    setSession(tokens(1));
    mockFetch((path, init) => {
      if (path.endsWith('/auth/refresh')) return ok(sessionData('a2', 'r2'));
      return init.headers.Authorization === 'Bearer a2' ? ok({}) : fail(401, 'TOKEN_EXPIRED');
    });
    await request('/trips');
    expect(locks.request).toHaveBeenCalledWith('navora-token-refresh', expect.any(Function));
    expect(getSession()).toMatchObject({ accessToken: 'a2', refreshToken: 'r2' });
  });
});

describe('why a session ended', () => {
  it('is "expired" when the server rejects the refresh token', async () => {
    setSession(tokens(1));
    mockFetch((path) => (path.endsWith('/auth/refresh') ? fail(401, 'INVALID_REFRESH_TOKEN') : fail(401, 'TOKEN_EXPIRED')));
    await expect(request('/trips')).rejects.toMatchObject({ code: 'INVALID_REFRESH_TOKEN' });
    expect(getEndedReason()).toBe('expired');
  });

  it('is "signed-out" after logging out, and cleared by the next sign-in', async () => {
    setSession(tokens(1));
    mockFetch(() => ok({ loggedOut: true }));
    await logout();
    expect(getEndedReason()).toBe('signed-out');
    setSession(tokens(2));
    expect(getEndedReason()).toBeNull();
  });
});

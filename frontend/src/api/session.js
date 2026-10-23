// The signed-in session: { accessToken, refreshToken, user }.
//
// Storage: sessionStorage keeps it across reloads of this tab and drops it when the tab
// closes. The backend sends tokens in JSON (no cookies), so the client must keep them
// somewhere; this avoids a long-lived refresh token in localStorage. Never render community
// text as HTML: any script on the page could read this.
//
// It is also a tiny external store (subscribe/getSession) so React re-renders when the API
// client refreshes or ends the session.
//
// Duplicated tabs: duplicating a tab copies its sessionStorage, so both tabs hold the same
// single-use refresh token. Tabs therefore tell each other about rotations and sign-outs over
// a BroadcastChannel, but only tabs holding the same refresh token act on a message; an
// unrelated session in another tab is never touched.
const KEY = 'navora.session';
const listeners = new Set();
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('navora-session');

function load() {
  try {
    const session = JSON.parse(sessionStorage.getItem(KEY));
    return session?.accessToken && session?.refreshToken && session?.user ? session : null;
  } catch {
    return null;
  }
}

let current = load();
// Why the last session ended: 'expired' (the server ended it) or 'signed-out'. Lets the UI
// explain an unexpected sign-out. Cleared by a new session or dismissEndedReason().
let endedReason = null;

function emit() {
  listeners.forEach((listener) => listener());
}

function store(session) {
  current = session;
  endedReason = null;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // Storage blocked (private mode, quota): the session lasts until reload.
  }
  emit();
}

function end(reason) {
  if (!current) return;
  current = null;
  endedReason = reason;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing stored.
  }
  emit();
}

export function getSession() {
  return current;
}

export function getEndedReason() {
  return endedReason;
}

export function dismissEndedReason() {
  if (endedReason === null) return;
  endedReason = null;
  emit();
}

// A new session (sign-in, registration). Unrelated to other tabs.
export function setSession(session) {
  store(session);
}

// A refresh replaced this tab's tokens; tabs that still hold the old refresh token take the
// new ones instead of refreshing (and replaying a used token) themselves.
export function rotateSession(next) {
  const previous = current?.refreshToken;
  store(next);
  channel?.postMessage({ type: 'rotated', previous, session: next });
}

// reason: 'expired' when the server rejected the session, 'signed-out' when the user left.
export function clearSession({ reason = 'signed-out' } = {}) {
  const refreshToken = current?.refreshToken;
  end(reason);
  if (refreshToken) channel?.postMessage({ type: 'ended', refreshToken, reason });
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

if (channel) {
  channel.onmessage = ({ data }) => {
    if (!current || !data) return;
    if (data.type === 'rotated' && data.previous === current.refreshToken) store(data.session);
    if (data.type === 'ended' && data.refreshToken === current.refreshToken) end(data.reason);
  };
}

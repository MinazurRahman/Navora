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
// ponytail: a duplicated browser tab copies sessionStorage, so both tabs hold the same
// single-use refresh token; whichever refreshes second replays it and the backend ends the
// whole session (sign in again). Coordinate tabs with BroadcastChannel if that becomes common.
const KEY = 'navora.session';
const listeners = new Set();

function load() {
  try {
    const session = JSON.parse(sessionStorage.getItem(KEY));
    return session?.accessToken && session?.refreshToken && session?.user ? session : null;
  } catch {
    return null;
  }
}

let current = load();

function emit() {
  listeners.forEach((listener) => listener());
}

export function getSession() {
  return current;
}

export function setSession(session) {
  current = session;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // Storage blocked (private mode, quota): the session lasts until reload.
  }
  emit();
}

export function clearSession() {
  if (!current) return;
  current = null;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing stored.
  }
  emit();
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}


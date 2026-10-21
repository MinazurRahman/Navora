// The signed-in session: { accessToken, refreshToken, user }.
// sessionStorage keeps it across reloads of this tab and drops it when the tab closes.
// The backend sends tokens in JSON (no cookies), so the client must keep them somewhere;
// this avoids a long-lived refresh token in localStorage. Never render community text as
// HTML: any script on the page could read this.
const KEY = 'navora.session';

export function readSession() {
  try {
    const session = JSON.parse(sessionStorage.getItem(KEY));
    return session?.accessToken && session?.refreshToken && session?.user ? session : null;
  } catch {
    return null;
  }
}

export function writeSession(session) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // Storage blocked (private mode, quota): the session lasts until reload.
  }
}

export function clearSession() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing stored.
  }
}

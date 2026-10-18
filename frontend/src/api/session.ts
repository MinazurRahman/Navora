// The signed-in session: tokens + user, shared by every tab.
//
// Rules from the backend (CONTRIBUTING.md → Frontend team, openapi.yaml intro):
// - access tokens last 15 minutes; on 401 TOKEN_EXPIRED call POST /auth/refresh and retry;
// - each refresh token works ONCE — always store the new one;
// - replaying a used refresh token ends the whole session, so tabs must share ONE refresh call.
//
// Storage: localStorage, so a session survives reloads and is visible to other tabs.
// Trade-off: any script running on the page could read it, so never render untrusted HTML
// (React escapes text by default — do not use dangerouslySetInnerHTML with community text).

import type { User } from './types';
import { apiUrl } from './url';

const STORAGE_KEY = 'navora.session';
const REFRESH_LOCK = 'navora-token-refresh';

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  user: User;
}

type Listener = () => void;
const listeners = new Set<Listener>();

function readStorage(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    return parsed?.accessToken && parsed?.refreshToken && parsed?.user ? parsed : null;
  } catch {
    return null;
  }
}

let current: StoredSession | null = readStorage();

function emit() {
  for (const listener of listeners) listener();
}

export function getSession(): StoredSession | null {
  return current;
}

export function setSession(next: StoredSession | null) {
  current = next;
  try {
    if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be unavailable (private mode, blocked site data); the session then lasts this tab only.
  }
  emit();
}

export function updateSessionUser(user: User) {
  if (current) setSession({ ...current, user });
}

export function subscribeSession(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Another tab signed in, out, or refreshed: pick up its tokens.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    current = readStorage();
    emit();
  });
}

let inFlight: Promise<StoredSession | null> | null = null;

/**
 * Exchanges the refresh token for new tokens. Concurrent callers in this tab share one
 * request, and the Web Locks API makes other tabs wait, then reuse the tokens this tab got.
 * Resolves to null when the session is over (the caller should treat the user as signed out).
 */
export function refreshSession(staleAccessToken: string): Promise<StoredSession | null> {
  if (!inFlight) {
    inFlight = runExclusive(() => doRefresh(staleAccessToken)).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

function runExclusive<T>(work: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    return new Promise<T>((resolve, reject) => {
      navigator.locks
        .request(REFRESH_LOCK, async () => {
          try {
            resolve(await work());
          } catch (error) {
            reject(error);
          }
        })
        .catch(reject);
    });
  }
  return work();
}

async function doRefresh(staleAccessToken: string): Promise<StoredSession | null> {
  // Another tab may have refreshed while we waited for the lock: reuse its tokens.
  const latest = readStorage() ?? current;
  if (!latest) return null;
  if (latest.accessToken !== staleAccessToken) {
    current = latest;
    emit();
    return latest;
  }

  let response: Response;
  try {
    response = await fetch(apiUrl('/api/v1/auth/refresh'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: latest.refreshToken }),
    });
  } catch {
    return null; // offline: keep the stored session, the request just fails
  }

  const body = await response.json().catch(() => null);
  if (response.ok && body?.success) {
    const next: StoredSession = {
      accessToken: body.data.tokens.accessToken,
      refreshToken: body.data.tokens.refreshToken,
      user: body.data.user,
    };
    setSession(next);
    return next;
  }
  // 401 INVALID_REFRESH_TOKEN (expired, used, revoked): the session is over.
  if (response.status === 401 || response.status === 400) setSession(null);
  return null;
}

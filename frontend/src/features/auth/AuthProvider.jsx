import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { dismissEndedReason, getEndedReason, getSession, setSession, subscribe } from '../../api/session.js';
import { getMe, logout } from './api.js';
import { AuthContext } from './useAuth.js';

// Session state for the whole app. The API client refreshes or ends the session on its own;
// this re-renders whenever it does.
export function AuthProvider({ children }) {
  const session = useSyncExternalStore(subscribe, getSession);
  const endedReason = useSyncExternalStore(subscribe, getEndedReason);
  const queryClient = useQueryClient();
  // A session restored from storage is checked with the server before private pages render.
  const [checking, setChecking] = useState(() => getSession() !== null);

  useEffect(() => {
    if (!checking) return undefined;
    const controller = new AbortController();
    getMe({ signal: controller.signal })
      .then((user) => {
        const current = getSession();
        if (current) setSession({ ...current, user });
      })
      // A rejected session is already cleared by the client; other failures (offline)
      // keep the stored session, and the next request will tell.
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false);
      });
    return () => controller.abort();
  }, [checking]);

  // Never show one user's cached data to another: drop the cache whenever the signed-in
  // user changes (sign in, sign out, session ended by the server).
  useEffect(() => {
    let userId = getSession()?.user.id ?? null;
    return subscribe(() => {
      const nextId = getSession()?.user.id ?? null;
      if (nextId !== userId) queryClient.clear();
      userId = nextId;
    });
  }, [queryClient]);

  const value = useMemo(
    () => ({
      status: !session ? 'anonymous' : checking ? 'loading' : 'authenticated',
      user: session?.user ?? null,
      signOut: logout,
      // 'expired' when the server ended the session (not the user): the UI explains it.
      sessionExpired: !session && endedReason === 'expired',
      dismissSessionExpired: dismissEndedReason,
    }),
    [session, checking, endedReason],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { authApi } from '../api/endpoints';
import { getSession, setSession, subscribeSession, updateSessionUser } from '../api/session';
import type { Session, User } from '../api/types';

interface AuthValue {
  user: User | null;
  isModerator: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (name: string, email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

function store(session: Session) {
  setSession({ accessToken: session.tokens.accessToken, refreshToken: session.tokens.refreshToken, user: session.user });
  return session.user;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const session = useSyncExternalStore(subscribeSession, getSession, getSession);
  const user = session?.user ?? null;

  // Refresh the stored user once per load (e.g. a role changed to moderator since last visit).
  useEffect(() => {
    if (!getSession()) return;
    authApi
      .me()
      .then(updateSessionUser)
      .catch(() => {
        /* the API client already signs out on an unusable session */
      });
  }, []);

  const login = useCallback(async (email: string, password: string) => store(await authApi.login({ email, password })), []);
  const register = useCallback(
    async (name: string, email: string, password: string) => store(await authApi.register({ name, email, password })),
    [],
  );
  const logout = useCallback(async () => {
    const current = getSession();
    setSession(null); // forget tokens first: the access token stays valid ≤ 15 min server-side
    if (current) await authApi.logout(current.refreshToken).catch(() => undefined);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      isModerator: user?.role === 'moderator' || user?.role === 'admin',
      login,
      register,
      logout,
    }),
    [user, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}

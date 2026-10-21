import { useCallback, useMemo, useState } from 'react';
import { clearSession, readSession } from '../../api/session.js';
import { AuthContext } from './useAuth.js';

// Phase 3: reads the stored session only. Phase 4 adds sign-in, verifying the stored
// session with GET /auth/me (status 'loading' until then), token refresh and server logout.
export function AuthProvider({ children }) {
  const [session, setSession] = useState(readSession);

  const signOut = useCallback(() => {
    clearSession();
    setSession(null);
  }, []);

  const value = useMemo(
    () => ({
      status: session ? 'authenticated' : 'anonymous',
      user: session?.user ?? null,
      signOut,
    }),
    [session, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

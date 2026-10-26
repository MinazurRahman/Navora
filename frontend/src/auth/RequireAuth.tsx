import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from './AuthContext';

/** Sends signed-out visitors to the sign-in page, then back here afterwards. */
export function RequireAuth({ children, moderator = false }: { children: ReactNode; moderator?: boolean }) {
  const { user, isModerator } = useAuth();
  const location = useLocation();

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  if (moderator && !isModerator) {
    return (
      <div className="page narrow">
        <h1>Moderators only</h1>
        <p className="muted">This page is for Navora moderators. Ask an admin if you need access.</p>
      </div>
    );
  }
  return <>{children}</>;
}

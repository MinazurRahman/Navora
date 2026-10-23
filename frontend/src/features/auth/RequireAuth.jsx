import { Navigate, Outlet, useLocation } from 'react-router';
import { ShieldAlert } from 'lucide-react';
import { EmptyState } from '../../components/Feedback.jsx';
import { PageLoading } from '../../components/PageLoading.jsx';
import { useAuth } from './useAuth.js';

// Route guard for private pages. This is for usability only: the backend enforces
// authentication and roles on every request.
export function RequireAuth({ roles }) {
  const { status, user } = useAuth();
  const location = useLocation();

  // Render nothing private until the session is known, so protected content never flashes.
  if (status === 'loading') return <PageLoading />;

  if (status === 'anonymous') {
    const next = location.pathname + location.search;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }

  if (roles && !roles.includes(user.role)) {
    return (
      <main className="container">
        <title>No access | NAVORA</title>
        <EmptyState
          headingLevel={1}
          icon={ShieldAlert}
          title="You do not have access to this page"
          description="This page is only available to moderators."
        />
      </main>
    );
  }

  return <Outlet />;
}

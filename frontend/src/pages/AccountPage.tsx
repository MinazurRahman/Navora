import { Link } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { formatTimestamp } from '../lib/format';

export function AccountPage() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <div className="page narrow">
      <h1>Your account</h1>
      <dl className="facts facts--stacked">
        <div>
          <dt>Name</dt>
          <dd>{user.name}</dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>{user.email}</dd>
        </div>
        <div>
          <dt>Role</dt>
          <dd>{user.role.charAt(0).toUpperCase() + user.role.slice(1)}</dd>
        </div>
        <div>
          <dt>Member since</dt>
          <dd>{formatTimestamp(user.createdAt)}</dd>
        </div>
      </dl>
      <p className="fine">Editing your profile is not available yet.</p>
      <div className="row">
        <Link to="/trips" className="btn btn--ghost">
          My trips
        </Link>
        <Link to="/my-places" className="btn btn--ghost">
          My submissions
        </Link>
      </div>
    </div>
  );
}

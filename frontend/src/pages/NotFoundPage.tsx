import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <div className="page narrow">
      <h1>This page does not exist</h1>
      <p className="muted">
        Check the address, or go back to <Link to="/">discovering places</Link>.
      </p>
    </div>
  );
}

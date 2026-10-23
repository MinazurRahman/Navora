import { Link, isRouteErrorResponse, useRouteError } from 'react-router';
import { Compass, TriangleAlert } from 'lucide-react';
import { Button } from '../components/Button.jsx';
import { EmptyState } from '../components/Feedback.jsx';
import { Logo } from '../components/Logo.jsx';
import styles from './StatusPages.module.css';

export function NotFoundPage() {
  return (
    <main className="container">
      <title>Page not found | NAVORA</title>
      <EmptyState
        icon={Compass}
        title="Page not found"
        description="The page you are looking for does not exist or has moved."
        action={
          <Button as={Link} to="/explore">
            Explore places
          </Button>
        }
      />
    </main>
  );
}

// Last-resort screen for an unexpected rendering error. Rendered outside the app shell,
// because the shell itself may be what failed.
export function RouteErrorPage() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />;
  if (import.meta.env.DEV) console.error(error);

  return (
    <main className={`container ${styles.errorPage}`}>
      <title>Something went wrong | NAVORA</title>
      <a href="/" className={styles.errorLogo} aria-label="NAVORA home">
        <Logo />
      </a>
      <EmptyState
        icon={TriangleAlert}
        title="Something went wrong"
        description="The page could not be displayed. Reload to try again."
        action={<Button onClick={() => window.location.reload()}>Reload page</Button>}
      />
    </main>
  );
}

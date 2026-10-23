import { RotateCw } from 'lucide-react';
import { errorMessage } from '../lib/errors.js';
import { Button } from './Button.jsx';
import { Alert } from './Feedback.jsx';

// A failed load: what happened, a retry, and the request id for bug reports.
export function ErrorState({ error, onRetry, title = 'Could not load this content' }) {
  return (
    <Alert
      tone="danger"
      title={title}
      action={
        onRetry && (
          <Button variant="secondary" size="sm" icon={RotateCw} onClick={onRetry}>
            Try again
          </Button>
        )
      }
    >
      <p>{errorMessage(error)}</p>
      {error?.requestId && <p className="muted">Reference: {error.requestId}</p>}
    </Alert>
  );
}

// An action that failed (a form or button), shown inline. Server-side failures carry the
// request reference so the user can quote it; expected business errors stay uncluttered.
export function ErrorAlert({ error, message = errorMessage(error) }) {
  return (
    <Alert tone="danger">
      <p>{message}</p>
      {error?.status >= 500 && error.requestId && <p className="muted">Reference: {error.requestId}</p>}
    </Alert>
  );
}

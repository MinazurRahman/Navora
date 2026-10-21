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

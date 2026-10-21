import { Link, useLocation } from 'react-router';
import { Bookmark, BookmarkCheck } from 'lucide-react';
import { Button } from '../../components/Button.jsx';
import { useToast } from '../../components/useToast.js';
import { errorMessage } from '../../lib/errors.js';
import { useAuth } from '../auth/useAuth.js';
import { useSavedStatus, useToggleSaved } from './api.js';

// Save / unsave an approved place. Signed-out visitors are sent to sign in and back.
export function SaveButton({ placeId }) {
  const { status } = useAuth();
  const location = useLocation();
  const toast = useToast();
  const saved = useSavedStatus(placeId, { enabled: status === 'authenticated' });
  const toggle = useToggleSaved(placeId);

  if (status !== 'authenticated') {
    const next = encodeURIComponent(location.pathname);
    return (
      <Button as={Link} to={`/login?next=${next}`} variant="secondary" icon={Bookmark}>
        Sign in to save
      </Button>
    );
  }

  const isSaved = saved.data?.saved === true;
  return (
    <Button
      variant="secondary"
      icon={isSaved ? BookmarkCheck : Bookmark}
      aria-pressed={isSaved}
      loading={saved.isPending || toggle.isPending}
      onClick={() =>
        toggle.mutate(!isSaved, {
          onSuccess: ({ saved: nowSaved }) =>
            toast.show({ tone: 'success', message: nowSaved ? 'Saved to your places.' : 'Removed from your saved places.' }),
          onError: (error) => toast.show({ tone: 'danger', message: errorMessage(error) }),
        })
      }
    >
      {isSaved ? 'Saved' : 'Save place'}
    </Button>
  );
}

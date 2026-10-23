import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, Trash2 } from 'lucide-react';
import { Badge } from '../../components/Badge.jsx';
import { Button, IconButton } from '../../components/Button.jsx';
import { Dialog } from '../../components/Dialog.jsx';
import { ErrorAlert } from '../../components/ErrorState.jsx';
import { Skeleton } from '../../components/Feedback.jsx';
import { useToast } from '../../components/useToast.js';
import { deleteItinerary, listItineraries } from './api.js';
import styles from './VersionHistory.module.css';

const createdFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Dhaka' });

// Every version of the trip's itinerary: view an older one (read-only) or delete one.
// onDeleted(id) lets the page leave a version that no longer exists.
export function VersionHistory({ tripId, viewingId, onDeleted }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [deleting, setDeleting] = useState(null);
  const versions = useQuery({ queryKey: ['itineraries', 'versions', tripId], queryFn: ({ signal }) => listItineraries(tripId, { signal }) });

  const remove = useMutation({
    mutationFn: (version) => deleteItinerary(version.id),
    onSuccess: (_, version) => {
      queryClient.invalidateQueries({ queryKey: ['trips'] });
      // Deleting the current version makes another one current.
      queryClient.invalidateQueries({ queryKey: ['itineraries'] });
      toast.show({ tone: 'info', message: `Version ${version.version} was deleted.` });
      setDeleting(null);
      onDeleted(version.id);
    },
  });

  const list = versions.data?.data ?? [];

  return (
    <details className={styles.history}>
      <summary className={styles.summary}>
        <History size={16} aria-hidden="true" />
        Versions{list.length > 0 && ` (${list.length})`}
      </summary>
      {versions.isPending && <Skeleton height="4rem" />}
      {versions.isError && <ErrorAlert error={versions.error} />}
      <ul className={styles.list}>
        {list.map((v) => (
          <li key={v.id} className={styles.item}>
            <span className={styles.text}>
              <span className={styles.title}>
                Version {v.version}
                {v.isCurrent && <Badge tone="success">Current</Badge>}
                {v.userModified && <Badge tone="info">Edited by you</Badge>}
              </span>
              <span className={styles.meta}>
                {createdFormat.format(new Date(v.createdAt))}, {v.stopCount} stop{v.stopCount === 1 ? '' : 's'} over {v.dayCount}{' '}
                day{v.dayCount === 1 ? '' : 's'}
              </span>
            </span>
            {v.id === viewingId ? (
              <span className={styles.viewing}>Showing</span>
            ) : (
              <Button as={Link} to={v.isCurrent ? `/trips/${tripId}` : `/trips/${tripId}?version=${v.id}`} size="sm" variant="secondary" aria-label={`View version ${v.version}`}>
                View
              </Button>
            )}
            <IconButton icon={Trash2} size="sm" label={`Delete version ${v.version}`} onClick={() => setDeleting(v)} />
          </li>
        ))}
      </ul>

      <Dialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={deleting ? `Delete version ${deleting.version}?` : 'Delete version?'}
        description={
          deleting?.isCurrent
            ? list.length > 1
              ? 'The newest remaining version becomes current. This cannot be undone.'
              : 'This is the only version; the trip will have no itinerary. This cannot be undone.'
            : 'This cannot be undone.'
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)} disabled={remove.isPending}>
              Cancel
            </Button>
            <Button variant="danger" icon={Trash2} loading={remove.isPending} onClick={() => remove.mutate(deleting)}>
              Delete version
            </Button>
          </>
        }
      >
        {remove.isError && <ErrorAlert error={remove.error} />}
      </Dialog>
    </details>
  );
}

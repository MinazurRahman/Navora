import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Lock, SearchX } from 'lucide-react';
import { Button } from '../../components/Button.jsx';
import { ErrorState } from '../../components/ErrorState.jsx';
import { Alert, EmptyState, Skeleton } from '../../components/Feedback.jsx';
import { useToast } from '../../components/useToast.js';
import { useAuth } from '../auth/useAuth.js';
import { createPlace, getModerationEvents, updatePlace, usePlace } from '../places/api.js';
import { PlaceStatusBadge } from '../places/PlaceStatusBadge.jsx';
import { initialPlaceForm, placeToForm } from './placeForm.js';
import { PlaceForm } from './PlaceForm.jsx';
import styles from './community.module.css';

const isModerator = (user) => user?.role === 'moderator' || user?.role === 'admin';

function BackLink() {
  return (
    <Link to="/community/mine" className={styles.back}>
      <ArrowLeft size={16} aria-hidden="true" />
      My submissions
    </Link>
  );
}

export function SubmitPlacePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const moderator = isModerator(user);
  const mutation = useMutation({
    mutationFn: createPlace,
    onSuccess: async (place) => {
      queryClient.invalidateQueries({ queryKey: ['places'] });
      toast.show({
        tone: 'success',
        message: place.status === 'APPROVED' ? `${place.name} is published.` : 'Thank you. Your place was submitted for review.',
      });
      await navigate('/community/mine');
    },
  });

  return (
    <main className={`container ${styles.page}`}>
      <title>Suggest a place | NAVORA</title>
      <header className={styles.header}>
        <h1>Suggest a place</h1>
        <p className="muted">
          {moderator
            ? 'As a moderator, places you add are published straight away.'
            : 'A moderator reviews every suggestion before it is listed. You can edit it while it waits.'}
        </p>
      </header>
      <PlaceForm
        initial={initialPlaceForm()}
        submitLabel={moderator ? 'Publish place' : 'Submit for review'}
        pending={mutation.isPending}
        serverError={mutation.error}
        onSubmit={(payload) => mutation.mutate(payload)}
      />
    </main>
  );
}

// The latest rejection reason, from the place's moderation history.
function useRejectionReason(placeId, enabled) {
  return useQuery({
    queryKey: ['places', placeId, 'events'],
    queryFn: ({ signal }) => getModerationEvents(placeId, { signal }),
    enabled,
    select: (events) => events.filter((e) => e.action === 'REJECTED').at(-1)?.note ?? null,
  });
}

export function RejectionReason({ placeId }) {
  const reason = useRejectionReason(placeId, true);
  if (reason.isPending) return <Skeleton width="60%" />;
  if (!reason.data) return null;
  return (
    <p className={styles.reason}>
      <strong>Reason:</strong> {reason.data}
    </p>
  );
}

// Same rules as the backend: submitters edit their own PENDING or REJECTED places (a rejected
// place goes back to PENDING); approved and archived places are for moderators only.
export function EditPlacePage() {
  const { placeId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const place = usePlace(placeId);
  const moderator = isModerator(user);
  const mutation = useMutation({
    mutationFn: (payload) => updatePlace(placeId, payload),
    onSuccess: async (updated) => {
      queryClient.invalidateQueries({ queryKey: ['places'] });
      const resubmitted = place.data.status === 'REJECTED' && updated.status === 'PENDING';
      toast.show({ tone: 'success', message: resubmitted ? 'Your changes were saved and sent for review again.' : 'Your changes were saved.' });
      await navigate(moderator ? `/places/${placeId}` : '/community/mine');
    },
  });

  if (place.isPending) {
    return (
      <main className={`container ${styles.page}`} aria-busy="true" aria-label="Loading place">
        <Skeleton width="40%" height="2.25rem" />
        <Skeleton height="20rem" />
      </main>
    );
  }
  if (place.isError) {
    const missing = place.error.status === 404 || place.error.code === 'VALIDATION_ERROR';
    return (
      <main className={`container ${styles.page}`}>
        {missing ? (
          <EmptyState headingLevel={1} icon={SearchX} title="Place not found" description="This place does not exist or you cannot see it." />
        ) : (
          <ErrorState error={place.error} onRetry={place.refetch} title="This place could not be loaded" />
        )}
      </main>
    );
  }

  const p = place.data;
  const own = p.createdBy === user?.id;
  const editable = moderator || (own && (p.status === 'PENDING' || p.status === 'REJECTED'));

  return (
    <main className={`container ${styles.page}`}>
      <title>{`Edit ${p.name} | NAVORA`}</title>
      <BackLink />
      <header className={styles.header}>
        <div className="cluster">
          <PlaceStatusBadge status={p.status} />
        </div>
        <h1>Edit {p.name}</h1>
      </header>

      {!editable && (
        <EmptyState
          icon={Lock}
          title="This place cannot be edited"
          description={
            !own
              ? 'Only the person who suggested it, or a moderator, can change it.'
              : p.status === 'APPROVED'
                ? 'Approved places can only be changed by moderators.'
                : 'Archived places cannot be changed.'
          }
          action={
            <Button as={Link} to={`/places/${p.id}`} variant="secondary">
              View place
            </Button>
          }
        />
      )}

      {editable && (
        <>
          {p.status === 'REJECTED' && !moderator && (
            <Alert tone="danger" title="This suggestion was rejected">
              <RejectionReason placeId={p.id} />
              <p>Fix what the moderator mentioned and save. It will be reviewed again.</p>
            </Alert>
          )}
          {p.status === 'PENDING' && !moderator && (
            <Alert tone="info">This place is waiting for review. Saving keeps it in the queue.</Alert>
          )}
          <PlaceForm
            key={p.updatedAt}
            initial={placeToForm(p)}
            submitLabel={p.status === 'REJECTED' && !moderator ? 'Save and resubmit' : 'Save changes'}
            pending={mutation.isPending}
            serverError={mutation.error}
            onSubmit={(payload) => mutation.mutate(payload)}
          />
        </>
      )}
    </main>
  );
}

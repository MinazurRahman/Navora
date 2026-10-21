import { useState } from 'react';
import { Link } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ShieldCheck, X } from 'lucide-react';
import { Button } from '../../components/Button.jsx';
import { Dialog } from '../../components/Dialog.jsx';
import { ErrorState } from '../../components/ErrorState.jsx';
import { Alert, EmptyState, Skeleton } from '../../components/Feedback.jsx';
import { Field, Select, Textarea } from '../../components/Field.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Pagination } from '../../components/Pagination.jsx';
import { useToast } from '../../components/useToast.js';
import { errorMessage } from '../../lib/errors.js';
import { formatEntryFee, formatMinutes } from '../../lib/format.js';
import { approvePlace, getModerationQueue, rejectPlace } from '../places/api.js';
import { PlaceStatusBadge } from '../places/PlaceStatusBadge.jsx';
import styles from './community.module.css';

const FACILITY_TEXT = { YES: 'Yes', NO: 'No', UNKNOWN: 'Not sure' };
const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Dhaka' });

function QueueItem({ place, onDecide }) {
  const where = [place.address, place.city].filter(Boolean).join(', ');
  return (
    <li className={styles.queueItem}>
      <div className={styles.queueHeader}>
        <div>
          <div className="cluster">
            <PlaceStatusBadge status={place.status} />
            <span className={styles.meta}>{place.category.name}</span>
          </div>
          <h2 className={styles.submissionName}>
            <Link to={`/places/${place.id}`}>{place.name}</Link>
          </h2>
          <p className={styles.meta}>Submitted {dateFormat.format(new Date(place.createdAt))}</p>
        </div>
        {place.status === 'PENDING' && (
          <div className={styles.submissionActions}>
            <Button size="sm" icon={Check} onClick={() => onDecide(place, 'approve')}>
              Approve
            </Button>
            <Button variant="danger" size="sm" icon={X} onClick={() => onDecide(place, 'reject')}>
              Reject
            </Button>
          </div>
        )}
      </div>
      {place.description && <p className={styles.queueDescription}>{place.description}</p>}
      <dl className={styles.queueFacts}>
        <div>
          <dt>Location</dt>
          <dd>
            {where || 'No address'} ({place.location.latitude.toFixed(5)}, {place.location.longitude.toFixed(5)})
          </dd>
        </div>
        <div>
          <dt>Entry fee</dt>
          <dd>{formatEntryFee(place.entryFee, place.currency)}</dd>
        </div>
        <div>
          <dt>Typical visit</dt>
          <dd>{place.typicalVisitMinutes === null ? 'Not given' : formatMinutes(place.typicalVisitMinutes)}</dd>
        </div>
        <div>
          <dt>Opening hours</dt>
          <dd>{place.openingHours.length ? `${place.openingHours.length} time ranges given` : 'Unknown'}</dd>
        </div>
        <div>
          <dt>Facilities</dt>
          <dd>
            Parking {FACILITY_TEXT[place.facilities.parking]}, pet-friendly {FACILITY_TEXT[place.facilities.petFriendly]},
            wheelchair {FACILITY_TEXT[place.facilities.wheelchairAccessible]}
          </dd>
        </div>
      </dl>
    </li>
  );
}

function DecisionDialog({ decision, onClose }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const approving = decision?.action === 'approve';
  const mutation = useMutation({
    mutationFn: () => (approving ? approvePlace(decision.place.id, { note: text.trim() || undefined }) : rejectPlace(decision.place.id, { reason: text.trim() })),
    onSuccess: (place) => {
      queryClient.invalidateQueries({ queryKey: ['places'] });
      toast.show({ tone: approving ? 'success' : 'info', message: `${place.name} was ${approving ? 'approved' : 'rejected'}.` });
      onClose();
    },
    onError: (err) => {
      if (err.code === 'INVALID_STATUS_TRANSITION') queryClient.invalidateQueries({ queryKey: ['places', 'moderation'] });
    },
  });

  return (
    <Dialog
      open={Boolean(decision)}
      onClose={onClose}
      title={decision ? `${approving ? 'Approve' : 'Reject'} ${decision.place.name}?` : ''}
      description={
        approving
          ? 'It will be listed publicly and can be included in trip plans.'
          : 'The submitter sees your reason and can edit and resubmit the place.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            variant={approving ? 'primary' : 'danger'}
            icon={approving ? Check : X}
            loading={mutation.isPending}
            onClick={() => {
              if (!approving && !text.trim()) {
                setError('Tell the submitter why, so they can fix it.');
                return;
              }
              mutation.mutate();
            }}
          >
            {approving ? 'Approve' : 'Reject'}
          </Button>
        </>
      }
    >
      {mutation.isError && <Alert tone="danger">{errorMessage(mutation.error)}</Alert>}
      <Field
        label={approving ? 'Note' : 'Reason'}
        optional={approving}
        hint={approving ? 'For the moderation history, for example "Verified on site".' : undefined}
        error={error}
      >
        {(props) => (
          <Textarea
            {...props}
            rows={3}
            maxLength={1000}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
          />
        )}
      </Field>
    </Dialog>
  );
}

// Moderators and admins (the route guard and the backend both enforce this).
export function ModerationPage() {
  const [status, setStatus] = useState('PENDING');
  const [page, setPage] = useState(1);
  const [decision, setDecision] = useState(null); // { place, action }
  const query = { status, page };
  const queue = useQuery({
    queryKey: ['places', 'moderation', query],
    queryFn: ({ signal }) => getModerationQueue(query, { signal }),
    placeholderData: keepPreviousData,
  });

  return (
    <main className="container">
      <title>Moderation | NAVORA</title>
      <PageHeader title="Moderation" description="Review community submissions, oldest first." />
      <div className={styles.filter}>
        <Field label="Show">
          {(props) => (
            <Select
              {...props}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="PENDING">Pending review</option>
              <option value="REJECTED">Rejected</option>
              <option value="APPROVED">Approved</option>
              <option value="ARCHIVED">Archived</option>
            </Select>
          )}
        </Field>
      </div>

      {queue.isPending && <Skeleton height="12rem" />}
      {queue.isError && <ErrorState error={queue.error} onRetry={queue.refetch} title="The queue could not be loaded" />}
      {queue.data?.data.length === 0 && (
        <EmptyState icon={ShieldCheck} title={status === 'PENDING' ? 'Nothing to review' : 'No places with this status'} />
      )}
      {queue.data?.data.length > 0 && (
        <ul className={`${styles.queue} ${queue.isPlaceholderData ? styles.stale : ''}`}>
          {queue.data.data.map((place) => (
            <QueueItem key={place.id} place={place} onDecide={(p, action) => setDecision({ place: p, action })} />
          ))}
        </ul>
      )}
      {queue.data && <Pagination page={queue.data.meta.page} totalPages={queue.data.meta.totalPages} onPage={setPage} />}

      <DecisionDialog key={decision ? `${decision.place.id}:${decision.action}` : 'none'} decision={decision} onClose={() => setDecision(null)} />
    </main>
  );
}

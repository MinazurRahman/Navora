import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { moderationApi } from '../api/endpoints';
import type { Place, PlaceStatus } from '../api/types';
import { MapView } from '../components/MapView';
import { PlaceCard } from '../components/PlaceCard';
import { EmptyState, ErrorNotice, Field, Loading, Pagination } from '../components/ui';
import { formatTimestamp } from '../lib/format';

export function ModerationPage() {
  const [status, setStatus] = useState<PlaceStatus>('PENDING');
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['moderation', status, page],
    queryFn: () => moderationApi.queue({ status, page, limit: 10 }),
  });

  return (
    <div className="page">
      <header className="page__head">
        <h1>Moderation</h1>
        <p className="muted measure">
          Oldest first. Approve places whose details are factual and correctly located. Reject anything with
          instructions, links or contact details in its text: approved descriptions are also shown to the AI
          assistant.
        </p>
      </header>
      <div className="segmented" role="group" aria-label="Queue">
        {(['PENDING', 'REJECTED', 'APPROVED', 'ARCHIVED'] as PlaceStatus[]).map((s) => (
          <button
            key={s}
            aria-pressed={status === s}
            onClick={() => {
              setStatus(s);
              setPage(1);
            }}
          >
            {s.charAt(0) + s.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {query.isPending && <Loading />}
      {query.isError && <ErrorNotice error={query.error} />}
      {query.data?.data.length === 0 && <EmptyState title="The queue is empty">Nothing is waiting here.</EmptyState>}
      <div className="stack-lg">
        {query.data?.data.map((place) => <QueueItem key={place.id} place={place} />)}
      </div>
      {query.data && <Pagination meta={query.data.meta} onPage={setPage} />}
    </div>
  );
}

function QueueItem({ place }: { place: Place }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const done = () => {
    queryClient.invalidateQueries({ queryKey: ['moderation'] });
    queryClient.invalidateQueries({ queryKey: ['places'] });
  };
  const approve = useMutation({ mutationFn: () => moderationApi.approve(place.id, note.trim() || undefined), onSuccess: done });
  const reject = useMutation({ mutationFn: () => moderationApi.reject(place.id, reason.trim()), onSuccess: done });

  return (
    <article className="queue-item">
      <PlaceCard place={place} showStatus>
        {/* Submitted text is untrusted: plain text only. */}
        {place.description && <p className="review__text">{place.description}</p>}
        <p className="fine">
          Submitted {formatTimestamp(place.createdAt)}. <Link to={`/places/${place.id}`}>Open full details</Link>
        </p>
      </PlaceCard>
      <MapView
        ariaLabel={`Location of ${place.name}`}
        className="map--queue"
        center={place.location}
        zoom={16}
        markers={[{ id: place.id, position: place.location, label: place.name, tone: 'pick' }]}
      />
      {place.status === 'PENDING' && (
        <div className="queue-item__actions">
          <Field label="Approval note (optional)">
            <input value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="Verified on site" />
          </Field>
          <button className="btn btn--primary" disabled={approve.isPending} onClick={() => approve.mutate()}>
            Approve
          </button>
          <Field label="Reason for rejecting" hint="The submitter sees this and can fix the place.">
            <input value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <button className="btn btn--ghost btn--danger" disabled={!reason.trim() || reject.isPending} onClick={() => reject.mutate()}>
            Reject
          </button>
          {approve.isError && <ErrorNotice error={approve.error} />}
          {reject.isError && <ErrorNotice error={reject.error} />}
        </div>
      )}
    </article>
  );
}

import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { placesApi } from '../api/endpoints';
import type { Place, PlaceStatus } from '../api/types';
import { PlaceCard } from '../components/PlaceCard';
import { EmptyState, ErrorNotice, Loading, Notice, Pagination } from '../components/ui';
import { formatTimestamp } from '../lib/format';

const STATUSES: { value: PlaceStatus | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'PENDING', label: 'Waiting for review' },
  { value: 'APPROVED', label: 'Published' },
  { value: 'REJECTED', label: 'Needs changes' },
  { value: 'ARCHIVED', label: 'Archived' },
];

export function MySubmissionsPage() {
  const [params, setParams] = useSearchParams();
  const status = (params.get('status') ?? '') as PlaceStatus | '';
  const [page, setPage] = useState(1);
  const savedId = params.get('saved');

  const query = useQuery({
    queryKey: ['my-places', status, page],
    queryFn: () => placesApi.mine({ status: status || undefined, page, limit: 20 }),
  });

  return (
    <div className="page">
      <header className="page__head page__head--row">
        <h1>My submissions</h1>
        <Link to="/contribute" className="btn btn--primary">
          Add a place
        </Link>
      </header>

      {savedId && (
        <Notice tone="success" title="Saved. Thanks for adding to Navora.">
          Pending places appear for everyone once a moderator approves them.
        </Notice>
      )}

      <div className="segmented" role="group" aria-label="Filter by status">
        {STATUSES.map((s) => (
          <button
            key={s.value}
            aria-pressed={status === s.value}
            onClick={() => {
              setPage(1);
              setParams(s.value ? { status: s.value } : {});
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {query.isPending && <Loading />}
      {query.isError && <ErrorNotice error={query.error} />}
      {query.data?.data.length === 0 && (
        <EmptyState title="Nothing here yet">
          Know a place others should visit? <Link to="/contribute">Add it</Link>.
        </EmptyState>
      )}
      <div className="place-list place-list--grid">
        {query.data?.data.map((place) => <Submission key={place.id} place={place} />)}
      </div>
      {query.data && <Pagination meta={query.data.meta} onPage={setPage} />}
    </div>
  );
}

function Submission({ place }: { place: Place }) {
  const queryClient = useQueryClient();
  const [showHistory, setShowHistory] = useState(place.status === 'REJECTED');
  const history = useQuery({
    queryKey: ['place-history', place.id],
    queryFn: () => placesApi.history(place.id),
    enabled: showHistory,
  });
  const archive = useMutation({
    mutationFn: () => placesApi.archive(place.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-places'] }),
  });
  const editable = place.status === 'PENDING' || place.status === 'REJECTED';
  const lastRejection = history.data?.filter((e) => e.action === 'REJECTED').at(-1);

  return (
    <PlaceCard place={place} showStatus>
      {place.status === 'REJECTED' && lastRejection?.note && (
        <p className="rejection">
          <strong>Moderator’s note:</strong> {lastRejection.note}
        </p>
      )}
      <div className="row">
        {editable && (
          <Link className="btn btn--ghost btn--small" to={`/contribute/${place.id}`}>
            {place.status === 'REJECTED' ? 'Fix and resubmit' : 'Edit'}
          </Link>
        )}
        <button className="link-btn" onClick={() => setShowHistory((s) => !s)} aria-expanded={showHistory}>
          {showHistory ? 'Hide history' : 'History'}
        </button>
        {editable && (
          <button
            className="link-btn link-btn--danger"
            disabled={archive.isPending}
            onClick={() => window.confirm(`Withdraw “${place.name}”?`) && archive.mutate()}
          >
            Withdraw
          </button>
        )}
      </div>
      {archive.isError && <ErrorNotice error={archive.error} />}
      {showHistory && history.data && (
        <ol className="history">
          {history.data.map((e, i) => (
            <li key={i}>
              <span>{e.action.charAt(0) + e.action.slice(1).toLowerCase()}</span>
              <span className="fine">{formatTimestamp(e.createdAt)}</span>
              {e.note && <span className="history__note">{e.note}</span>}
            </li>
          ))}
        </ol>
      )}
    </PlaceCard>
  );
}

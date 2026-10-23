import { useState } from 'react';
import { Link } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ClipboardList, MapPinPlus, Pencil } from 'lucide-react';
import { Button } from '../../components/Button.jsx';
import { Dialog } from '../../components/Dialog.jsx';
import { ErrorAlert, ErrorState } from '../../components/ErrorState.jsx';
import { EmptyState, Skeleton } from '../../components/Feedback.jsx';
import { Field, Select } from '../../components/Field.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Pagination } from '../../components/Pagination.jsx';
import { useToast } from '../../components/useToast.js';
import { archivePlace, listMyPlaces } from '../places/api.js';
import { PlaceStatusBadge } from '../places/PlaceStatusBadge.jsx';
import { RejectionReason } from './PlaceFormPages.jsx';
import styles from './community.module.css';

const STATUS_FILTERS = [
  ['', 'All statuses'],
  ['PENDING', 'Pending review'],
  ['APPROVED', 'Approved'],
  ['REJECTED', 'Rejected'],
  ['ARCHIVED', 'Archived'],
];
const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'Asia/Dhaka' });
const canEdit = (status) => status === 'PENDING' || status === 'REJECTED';

function Submission({ place, onWithdraw }) {
  return (
    <li className={styles.submission}>
      <div className={styles.submissionMain}>
        <div className="cluster">
          <PlaceStatusBadge status={place.status} />
          <span className={styles.meta}>{place.category.name}</span>
        </div>
        <h2 className={styles.submissionName}>
          <Link to={`/places/${place.id}`}>{place.name}</Link>
        </h2>
        <p className={styles.meta}>Submitted {dateFormat.format(new Date(place.createdAt))}</p>
        {place.status === 'PENDING' && <p className={styles.meta}>Waiting for a moderator. You can still edit it.</p>}
        {place.status === 'REJECTED' && <RejectionReason placeId={place.id} />}
      </div>
      {canEdit(place.status) && (
        <div className={styles.submissionActions}>
          <Button as={Link} to={`/community/${place.id}/edit`} variant="secondary" size="sm" icon={Pencil}>
            {place.status === 'REJECTED' ? 'Edit and resubmit' : 'Edit'}
          </Button>
          <Button variant="ghost" size="sm" icon={Archive} onClick={() => onWithdraw(place)}>
            Withdraw
          </Button>
        </div>
      )}
    </li>
  );
}

export function MySubmissionsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [withdrawing, setWithdrawing] = useState(null);
  const query = { status: status || undefined, page };
  const list = useQuery({
    queryKey: ['places', 'mine', query],
    queryFn: ({ signal }) => listMyPlaces(query, { signal }),
    placeholderData: keepPreviousData,
  });
  const withdraw = useMutation({
    mutationFn: (place) => archivePlace(place.id),
    onSuccess: (place) => {
      setWithdrawing(null);
      queryClient.invalidateQueries({ queryKey: ['places'] });
      toast.show({ tone: 'info', message: `${place.name} was withdrawn.` });
    },
  });

  return (
    <main className="container">
      <title>My submissions | NAVORA</title>
      <PageHeader
        title="My submissions"
        description="Places you suggested and where they are in review."
        actions={
          <Button as={Link} to="/community/submit" icon={MapPinPlus}>
            Suggest a place
          </Button>
        }
      />

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
              {STATUS_FILTERS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      {list.isPending && <Skeleton height="10rem" />}
      {list.isError && <ErrorState error={list.error} onRetry={list.refetch} title="Your submissions could not be loaded" />}
      {list.data?.data.length === 0 && (
        <EmptyState
          icon={ClipboardList}
          title={status ? 'No submissions with this status' : 'You have not suggested any places yet'}
          description={status ? undefined : 'Know a place others should see? Suggest it to the community.'}
          action={
            !status && (
              <Button as={Link} to="/community/submit" icon={MapPinPlus}>
                Suggest a place
              </Button>
            )
          }
        />
      )}
      {list.data?.data.length > 0 && (
        <ul className={`${styles.submissions} ${list.isPlaceholderData ? styles.stale : ''}`}>
          {list.data.data.map((place) => (
            <Submission key={place.id} place={place} onWithdraw={setWithdrawing} />
          ))}
        </ul>
      )}
      {list.data && <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} onPage={setPage} />}

      <Dialog
        open={Boolean(withdrawing)}
        onClose={() => setWithdrawing(null)}
        title="Withdraw this suggestion?"
        description={withdrawing ? `${withdrawing.name} will be archived and taken out of review. This cannot be undone.` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setWithdrawing(null)} disabled={withdraw.isPending}>
              Cancel
            </Button>
            <Button variant="danger" icon={Archive} loading={withdraw.isPending} onClick={() => withdraw.mutate(withdrawing)}>
              Withdraw
            </Button>
          </>
        }
      >
        {withdraw.isError && <ErrorAlert error={withdraw.error} />}
      </Dialog>
    </main>
  );
}

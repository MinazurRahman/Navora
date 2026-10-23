import { useState } from 'react';
import { Link } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarRange, Map as MapIcon, Plus, Trash2, Users } from 'lucide-react';
import { Badge } from '../../components/Badge.jsx';
import { Button } from '../../components/Button.jsx';
import { Dialog } from '../../components/Dialog.jsx';
import { ErrorState } from '../../components/ErrorState.jsx';
import { Alert, EmptyState, Skeleton } from '../../components/Feedback.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Pagination } from '../../components/Pagination.jsx';
import { useToast } from '../../components/useToast.js';
import { errorMessage } from '../../lib/errors.js';
import { formatDayDate } from '../../lib/format.js';
import { deleteTrip, listTrips } from './api.js';
import { TRAVEL_MODES } from './tripForm.js';
import styles from './TripsPage.module.css';

const createdFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'Asia/Dhaka' });

function dates(trip) {
  const days = `${trip.durationDays} day${trip.durationDays === 1 ? '' : 's'}`;
  // No start date: the planner starts on the day the itinerary is generated.
  return trip.startDate ? `From ${formatDayDate(trip.startDate)}, ${days}` : `${days}, starting the day you generate it`;
}

function TripRow({ trip, onDelete }) {
  const mode = TRAVEL_MODES.find((m) => m.value === trip.travelMode)?.label;
  return (
    <li className={styles.trip}>
      <div className={styles.tripMain}>
        <div className="cluster">
          {trip.currentItineraryId ? <Badge tone="success">Itinerary ready</Badge> : <Badge>No itinerary yet</Badge>}
        </div>
        <h2 className={styles.title}>
          <Link to={`/trips/${trip.id}`}>{trip.title}</Link>
        </h2>
        <ul className={styles.meta}>
          <li>
            <CalendarRange size={14} aria-hidden="true" />
            {dates(trip)}
          </li>
          <li>{mode}</li>
          <li>
            <Users size={14} aria-hidden="true" />
            {trip.partySize} {trip.partySize === 1 ? 'person' : 'people'}
          </li>
        </ul>
        <p className={styles.created}>Created {createdFormat.format(new Date(trip.createdAt))}</p>
      </div>
      <div className={styles.actions}>
        <Button as={Link} to={`/trips/${trip.id}`} variant="secondary" size="sm" icon={MapIcon}>
          Open
        </Button>
        <Button variant="ghost" size="sm" icon={Trash2} onClick={() => onDelete(trip)} aria-label={`Delete ${trip.title}`}>
          Delete
        </Button>
      </div>
    </li>
  );
}

export function TripsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [deleting, setDeleting] = useState(null);
  const trips = useQuery({
    queryKey: ['trips', 'list', page],
    queryFn: ({ signal }) => listTrips({ page }, { signal }),
    placeholderData: keepPreviousData,
  });
  const remove = useMutation({
    mutationFn: (trip) => deleteTrip(trip.id),
    onSuccess: (_, trip) => {
      setDeleting(null);
      queryClient.invalidateQueries({ queryKey: ['trips'] });
      queryClient.invalidateQueries({ queryKey: ['itineraries'] });
      toast.show({ tone: 'info', message: `${trip.title} was deleted.` });
    },
  });

  return (
    <main className="container">
      <title>My trips | NAVORA</title>
      <PageHeader
        title="My trips"
        description="Your trips and their day-by-day itineraries."
        actions={
          <Button as={Link} to="/plan" icon={Plus}>
            Plan a trip
          </Button>
        }
      />

      {trips.isPending && (
        <div className={styles.loading} aria-busy="true" aria-label="Loading trips">
          <Skeleton height="7rem" />
          <Skeleton height="7rem" />
        </div>
      )}
      {trips.isError && <ErrorState error={trips.error} onRetry={trips.refetch} title="Your trips could not be loaded" />}
      {trips.data?.data.length === 0 && (
        <EmptyState
          icon={MapIcon}
          title="No trips yet"
          description="Plan a trip to get a day-by-day itinerary with an ordered route."
          action={
            <Button as={Link} to="/plan" icon={Plus}>
              Plan a trip
            </Button>
          }
        />
      )}
      {trips.data?.data.length > 0 && (
        <ul className={`${styles.list} ${trips.isPlaceholderData ? styles.stale : ''}`}>
          {trips.data.data.map((trip) => (
            <TripRow key={trip.id} trip={trip} onDelete={setDeleting} />
          ))}
        </ul>
      )}
      {trips.data && <Pagination page={trips.data.meta.page} totalPages={trips.data.meta.totalPages} onPage={setPage} />}

      <Dialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Delete this trip?"
        description={deleting ? `${deleting.title} and every version of its itinerary will be deleted. This cannot be undone.` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)} disabled={remove.isPending}>
              Cancel
            </Button>
            <Button variant="danger" icon={Trash2} loading={remove.isPending} onClick={() => remove.mutate(deleting)}>
              Delete trip
            </Button>
          </>
        }
      >
        {remove.isError && <Alert tone="danger">{errorMessage(remove.error)}</Alert>}
      </Dialog>
    </main>
  );
}

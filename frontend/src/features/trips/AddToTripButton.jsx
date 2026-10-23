import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, MapPlus, Plus } from 'lucide-react';
import { Button } from '../../components/Button.jsx';
import { Dialog } from '../../components/Dialog.jsx';
import { ErrorAlert } from '../../components/ErrorState.jsx';
import { Skeleton } from '../../components/Feedback.jsx';
import { useToast } from '../../components/useToast.js';
import { errorMessage } from '../../lib/errors.js';
import { useAuth } from '../auth/useAuth.js';
import { listTrips, updateTrip } from './api.js';
import { MAX_SELECTED_PLACES } from './tripForm.js';
import styles from './AddToTripButton.module.css';

// Adds an approved place to a trip's must-visit places, or starts a new trip with it.
// The itinerary is not changed: the user regenerates it when ready.
export function AddToTripButton({ placeId }) {
  const { status } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  if (status !== 'authenticated') {
    return (
      <Button as={Link} to={`/login?next=${encodeURIComponent(location.pathname)}`} variant="secondary" icon={MapPlus}>
        Sign in to plan
      </Button>
    );
  }

  return (
    <>
      <Button variant="secondary" icon={MapPlus} onClick={() => setOpen(true)}>
        Add to trip
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Add to a trip"
        description="It becomes a must-visit place. Generate a new itinerary to include it."
        footer={
          <Button as={Link} to={`/plan?place=${placeId}`} variant="secondary" icon={Plus}>
            New trip with this place
          </Button>
        }
      >
        {open && <TripChoices placeId={placeId} />}
      </Dialog>
    </>
  );
}

function TripChoices({ placeId }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  // ponytail: first 50 trips only; add paging here if people keep more.
  const trips = useQuery({ queryKey: ['trips', 'list', 'choices'], queryFn: ({ signal }) => listTrips({ limit: 50 }, { signal }) });

  const add = useMutation({
    mutationFn: (trip) => updateTrip(trip.id, { selectedPlaceIds: [...trip.selectedPlaceIds, placeId] }),
    onSuccess: (trip) => {
      queryClient.invalidateQueries({ queryKey: ['trips'] });
      toast.show({ tone: 'success', message: `Added to ${trip.title}.` });
    },
    onError: (error) => toast.show({ tone: 'danger', message: errorMessage(error) }),
  });

  if (trips.isPending) return <Skeleton height="6rem" />;
  if (trips.isError) return <ErrorAlert error={trips.error} />;
  if (trips.data.data.length === 0) return <p className="muted">You have no trips yet.</p>;

  return (
    <ul className={styles.list}>
      {trips.data.data.map((trip) => {
        const added = trip.selectedPlaceIds.includes(placeId);
        const full = trip.selectedPlaceIds.length >= MAX_SELECTED_PLACES;
        return (
          <li key={trip.id} className={styles.item}>
            <span className={styles.text}>
              <span className={styles.title}>{trip.title}</span>
              <span className={styles.meta}>
                {trip.startDate ?? 'Starts today'}, {trip.durationDays} day{trip.durationDays === 1 ? '' : 's'}
                {full && !added && ', must-visit list is full'}
              </span>
            </span>
            {added ? (
              <span className={styles.added}>
                <Check size={16} aria-hidden="true" /> Added
              </span>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                disabled={full}
                loading={add.isPending && add.variables?.id === trip.id}
                aria-label={`Add to ${trip.title}`}
                onClick={() => add.mutate(trip)}
              >
                Add
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

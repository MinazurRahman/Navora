import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { itinerariesApi, tripsApi } from '../api/endpoints';
import { EmptyState, ErrorNotice, Loading, Pagination } from '../components/ui';
import { formatDate, formatDistance, formatMinutes, TRAVEL_MODE_LABEL } from '../lib/format';

export function TripsPage() {
  const [page, setPage] = useState(1);
  const tripsQuery = useQuery({ queryKey: ['trips', page], queryFn: () => tripsApi.list({ page, limit: 12 }) });
  // Current itinerary summaries, to show stop counts and distance on each card.
  const currentQuery = useQuery({
    queryKey: ['itineraries', 'current'],
    queryFn: () => itinerariesApi.list({ current: true, limit: 50 }),
  });
  const summaries = new Map((currentQuery.data?.data ?? []).map((s) => [s.tripId, s]));

  return (
    <div className="page">
      <header className="page__head page__head--row">
        <h1>My trips</h1>
        <Link to="/plan" className="btn btn--primary">
          Plan a new trip
        </Link>
      </header>

      {tripsQuery.isPending && <Loading label="Loading your trips" />}
      {tripsQuery.isError && <ErrorNotice error={tripsQuery.error} />}
      {tripsQuery.data?.data.length === 0 && (
        <EmptyState title="No trips yet">
          <Link to="/plan">Plan your first trip</Link>: tell Navora how many days you have and what you enjoy.
        </EmptyState>
      )}

      <ul className="trip-grid">
        {tripsQuery.data?.data.map((trip) => {
          const summary = summaries.get(trip.id);
          return (
            <li key={trip.id}>
              <Link to={`/trips/${trip.id}`} className="trip-card">
                <span className="trip-card__days">{trip.durationDays}d</span>
                <span className="trip-card__title">{trip.title}</span>
                <span className="muted">
                  {trip.startDate ? formatDate(trip.startDate, true) : 'Starts today'}, by{' '}
                  {TRAVEL_MODE_LABEL[trip.travelMode].toLowerCase()}
                </span>
                <span className="trip-card__foot">
                  {summary
                    ? `${summary.stopCount} stops, ${formatDistance(summary.totals.distanceMeters)}, ${formatMinutes(summary.totals.travelMinutes)} travelling`
                    : 'No itinerary yet'}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {tripsQuery.data && <Pagination meta={tripsQuery.data.meta} onPage={setPage} />}
    </div>
  );
}

import { useState } from 'react';
import { Link } from 'react-router';
import { Bookmark, BookmarkX, Compass } from 'lucide-react';
import { Button } from '../../components/Button.jsx';
import { ErrorState } from '../../components/ErrorState.jsx';
import { EmptyState } from '../../components/Feedback.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Pagination } from '../../components/Pagination.jsx';
import { useToast } from '../../components/useToast.js';
import { errorMessage } from '../../lib/errors.js';
import { PlaceCard, PlaceCardSkeleton } from '../places/PlaceCard.jsx';
import { useSavedPlaces, useToggleSaved } from './api.js';
import styles from './SavedPlacesPage.module.css';

function RemoveButton({ place }) {
  const toggle = useToggleSaved(place.id);
  const toast = useToast();
  return (
    <Button
      variant="ghost"
      size="sm"
      icon={BookmarkX}
      loading={toggle.isPending}
      onClick={() =>
        toggle.mutate(false, {
          onSuccess: () => toast.show({ tone: 'info', message: `${place.name} was removed from your saved places.` }),
          onError: (error) => toast.show({ tone: 'danger', message: errorMessage(error) }),
        })
      }
    >
      Remove
    </Button>
  );
}

export function SavedPlacesPage() {
  const [page, setPage] = useState(1);
  const { data, isPending, isError, error, refetch, isPlaceholderData } = useSavedPlaces(page);
  const meta = data?.meta;

  return (
    <main className="container">
      <title>Saved places | NAVORA</title>
      <PageHeader title="Saved places" description="Places you want to remember or visit later." />

      {isPending && (
        <ul className={styles.grid} aria-busy="true" aria-label="Loading saved places">
          {Array.from({ length: 3 }, (_, i) => (
            <li key={i}>
              <PlaceCardSkeleton />
            </li>
          ))}
        </ul>
      )}

      {isError && <ErrorState error={error} onRetry={refetch} title="Saved places could not be loaded" />}

      {data && data.data.length === 0 && (
        <EmptyState
          icon={Bookmark}
          title="No saved places yet"
          description="Use Save place on any place to keep it here."
          action={
            <Button as={Link} to="/explore" icon={Compass}>
              Explore places
            </Button>
          }
        />
      )}

      {data && data.data.length > 0 && (
        <>
          <p className={styles.count}>
            {meta.total} saved place{meta.total === 1 ? '' : 's'}
          </p>
          <ul className={`${styles.grid} ${isPlaceholderData ? styles.stale : ''}`}>
            {data.data.map((place) => (
              <li key={place.id}>
                <PlaceCard headingLevel="h2" place={place} action={<RemoveButton place={place} />} />
              </li>
            ))}
          </ul>
        </>
      )}

      {meta && <Pagination page={meta.page} totalPages={meta.totalPages} onPage={setPage} />}
    </main>
  );
}

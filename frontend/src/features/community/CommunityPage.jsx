import { useState } from 'react';
import { Link } from 'react-router';
import { ClipboardList, MapPinPlus, Users } from 'lucide-react';
import { Button } from '../../components/Button.jsx';
import { ErrorState } from '../../components/ErrorState.jsx';
import { EmptyState } from '../../components/Feedback.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Pagination } from '../../components/Pagination.jsx';
import { useAuth } from '../auth/useAuth.js';
import { usePlaces } from '../places/api.js';
import { PlaceCard, PlaceCardSkeleton } from '../places/PlaceCard.jsx';
import styles from './community.module.css';

const PAGE_SIZE = 12;

export function CommunityPage() {
  const { status } = useAuth();
  const [page, setPage] = useState(1);
  const { data, isPending, isError, error, refetch, isPlaceholderData } = usePlaces({ page, limit: PAGE_SIZE });

  return (
    <main className="container">
      <title>Community | NAVORA</title>
      <PageHeader
        title="Community"
        description="Places added by people who know Dhaka. Every place is checked by a moderator before it is listed."
        actions={
          <>
            {status === 'authenticated' && (
              <Button as={Link} to="/community/mine" variant="secondary" icon={ClipboardList}>
                My submissions
              </Button>
            )}
            <Button as={Link} to="/community/submit" icon={MapPinPlus}>
              Suggest a place
            </Button>
          </>
        }
      />

      <ol className={styles.process} aria-label="How submissions work">
        <li>
          <strong>Suggest</strong> a place with what you know. Unknown details can stay unknown.
        </li>
        <li>
          <strong>A moderator reviews</strong> it. You can edit it while it waits, and after a rejection.
        </li>
        <li>
          <strong>Once approved</strong> it appears in Explore and can be included in trip plans.
        </li>
      </ol>

      <h2 className={styles.listHeading}>Recently approved</h2>
      {isPending && (
        <ul className={styles.grid} aria-busy="true" aria-label="Loading places">
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i}>
              <PlaceCardSkeleton />
            </li>
          ))}
        </ul>
      )}
      {isError && <ErrorState error={error} onRetry={refetch} title="Places could not be loaded" />}
      {data?.data.length === 0 && (
        <EmptyState icon={Users} title="No places yet" description="Be the first to suggest a place." />
      )}
      {data?.data.length > 0 && (
        <ul className={`${styles.grid} ${isPlaceholderData ? styles.stale : ''}`}>
          {data.data.map((place) => (
            <li key={place.id}>
              <PlaceCard place={place} />
            </li>
          ))}
        </ul>
      )}
      {data && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} onPage={setPage} />}
    </main>
  );
}

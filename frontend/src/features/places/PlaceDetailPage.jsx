import { Suspense, lazy } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, CircleCheck, CircleHelp, CircleX, Clock, MapPin, SearchX, Star, Ticket } from 'lucide-react';
import { Badge } from '../../components/Badge.jsx';
import { Button } from '../../components/Button.jsx';
import { ErrorState } from '../../components/ErrorState.jsx';
import { Alert, EmptyState, Skeleton } from '../../components/Feedback.jsx';
import { formatEntryFee, formatMinutes, formatRating } from '../../lib/format.js';
import { useTags } from '../catalogue/api.js';
import { SaveButton } from '../saved/SaveButton.jsx';
import { usePlace } from './api.js';
import { dhakaWeekday, weeklySchedule } from './openingHours.js';
import { ReviewsSection } from './Reviews.jsx';
import { PlaceStatusBadge } from './PlaceStatusBadge.jsx';
import styles from './PlaceDetailPage.module.css';

const PlacesMap = lazy(() => import('./PlacesMap.jsx'));

// Facility values are YES / NO / UNKNOWN. UNKNOWN is shown as "Not verified", never as yes.
const FACILITY = {
  YES: { icon: CircleCheck, label: 'Yes', className: styles.yes },
  NO: { icon: CircleX, label: 'No', className: styles.no },
  UNKNOWN: { icon: CircleHelp, label: 'Not verified', className: styles.unknown },
};

const verifiedFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'Asia/Dhaka' });

function Facility({ label, value }) {
  const { icon: Icon, label: text, className } = FACILITY[value] ?? FACILITY.UNKNOWN;
  return (
    <div className={styles.facility}>
      <dt>{label}</dt>
      <dd className={className}>
        <Icon size={16} aria-hidden="true" />
        {text}
      </dd>
    </div>
  );
}

function OpeningHours({ openingHours }) {
  const schedule = weeklySchedule(openingHours);
  if (!schedule) {
    return (
      <Alert tone="warning" title="Opening hours could not be verified">
        This place may be closed when you arrive. Check locally before you go.
      </Alert>
    );
  }
  const today = dhakaWeekday();
  return (
    <table className={styles.hours}>
      <caption className="visually-hidden">Weekly opening hours (Dhaka time)</caption>
      <tbody>
        {schedule.map(({ dayOfWeek, day, ranges }) => (
          <tr key={day} className={dayOfWeek === today ? styles.today : undefined}>
            <th scope="row">
              {day}
              {dayOfWeek === today && <span className={styles.todayLabel}> (today)</span>}
            </th>
            <td>{ranges.length ? ranges.join(', ') : 'Closed'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DetailSkeleton() {
  return (
    <div className={styles.page} aria-busy="true" aria-label="Loading place">
      <Skeleton width="8rem" height="1.25rem" />
      <Skeleton width="60%" height="2.25rem" />
      <Skeleton width="40%" />
      <Skeleton height="12rem" />
    </div>
  );
}

export function PlaceDetailPage() {
  const { placeId } = useParams();
  const { data: place, isPending, isError, error, refetch } = usePlace(placeId);
  const tags = useTags();

  if (isPending) {
    return (
      <main className="container">
        <DetailSkeleton />
      </main>
    );
  }

  if (isError) {
    return (
      <main className={`container ${styles.page}`}>
        <title>{error.status === 404 || error.code === 'VALIDATION_ERROR' ? 'Place not found | NAVORA' : 'NAVORA'}</title>
        {error.status === 404 || error.code === 'VALIDATION_ERROR' ? (
          <EmptyState
            headingLevel={1}
            icon={SearchX}
            title="Place not found"
            description="This place does not exist or is not public."
            action={
              <Button as={Link} to="/explore">
                Explore places
              </Button>
            }
          />
        ) : (
          <ErrorState error={error} onRetry={refetch} title="This place could not be loaded" />
        )}
      </main>
    );
  }

  const approved = place.status === 'APPROVED';
  const where = [place.address, place.city].filter(Boolean).join(', ');
  const tagNames = new Map(tags.data?.map((t) => [t.slug, t.name]) ?? []);
  const { facilities } = place;

  return (
    <main className={`container ${styles.page}`}>
      <title>{`${place.name} | NAVORA`}</title>

      <Link to="/explore" className={styles.back}>
        <ArrowLeft size={16} aria-hidden="true" />
        Explore places
      </Link>

      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <div className="cluster">
            <Badge>{place.category.name}</Badge>
            <PlaceStatusBadge status={place.status} hideApproved />
          </div>
          <h1>{place.name}</h1>
          {where && (
            <p className={styles.where}>
              <MapPin size={16} aria-hidden="true" />
              {where}
            </p>
          )}
        </div>
        {approved && (
          <div className={styles.actions}>
            <SaveButton placeId={place.id} />
          </div>
        )}
      </header>

      {!approved && (
        <Alert tone={place.status === 'REJECTED' ? 'danger' : 'info'}>
          {place.status === 'PENDING' && 'This place is waiting for moderator review and is not public yet.'}
          {place.status === 'REJECTED' && 'This submission was rejected. You can edit and resubmit it from My submissions.'}
          {place.status === 'ARCHIVED' && 'This place is archived and no longer listed.'}
        </Alert>
      )}

      <div className={styles.layout}>
        {/* Key facts come first on small screens; on large screens they sit in the right column. */}
        <aside className={styles.aside} aria-label="Key facts">
          <dl className={styles.facts}>
            <div className={styles.fact}>
              <dt>
                <Ticket size={16} aria-hidden="true" />
                Entry fee
              </dt>
              <dd className={place.entryFee === null ? styles.unknown : undefined}>
                {formatEntryFee(place.entryFee, place.currency)}
              </dd>
            </div>
            <div className={styles.fact}>
              <dt>
                <Clock size={16} aria-hidden="true" />
                Typical visit
              </dt>
              <dd className={place.typicalVisitMinutes === null ? styles.unknown : undefined}>
                {place.typicalVisitMinutes === null ? 'Not known' : `About ${formatMinutes(place.typicalVisitMinutes)}`}
              </dd>
            </div>
            <div className={styles.fact}>
              <dt>
                <Star size={16} aria-hidden="true" />
                Rating
              </dt>
              <dd className={place.rating.count === 0 ? styles.unknown : undefined}>{formatRating(place.rating)}</dd>
            </div>
          </dl>
          <div className={styles.map}>
            <Suspense fallback={<Skeleton height="100%" />}>
              <PlacesMap places={[place]} selectedId={null} onSelect={() => {}} center={null} radiusKm={0} />
            </Suspense>
          </div>
        </aside>
        <div className={styles.main}>
          <section className={styles.section} aria-labelledby="about-heading">
            <h2 id="about-heading">About</h2>
            {place.description ? (
              <p className={styles.description}>{place.description}</p>
            ) : (
              <p className="muted">No description yet.</p>
            )}
            {place.tags.length > 0 && (
              <div className={styles.tags}>
                <span className="visually-hidden">Interests: </span>
                {place.tags.map((slug) => (
                  <Badge key={slug} tone="info">
                    {tagNames.get(slug) ?? slug}
                  </Badge>
                ))}
              </div>
            )}
          </section>

          <section className={styles.section} aria-labelledby="hours-heading">
            <h2 id="hours-heading">Opening hours</h2>
            <OpeningHours openingHours={place.openingHours} />
          </section>

          <section className={styles.section} aria-labelledby="facilities-heading">
            <h2 id="facilities-heading">Facilities</h2>
            <dl className={styles.facilities}>
              <Facility label="Parking" value={facilities.parking} />
              <Facility label="Pet-friendly" value={facilities.petFriendly} />
              <Facility label="Wheelchair accessible" value={facilities.wheelchairAccessible} />
            </dl>
            {facilities.accessibilityNotes && (
              <p>
                <strong>Accessibility notes:</strong> {facilities.accessibilityNotes}
              </p>
            )}
            {facilities.restrictions && (
              <p>
                <strong>Restrictions:</strong> {facilities.restrictions}
              </p>
            )}
            <p className={styles.note}>
              {facilities.verifiedAt
                ? `Facilities verified on ${verifiedFormat.format(new Date(facilities.verifiedAt))}.`
                : 'Facilities have not been verified by a moderator.'}
            </p>
          </section>

          {approved && <ReviewsSection placeId={place.id} reviewCount={place.rating.count} />}
        </div>

      </div>
    </main>
  );
}

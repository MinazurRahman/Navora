import { Link } from 'react-router';
import { MapPin, Star, Ticket } from 'lucide-react';
import { Badge } from '../../components/Badge.jsx';
import { Skeleton } from '../../components/Feedback.jsx';
import { formatDistance, formatEntryFee, formatRating } from '../../lib/format.js';
import { PlaceImage } from './PlaceImage.jsx';
import styles from './PlaceCard.module.css';

// Summary of an approved place. The whole card is one link (to the details page);
// `action` is an extra control drawn above that link (e.g. "Show on map").
// layout: 'stack' (photo on top, for grids) or 'row' (photo beside, for long lists).
export function PlaceCard({ place, headingLevel: Heading = 'h3', selected = false, action, layout = 'stack' }) {
  const where = [place.address, place.city].filter(Boolean).join(', ');
  const distance = formatDistance(place.distanceMeters);
  const rated = place.rating.count > 0 && place.rating.average !== null;

  return (
    <article className={`${styles.card} ${styles[layout]} ${selected ? styles.selected : ''}`}>
      <PlaceImage place={place} className={styles.media} />
      <div className={styles.body}>
        <div className={styles.top}>
          <Badge>{place.category.name}</Badge>
          {distance && <span className={styles.distance}>{distance} away</span>}
        </div>
        <Heading className={styles.name}>
          <Link to={`/places/${place.id}`} className={styles.link}>
            {place.name}
          </Link>
        </Heading>
        {place.description && <p className={styles.description}>{place.description}</p>}
        <ul className={styles.meta}>
          {where && (
            <li>
              <MapPin size={14} aria-hidden="true" />
              {where}
            </li>
          )}
          <li className={rated ? undefined : styles.unknown}>
            <Star size={14} aria-hidden="true" />
            {formatRating(place.rating)}
          </li>
          <li className={place.entryFee === null ? styles.unknown : undefined}>
            <Ticket size={14} aria-hidden="true" />
            {formatEntryFee(place.entryFee, place.currency)}
          </li>
        </ul>
        {action && <div className={styles.action}>{action}</div>}
      </div>
    </article>
  );
}

export function PlaceCardSkeleton() {
  return (
    <div className={`${styles.card} ${styles.stack}`} aria-hidden="true">
      <Skeleton height="auto" className={styles.mediaSkeleton} />
      <div className={styles.body}>
        <Skeleton width="6rem" height="1.25rem" />
        <Skeleton width="70%" height="1.5rem" />
        <Skeleton width="100%" />
        <Skeleton width="50%" />
      </div>
    </div>
  );
}

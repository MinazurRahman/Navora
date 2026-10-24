import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { Place } from '../api/types';
import { formatDistance, formatEntryFee, formatRating, titleCase } from '../lib/format';
import { tripDraft, useTripDraft, MAX_SELECTED_PLACES } from '../trip/tripDraft';
import { FacilityBadge, Stars } from './ui';

interface PlaceCardProps {
  place: Place;
  highlighted?: boolean;
  onHover?: (id: string | null) => void;
  /** Extra content under the card body (e.g. recommendation reasons). */
  children?: ReactNode;
  showStatus?: boolean;
  linkTo?: string;
}

export function PlaceCard({ place, highlighted, onHover, children, showStatus, linkTo }: PlaceCardProps) {
  const draft = useTripDraft();
  const picked = draft.some((p) => p.id === place.id);
  const full = draft.length >= MAX_SELECTED_PLACES;

  return (
    <article
      className={`place-card ${highlighted ? 'place-card--highlight' : ''}`}
      onMouseEnter={() => onHover?.(place.id)}
      onMouseLeave={() => onHover?.(null)}
    >
      <div className="place-card__head">
        <div>
          <p className="place-card__category">
            {place.category.name}
            {place.distanceMeters !== undefined && <span className="muted"> {formatDistance(place.distanceMeters)} away</span>}
          </p>
          <h3 className="place-card__name">
            <Link to={linkTo ?? `/places/${place.id}`}>{place.name}</Link>
          </h3>
        </div>
        {showStatus ? (
          <span className={`status status--${place.status.toLowerCase()}`}>{titleCase(place.status.toLowerCase())}</span>
        ) : (
          place.status === 'APPROVED' && (
            <button
              type="button"
              className={`pick ${picked ? 'pick--on' : ''}`}
              aria-pressed={picked}
              disabled={!picked && full}
              title={!picked && full ? `A trip can include at most ${MAX_SELECTED_PLACES} picked places` : undefined}
              onClick={() =>
                picked
                  ? tripDraft.remove(place.id)
                  : tripDraft.add({
                      id: place.id,
                      name: place.name,
                      category: place.category.name,
                      location: place.location,
                    })
              }
            >
              {picked ? 'In your trip' : 'Add to trip'}
            </button>
          )
        )}
      </div>

      <p className="place-card__meta">
        <span className="rating">
          <Stars value={place.rating.average} />
          {formatRating(place.rating.average, place.rating.count)}
        </span>
        <span className={place.entryFee === null ? 'unknown' : ''}>{formatEntryFee(place.entryFee, place.currency)}</span>
      </p>

      <div className="facilities">
        <FacilityBadge label="Parking" status={place.facilities.parking} />
        <FacilityBadge label="Pets" status={place.facilities.petFriendly} />
        <FacilityBadge label="Wheelchair" status={place.facilities.wheelchairAccessible} />
      </div>

      {place.tags.length > 0 && (
        <ul className="tags" aria-label="Interests">
          {place.tags.map((tag) => (
            <li key={tag}>{titleCase(tag)}</li>
          ))}
        </ul>
      )}
      {children}
    </article>
  );
}

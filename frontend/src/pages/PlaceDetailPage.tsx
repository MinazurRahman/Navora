import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { placesApi, reviewsApi } from '../api/endpoints';
import type { Review } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { MapView } from '../components/MapView';
import { EmptyState, ErrorNotice, FacilityBadge, Field, Loading, Pagination, StarInput, Stars } from '../components/ui';
import { isApiError } from '../lib/errors';
import { formatEntryFee, formatMinutes, formatRating, formatTimestamp, hoursByDay, titleCase } from '../lib/format';
import { MAX_SELECTED_PLACES, tripDraft, useTripDraft } from '../trip/tripDraft';

export function PlaceDetailPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const draft = useTripDraft();
  const placeQuery = useQuery({ queryKey: ['place', id, user?.id ?? null], queryFn: () => placesApi.get(id) });

  if (placeQuery.isPending) return <div className="page"><Loading label="Loading place" /></div>;
  if (placeQuery.isError) {
    return (
      <div className="page narrow">
        {isApiError(placeQuery.error, 'PLACE_NOT_FOUND', 'NOT_FOUND') ? (
          <EmptyState title="This place is not available">
            It may have been archived, or it is still waiting for review. <Link to="/">Back to discovery</Link>
          </EmptyState>
        ) : (
          <ErrorNotice error={placeQuery.error} />
        )}
      </div>
    );
  }

  const place = placeQuery.data;
  const picked = draft.some((p) => p.id === place.id);
  const hours = place.openingHours.length ? hoursByDay(place.openingHours) : null;
  const isOwner = user?.id === place.createdBy;

  return (
    <div className="page detail">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/">Discover</Link> <span aria-hidden>/</span> <span>{place.category.name}</span>
      </nav>

      {place.status !== 'APPROVED' && (
        <div className={`banner banner--${place.status.toLowerCase()}`}>
          This place is <strong>{titleCase(place.status.toLowerCase())}</strong> and only visible to you and moderators.
          {isOwner && (place.status === 'PENDING' || place.status === 'REJECTED') && (
            <> <Link to={`/contribute/${place.id}`}>Edit submission</Link></>
          )}
        </div>
      )}

      <header className="detail__head">
        <div>
          <h1>{place.name}</h1>
          <p className="detail__sub">
            <span className="rating rating--lg">
              <Stars value={place.rating.average} size="lg" />
              {formatRating(place.rating.average, place.rating.count)}
            </span>
            {place.address && <span>{place.address}</span>}
            {place.city && !place.address && <span>{place.city}</span>}
          </p>
        </div>
        {place.status === 'APPROVED' && (
          <button
            className={`btn ${picked ? 'btn--ghost' : 'btn--primary'}`}
            disabled={!picked && draft.length >= MAX_SELECTED_PLACES}
            onClick={() =>
              picked
                ? tripDraft.remove(place.id)
                : tripDraft.add({ id: place.id, name: place.name, category: place.category.name, location: place.location })
            }
          >
            {picked ? 'Remove from trip' : 'Add to trip'}
          </button>
        )}
      </header>

      <div className="detail__grid">
        <div className="stack-lg">
          {place.description && <p className="lede">{place.description}</p>}

          <dl className="facts">
            <div>
              <dt>Entry</dt>
              <dd className={place.entryFee === null ? 'unknown' : ''}>{formatEntryFee(place.entryFee, place.currency)}</dd>
            </div>
            <div>
              <dt>Typical visit</dt>
              <dd className={place.typicalVisitMinutes === null ? 'unknown' : ''}>
                {place.typicalVisitMinutes === null ? 'Unknown' : formatMinutes(place.typicalVisitMinutes)}
              </dd>
            </div>
            <div>
              <dt>Category</dt>
              <dd>{place.category.name}</dd>
            </div>
          </dl>

          <section>
            <h2>Facilities</h2>
            <div className="facilities facilities--lg">
              <FacilityBadge label="Parking" status={place.facilities.parking} />
              <FacilityBadge label="Pet-friendly" status={place.facilities.petFriendly} />
              <FacilityBadge label="Wheelchair access" status={place.facilities.wheelchairAccessible} />
            </div>
            {place.facilities.restrictions && <p><strong>Restrictions:</strong> {place.facilities.restrictions}</p>}
            {place.facilities.accessibilityNotes && (
              <p><strong>Accessibility:</strong> {place.facilities.accessibilityNotes}</p>
            )}
            <p className="fine">
              {place.facilities.verifiedAt
                ? `Facilities last verified ${formatTimestamp(place.facilities.verifiedAt)}.`
                : 'Facilities have not been verified yet. Unknown means nobody has confirmed it.'}
            </p>
          </section>

          <section>
            <h2>Opening hours</h2>
            {hours ? (
              <table className="hours">
                <tbody>
                  {hours.map((h) => (
                    <tr key={h.day}>
                      <th scope="row">{h.day}</th>
                      <td className={h.text === 'Closed' ? 'muted' : ''}>{h.text}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="unknown">Opening hours are unknown. Check before you go.</p>
            )}
          </section>

          {place.tags.length > 0 && (
            <section>
              <h2>Good for</h2>
              <ul className="tags">
                {place.tags.map((t) => (
                  <li key={t}>{titleCase(t)}</li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside>
          <MapView
            ariaLabel={`Map showing ${place.name}`}
            className="map--detail"
            center={place.location}
            zoom={15}
            markers={[{ id: place.id, position: place.location, label: place.name, tone: 'selected' }]}
          />
          <p className="fine">
            {place.location.latitude.toFixed(5)}, {place.location.longitude.toFixed(5)}
          </p>
        </aside>
      </div>

      {place.status === 'APPROVED' && <Reviews placeId={place.id} />}
    </div>
  );
}

function Reviews({ placeId }: { placeId: string }) {
  const { user, isModerator } = useAuth();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const reviewsQuery = useQuery({
    queryKey: ['reviews', placeId, page],
    queryFn: () => reviewsApi.list(placeId, { page, limit: 10 }),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['reviews', placeId] });
    queryClient.invalidateQueries({ queryKey: ['place', placeId] }); // average rating changes
    queryClient.invalidateQueries({ queryKey: ['places'] });
  };

  const mine = reviewsQuery.data?.data.find((r) => r.author.id === user?.id);

  return (
    <section className="reviews">
      <h2>Reviews</h2>
      {user ? (
        mine ? null : <ReviewForm placeId={placeId} onSaved={refresh} />
      ) : (
        <p className="muted">
          <Link to="/login" state={{ from: `/places/${placeId}` }}>Sign in</Link> to rate this place.
        </p>
      )}

      {reviewsQuery.isPending && <Loading label="Loading reviews" />}
      {reviewsQuery.isError && <ErrorNotice error={reviewsQuery.error} />}
      {reviewsQuery.data?.data.length === 0 && <p className="muted">No reviews yet. Yours could be the first.</p>}
      <ul className="review-list">
        {reviewsQuery.data?.data.map((review) => (
          <ReviewItem
            key={review.id}
            review={review}
            canEdit={review.author.id === user?.id}
            canDelete={review.author.id === user?.id || isModerator}
            onChanged={refresh}
          />
        ))}
      </ul>
      {reviewsQuery.data && <Pagination meta={reviewsQuery.data.meta} onPage={setPage} />}
    </section>
  );
}

function ReviewForm({
  placeId,
  existing,
  onSaved,
  onCancel,
}: {
  placeId: string;
  existing?: Review;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [comment, setComment] = useState(existing?.comment ?? '');
  const save = useMutation({
    mutationFn: () => {
      const body = { rating, comment: comment.trim() || null };
      return existing ? reviewsApi.update(existing.id, body) : reviewsApi.create(placeId, body);
    },
    onSuccess: () => {
      if (!existing) {
        setRating(0);
        setComment('');
      }
      onSaved();
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (rating > 0) save.mutate();
  }

  return (
    <form className="review-form" onSubmit={onSubmit}>
      <p className="review-form__title">{existing ? 'Edit your review' : 'Rate this place'}</p>
      <StarInput value={rating} onChange={setRating} />
      <Field label="Your review (optional)">
        <textarea rows={3} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
      {save.isError && <ErrorNotice error={save.error} />}
      <div className="row">
        <button className="btn btn--primary" disabled={rating === 0 || save.isPending}>
          {save.isPending ? 'Saving…' : existing ? 'Save review' : 'Post review'}
        </button>
        {onCancel && (
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function ReviewItem({
  review,
  canEdit,
  canDelete,
  onChanged,
}: {
  review: Review;
  canEdit: boolean;
  canDelete: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const remove = useMutation({ mutationFn: () => reviewsApi.remove(review.id), onSuccess: onChanged });

  if (editing) {
    return (
      <li>
        <ReviewForm
          placeId={review.placeId}
          existing={review}
          onSaved={() => {
            setEditing(false);
            onChanged();
          }}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className="review">
      <div className="review__head">
        <Stars value={review.rating} />
        <strong>{review.author.name}</strong>
        <span className="fine">{formatTimestamp(review.createdAt)}</span>
      </div>
      {/* Community text is untrusted: rendered as plain text, never as HTML. */}
      {review.comment && <p className="review__text">{review.comment}</p>}
      {(canEdit || canDelete) && (
        <div className="row">
          {canEdit && (
            <button className="link-btn" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
          {canDelete && (
            <button
              className="link-btn link-btn--danger"
              disabled={remove.isPending}
              onClick={() => {
                if (window.confirm('Delete this review?')) remove.mutate();
              }}
            >
              Delete
            </button>
          )}
        </div>
      )}
      {remove.isError && <ErrorNotice error={remove.error} />}
    </li>
  );
}

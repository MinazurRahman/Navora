import { useState } from 'react';
import { Link } from 'react-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Pencil, Star, Trash2 } from 'lucide-react';
import { Button } from '../../components/Button.jsx';
import { Dialog } from '../../components/Dialog.jsx';
import { ErrorState } from '../../components/ErrorState.jsx';
import { Alert, EmptyState, Skeleton } from '../../components/Feedback.jsx';
import { Field, Textarea } from '../../components/Field.jsx';
import { useToast } from '../../components/useToast.js';
import { errorMessage, fieldErrors } from '../../lib/errors.js';
import { useAuth } from '../auth/useAuth.js';
import { createReview, deleteReview, getMyReview, listReviews, updateReview } from './api.js';
import styles from './Reviews.module.css';

const PAGE_SIZE = 10;
const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'Asia/Dhaka' });

export function StarRating({ rating }) {
  return (
    <span className={styles.stars} role="img" aria-label={`Rated ${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={16} aria-hidden="true" className={n <= rating ? styles.starOn : styles.starOff} />
      ))}
    </span>
  );
}

function RatingInput({ value, onChange, error }) {
  return (
    <fieldset className={styles.ratingField} aria-describedby={error ? 'rating-error' : undefined}>
      <legend className={styles.legend}>Rating</legend>
      <div className={styles.ratingOptions}>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className={styles.ratingOption} title={`${n} star${n === 1 ? '' : 's'}`}>
            <input
              type="radio"
              name="rating"
              value={n}
              checked={value === n}
              onChange={() => onChange(n)}
              className="visually-hidden"
            />
            <Star size={24} aria-hidden="true" className={n <= value ? styles.starOn : styles.starOff} />
            <span className="visually-hidden">
              {n} star{n === 1 ? '' : 's'}
            </span>
          </label>
        ))}
        <span className={styles.ratingText}>{value ? `${value} out of 5` : 'Choose a rating'}</span>
      </div>
      {error && (
        <p id="rating-error" className={styles.fieldError}>
          {error}
        </p>
      )}
    </fieldset>
  );
}

function ReviewForm({ placeId, existing, onDone }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [comment, setComment] = useState(existing?.comment ?? '');
  const [errors, setErrors] = useState({});

  const mutation = useMutation({
    mutationFn: (fields) => (existing ? updateReview(existing.id, fields) : createReview(placeId, fields)),
    onSuccess: (review) => {
      queryClient.setQueryData(['reviews', placeId, 'mine'], review);
      queryClient.invalidateQueries({ queryKey: ['reviews', placeId, 'list'] });
      queryClient.invalidateQueries({ queryKey: ['places'] }); // the place's rating changed
      toast.show({ tone: 'success', message: existing ? 'Your review was updated.' : 'Thank you. Your review was posted.' });
      onDone();
    },
    onError: (error) => {
      setErrors(fieldErrors(error));
      // Reviewed in another tab: show that review instead.
      if (error.code === 'REVIEW_ALREADY_EXISTS') queryClient.invalidateQueries({ queryKey: ['reviews', placeId, 'mine'] });
    },
  });

  function onSubmit(event) {
    event.preventDefault();
    if (!rating) {
      setErrors({ rating: 'Choose a rating from 1 to 5.' });
      return;
    }
    setErrors({});
    mutation.mutate({ rating, comment: comment.trim() || null });
  }

  const error = mutation.error;
  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      {error && error.code !== 'VALIDATION_ERROR' && <Alert tone="danger">{errorMessage(error)}</Alert>}
      <RatingInput value={rating} onChange={setRating} error={errors.rating} />
      <Field label="Comment" optional hint="Share what visitors should know. Up to 2,000 characters." error={errors.comment}>
        {(props) => (
          <Textarea {...props} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} />
        )}
      </Field>
      <div className="cluster">
        <Button type="submit" loading={mutation.isPending}>
          {existing ? 'Save changes' : 'Post review'}
        </Button>
        <Button variant="ghost" onClick={onDone} disabled={mutation.isPending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ReviewItem({ review, children }) {
  return (
    <article className={styles.review}>
      <div className={styles.reviewHeader}>
        <p className={styles.author}>{review.author.name}</p>
        <StarRating rating={review.rating} />
      </div>
      <p className={styles.date}>
        <time dateTime={review.createdAt}>{dateFormat.format(new Date(review.createdAt))}</time>
        {review.updatedAt !== review.createdAt && ' (edited)'}
      </p>
      {review.comment && <p className={styles.comment}>{review.comment}</p>}
      {children}
    </article>
  );
}

function MyReview({ placeId }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const mine = useQuery({
    queryKey: ['reviews', placeId, 'mine'],
    queryFn: ({ signal }) => getMyReview(placeId, { signal }),
  });
  const remove = useMutation({
    mutationFn: () => deleteReview(mine.data.id),
    onSuccess: () => {
      setConfirmDelete(false);
      queryClient.setQueryData(['reviews', placeId, 'mine'], null);
      queryClient.invalidateQueries({ queryKey: ['reviews', placeId, 'list'] });
      queryClient.invalidateQueries({ queryKey: ['places'] });
      toast.show({ tone: 'info', message: 'Your review was deleted.' });
    },
  });

  if (mine.isPending) return <Skeleton height="5rem" />;
  if (mine.isError) return <ErrorState error={mine.error} onRetry={mine.refetch} title="Your review could not be loaded" />;

  if (editing) {
    return (
      <div className={styles.mine}>
        <h3 className={styles.mineTitle}>{mine.data ? 'Edit your review' : 'Write a review'}</h3>
        <ReviewForm placeId={placeId} existing={mine.data} onDone={() => setEditing(false)} />
      </div>
    );
  }

  if (!mine.data) {
    return (
      <div className={styles.mine}>
        <p className="muted">Been here? Help others decide.</p>
        <div>
          <Button variant="secondary" icon={MessageSquare} onClick={() => setEditing(true)}>
            Write a review
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.mine}>
      <h3 className={styles.mineTitle}>Your review</h3>
      <ReviewItem review={mine.data}>
        <div className="cluster">
          <Button variant="secondary" size="sm" icon={Pencil} onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button variant="danger" size="sm" icon={Trash2} onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
        </div>
      </ReviewItem>
      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete your review?"
        description="Your rating and comment will be removed from this place. This cannot be undone."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={remove.isPending}>
              Cancel
            </Button>
            <Button variant="danger" icon={Trash2} loading={remove.isPending} onClick={() => remove.mutate()}>
              Delete review
            </Button>
          </>
        }
      >
        {remove.isError && <Alert tone="danger">{errorMessage(remove.error)}</Alert>}
      </Dialog>
    </div>
  );
}

// Reviews for an approved place: the list for everyone, plus the signed-in user's own review.
export function ReviewsSection({ placeId, reviewCount }) {
  const { status } = useAuth();
  const reviews = useInfiniteQuery({
    queryKey: ['reviews', placeId, 'list'],
    queryFn: ({ pageParam, signal }) => listReviews(placeId, { page: pageParam, limit: PAGE_SIZE }, { signal }),
    initialPageParam: 1,
    getNextPageParam: ({ meta }) => (meta.page < meta.totalPages ? meta.page + 1 : undefined),
  });
  const items = reviews.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <section className={styles.section} aria-labelledby="reviews-heading">
      <h2 id="reviews-heading">
        Reviews <span className={styles.count}>({reviewCount})</span>
      </h2>

      {status === 'authenticated' && <MyReview placeId={placeId} />}
      {status === 'anonymous' && (
        <p className="muted">
          <Link to={`/login?next=${encodeURIComponent(`/places/${placeId}`)}`}>Sign in</Link> to write a review.
        </p>
      )}

      {reviews.isPending && <Skeleton height="6rem" />}
      {reviews.isError && <ErrorState error={reviews.error} onRetry={reviews.refetch} title="Reviews could not be loaded" />}
      {reviews.data && items.length === 0 && (
        <EmptyState headingLevel={3} icon={MessageSquare} title="No reviews yet" description="Be the first to share your experience." />
      )}
      {items.length > 0 && (
        <ul className={styles.list}>
          {items.map((review) => (
            <li key={review.id}>
              <ReviewItem review={review} />
            </li>
          ))}
        </ul>
      )}
      {reviews.hasNextPage && (
        <div>
          <Button variant="secondary" loading={reviews.isFetchingNextPage} onClick={() => reviews.fetchNextPage()}>
            Show more reviews
          </Button>
        </div>
      )}
    </section>
  );
}

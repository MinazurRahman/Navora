import { ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors/AppError.js';
import { isModerator } from '../../shared/auth/authorization.js';
import { buildPaginationMeta } from '../../shared/validation/common.schemas.js';

const notFound = () => new NotFoundError('Review not found', 'REVIEW_NOT_FOUND');

function toReviewDto(row) {
  return {
    id: row.id,
    placeId: row.place_id,
    rating: row.rating,
    comment: row.comment,
    author: { id: row.user_id, name: row.author_name },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createReviewsService({ reviewsRepository, placesService }) {
  async function findReview(id) {
    const review = await reviewsRepository.findById(id);
    if (!review) throw notFound();
    return review;
  }

  return {
    async listForPlace(placeId, user, pagination) {
      await placesService.getById(placeId, user); // 404 unless the place is visible to this user
      const { reviews, total } = await reviewsRepository.listByPlace(placeId, pagination);
      return { reviews: reviews.map(toReviewDto), meta: buildPaginationMeta(pagination, total) };
    },

    // The caller's own review of a place, or null (one review per user and place).
    async findMine(placeId, user) {
      await placesService.getById(placeId, user);
      const review = await reviewsRepository.findByUserAndPlace(user.id, placeId);
      return review ? toReviewDto(review) : null;
    },

    async create(placeId, input, user) {
      const place = await placesService.getById(placeId, user);
      if (place.status !== 'APPROVED') {
        throw new ConflictError('Only approved places can be reviewed', 'PLACE_NOT_REVIEWABLE');
      }

      try {
        const id = await reviewsRepository.create({ userId: user.id, placeId, ...input });
        // The DB trigger changed the place's rating: cached place data is stale.
        await placesService.invalidateCache();
        return toReviewDto(await reviewsRepository.findById(id));
      } catch (err) {
        if (err.code === '23505' && err.constraint === 'reviews_user_place_key') {
          throw new ConflictError('You have already reviewed this place; edit your review instead', 'REVIEW_ALREADY_EXISTS');
        }
        throw err;
      }
    },

    // Only the author may change their words and rating.
    async update(id, patch, user) {
      const review = await findReview(id);
      if (review.user_id !== user.id) throw new ForbiddenError('You can only edit your own reviews');

      await reviewsRepository.update(id, patch);
      await placesService.invalidateCache();
      return toReviewDto(await reviewsRepository.findById(id));
    },

    // Authors may delete their own; moderators may remove any (abuse, spam).
    async delete(id, user) {
      const review = await findReview(id);
      if (review.user_id !== user.id && !isModerator(user)) {
        throw new ForbiddenError('You can only delete your own reviews');
      }
      await reviewsRepository.delete(id);
      await placesService.invalidateCache();
      return { id, deleted: true };
    },
  };
}

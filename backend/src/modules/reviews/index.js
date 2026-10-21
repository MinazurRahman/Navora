import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.middleware.js';
import { sendCreated, sendSuccess } from '../../shared/http/response.js';
import { idParamSchema, paginationQuerySchema, uuidSchema } from '../../shared/validation/common.schemas.js';
import { createReviewsService } from './reviews.service.js';

export { createReviewsRepository } from './reviews.repository.js';

// Whole stars only: 3.5 or "5" are rejected, matching the smallint column and its CHECK.
const reviewFields = {
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(2000).nullable().optional(),
};
const createReviewSchema = z.object(reviewFields);
const updateReviewSchema = z
  .object(reviewFields)
  .partial()
  .refine((fields) => Object.keys(fields).length > 0, 'provide rating and/or comment');
const placeParamSchema = z.object({ placeId: uuidSchema });

export function createReviewsModule({ reviewsRepository, placesService, authenticate, optionalAuth, rateLimit }) {
  const reviewsService = createReviewsService({ reviewsRepository, placesService });
  const router = Router();

  router.get(
    '/places/:placeId/reviews',
    optionalAuth,
    validate({ params: placeParamSchema, query: paginationQuerySchema }),
    async (req, res) => {
      const { reviews, meta } = await reviewsService.listForPlace(req.validated.params.placeId, req.user, req.validated.query);
      sendSuccess(res, reviews, { meta });
    },
  );

  router.get('/places/:placeId/reviews/mine', authenticate, validate({ params: placeParamSchema }), async (req, res) => {
    sendSuccess(res, await reviewsService.findMine(req.validated.params.placeId, req.user));
  });

  router.post(
    '/places/:placeId/reviews',
    authenticate,
    rateLimit('reviews'),
    validate({ params: placeParamSchema, body: createReviewSchema }),
    async (req, res) => {
      sendCreated(res, await reviewsService.create(req.validated.params.placeId, req.validated.body, req.user));
    },
  );

  router.patch(
    '/reviews/:id',
    authenticate,
    validate({ params: idParamSchema, body: updateReviewSchema }),
    async (req, res) => {
      sendSuccess(res, await reviewsService.update(req.validated.params.id, req.validated.body, req.user));
    },
  );

  router.delete('/reviews/:id', authenticate, validate({ params: idParamSchema }), async (req, res) => {
    sendSuccess(res, await reviewsService.delete(req.validated.params.id, req.user));
  });

  return { router };
}

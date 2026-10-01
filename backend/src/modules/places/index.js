import { Router } from 'express';
import { validate } from '../../middleware/validate.middleware.js';
import { idParamSchema } from '../../shared/validation/common.schemas.js';
import { createPlacesService } from './places.service.js';
import { createPlacesController } from './places.controller.js';
import {
  approvePlaceSchema,
  createPlaceSchema,
  listPlacesQuerySchema,
  moderationQueueQuerySchema,
  mySubmissionsQuerySchema,
  nearbyPlacesQuerySchema,
  rejectPlaceSchema,
  searchPlacesQuerySchema,
  updatePlaceSchema,
} from './places.schemas.js';

export { createPlacesRepository } from './places.repository.js';

export function createPlacesModule({
  placesRepository,
  categoriesService,
  transaction,
  authenticate,
  optionalAuth,
  requireRole,
  rateLimit,
}) {
  const placesService = createPlacesService({ placesRepository, categoriesService, transaction });
  const c = createPlacesController(placesService);
  const moderatorOnly = [authenticate, requireRole('moderator', 'admin')];
  const router = Router();

  // Fixed paths before /:id.
  router.get('/', validate({ query: listPlacesQuerySchema }), c.list);
  router.get('/nearby', validate({ query: nearbyPlacesQuerySchema }), c.nearby);
  router.get('/search', validate({ query: searchPlacesQuerySchema }), c.search);
  router.get('/mine', authenticate, validate({ query: mySubmissionsQuerySchema }), c.mine);
  router.get('/moderation', moderatorOnly, validate({ query: moderationQueueQuerySchema }), c.moderationQueue);
  router.get('/:id', optionalAuth, validate({ params: idParamSchema }), c.get);

  router.post('/', authenticate, rateLimit('submissions'), validate({ body: createPlaceSchema }), c.create);
  router.patch('/:id', authenticate, validate({ params: idParamSchema, body: updatePlaceSchema }), c.update);
  router.delete('/:id', authenticate, validate({ params: idParamSchema }), c.archive);

  router.post('/:id/approve', moderatorOnly, validate({ params: idParamSchema, body: approvePlaceSchema }), c.approve);
  router.post('/:id/reject', moderatorOnly, validate({ params: idParamSchema, body: rejectPlaceSchema }), c.reject);
  router.get('/:id/moderation-events', authenticate, validate({ params: idParamSchema }), c.moderationHistory);

  return { router, placesService };
}

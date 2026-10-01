import { Router } from 'express';
import { validate } from '../../middleware/validate.middleware.js';
import { idParamSchema } from '../../shared/validation/common.schemas.js';
import { createPlacesService } from './places.service.js';
import { createPlacesController } from './places.controller.js';
import {
  createPlaceSchema,
  listPlacesQuerySchema,
  nearbyPlacesQuerySchema,
  searchPlacesQuerySchema,
  updatePlaceSchema,
} from './places.schemas.js';

export { createPlacesRepository } from './places.repository.js';

export function createPlacesModule({ placesRepository, categoriesService, transaction, authenticate, optionalAuth, rateLimit }) {
  const c = createPlacesController(createPlacesService({ placesRepository, categoriesService, transaction }));
  const router = Router();

  // Fixed paths before /:id.
  router.get('/', validate({ query: listPlacesQuerySchema }), c.list);
  router.get('/nearby', validate({ query: nearbyPlacesQuerySchema }), c.nearby);
  router.get('/search', validate({ query: searchPlacesQuerySchema }), c.search);
  router.get('/:id', optionalAuth, validate({ params: idParamSchema }), c.get);

  router.post('/', authenticate, rateLimit('submissions'), validate({ body: createPlaceSchema }), c.create);
  router.patch('/:id', authenticate, validate({ params: idParamSchema, body: updatePlaceSchema }), c.update);
  router.delete('/:id', authenticate, validate({ params: idParamSchema }), c.archive);

  return { router };
}

import { Router } from 'express';
import { validate } from '../../middleware/validate.middleware.js';
import { privateNoStoreMiddleware } from '../../middleware/security.middleware.js';
import { sendCreated, sendSuccess } from '../../shared/http/response.js';
import { idParamSchema, paginationQuerySchema } from '../../shared/validation/common.schemas.js';
import { createTripSchema, updateTripSchema } from './trips.schemas.js';
import { createTripsService } from './trips.service.js';

export { createTripsRepository } from './trips.repository.js';

export function createTripsModule({ tripsRepository, categoriesService, placesService, transaction, authenticate }) {
  const tripsService = createTripsService({ tripsRepository, categoriesService, placesService, transaction });
  const router = Router();
  router.use(privateNoStoreMiddleware(), authenticate); // trips are always private

  router.post('/', validate({ body: createTripSchema }), async (req, res) => {
    sendCreated(res, await tripsService.create(req.validated.body, req.user));
  });

  router.get('/', validate({ query: paginationQuerySchema }), async (req, res) => {
    const { trips, meta } = await tripsService.list(req.validated.query, req.user);
    sendSuccess(res, trips, { meta });
  });

  router.get('/:id', validate({ params: idParamSchema }), async (req, res) => {
    sendSuccess(res, await tripsService.get(req.validated.params.id, req.user));
  });

  router.patch('/:id', validate({ params: idParamSchema, body: updateTripSchema }), async (req, res) => {
    sendSuccess(res, await tripsService.update(req.validated.params.id, req.validated.body, req.user));
  });

  router.delete('/:id', validate({ params: idParamSchema }), async (req, res) => {
    sendSuccess(res, await tripsService.delete(req.validated.params.id, req.user));
  });

  return { router, tripsService };
}

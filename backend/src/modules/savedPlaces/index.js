import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.middleware.js';
import { privateNoStoreMiddleware } from '../../middleware/security.middleware.js';
import { sendSuccess } from '../../shared/http/response.js';
import { paginationQuerySchema, uuidSchema } from '../../shared/validation/common.schemas.js';
import { SAVED_PLACES_CONFIG } from '../../config/savedPlaces.js';
import { createSavedPlacesService } from './savedPlaces.service.js';

export { createSavedPlacesRepository } from './savedPlaces.repository.js';

const placeParamSchema = z.object({ placeId: uuidSchema });
const saveBodySchema = z.object({ placeId: uuidSchema });

export function createSavedPlacesModule({ savedPlacesRepository, placesService, authenticate, config = SAVED_PLACES_CONFIG }) {
  const savedPlacesService = createSavedPlacesService({ savedPlacesRepository, placesService, config });
  const router = Router();
  router.use(privateNoStoreMiddleware(), authenticate); // a user's saved places are private

  router.get('/', validate({ query: paginationQuerySchema }), async (req, res) => {
    const { places, meta } = await savedPlacesService.list(req.validated.query, req.user);
    sendSuccess(res, places, { meta });
  });

  router.post('/', validate({ body: saveBodySchema }), async (req, res) => {
    sendSuccess(res, await savedPlacesService.save(req.validated.body.placeId, req.user));
  });

  router.get('/:placeId', validate({ params: placeParamSchema }), async (req, res) => {
    sendSuccess(res, await savedPlacesService.status(req.validated.params.placeId, req.user));
  });

  router.delete('/:placeId', validate({ params: placeParamSchema }), async (req, res) => {
    sendSuccess(res, await savedPlacesService.remove(req.validated.params.placeId, req.user));
  });

  return { router };
}

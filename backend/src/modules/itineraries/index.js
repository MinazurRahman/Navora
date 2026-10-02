import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.middleware.js';
import { sendCreated, sendSuccess } from '../../shared/http/response.js';
import { idParamSchema } from '../../shared/validation/common.schemas.js';
import { PLANNING_CONFIG } from '../../config/planning.js';
import { RECOMMENDATION_CONFIG } from '../../config/recommendation.js';
import { createEstimatedTravel } from '../routing/travelEstimator.js';
import { createItinerariesService } from './itineraries.service.js';

export { createItinerariesRepository } from './itineraries.repository.js';

const generateSchema = z.object({ tripId: z.uuid() });

export function createItinerariesModule({ itinerariesRepository, tripsService, placesService, transaction, mapService, authenticate, rateLimit }) {
  const service = createItinerariesService({
    itinerariesRepository,
    tripsService,
    placesService,
    transaction,
    travel: createEstimatedTravel(PLANNING_CONFIG),
    mapService,
    recommendationConfig: RECOMMENDATION_CONFIG,
    planningConfig: PLANNING_CONFIG,
  });
  const router = Router();
  router.use(authenticate); // itineraries are private

  // Generating again for the same trip creates a new version and makes it current.
  router.post('/generate', rateLimit('routing'), validate({ body: generateSchema }), async (req, res) => {
    sendCreated(res, await service.generate(req.validated.body.tripId, req.user));
  });

  router.get('/:id', validate({ params: idParamSchema }), async (req, res) => {
    sendSuccess(res, await service.get(req.validated.params.id, req.user));
  });

  return { router };
}

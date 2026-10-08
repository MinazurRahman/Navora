import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.middleware.js';
import { sendCreated, sendSuccess } from '../../shared/http/response.js';
import { idParamSchema, paginationQuerySchema } from '../../shared/validation/common.schemas.js';
import { PLANNING_CONFIG } from '../../config/planning.js';
import { RECOMMENDATION_CONFIG } from '../../config/recommendation.js';
import { createEstimatedTravel } from '../routing/travelEstimator.js';
import { createItinerariesService } from './itineraries.service.js';

export { createItinerariesRepository } from './itineraries.repository.js';

const generateSchema = z.object({ tripId: z.uuid() });

const listQuerySchema = paginationQuerySchema.extend({
  tripId: z.uuid().optional(),
  current: z.enum(['true', 'false']).optional().transform((value) => value === 'true'),
});

// Each listed day is replaced by these places in this order. Days not listed are unchanged.
const updateSchema = z.object({
  days: z
    .array(
      z.object({
        dayNumber: z.number().int().min(1).max(14),
        placeIds: z.array(z.uuid()).max(12),
        optimizeOrder: z.boolean().default(false), // false = keep the given order
      }),
    )
    .min(1)
    .max(14)
    .refine((days) => new Set(days.map((d) => d.dayNumber)).size === days.length, 'each day may be listed only once'),
});

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

  // My itineraries (all versions, newest first): ?tripId=…&current=true&page=&limit=
  router.get('/', validate({ query: listQuerySchema }), async (req, res) => {
    const { tripId, current, page, limit } = req.validated.query;
    const { itineraries, meta } = await service.list({ tripId, currentOnly: current, page, limit }, req.user);
    sendSuccess(res, itineraries, { meta });
  });

  router.get('/:id', validate({ params: idParamSchema }), async (req, res) => {
    sendSuccess(res, await service.get(req.validated.params.id, req.user));
  });

  // Edits re-check travel times with the routing provider: same limit as generation.
  router.patch('/:id', rateLimit('routing'), validate({ params: idParamSchema, body: updateSchema }), async (req, res) => {
    sendSuccess(res, await service.update(req.validated.params.id, req.validated.body.days, req.user));
  });

  router.post('/:id/regenerate', rateLimit('routing'), validate({ params: idParamSchema }), async (req, res) => {
    sendCreated(res, await service.regenerate(req.validated.params.id, req.user));
  });

  router.delete('/:id', validate({ params: idParamSchema }), async (req, res) => {
    sendSuccess(res, await service.delete(req.validated.params.id, req.user));
  });

  return { router, itinerariesService: service };
}

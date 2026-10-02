import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.middleware.js';
import { sendSuccess } from '../../shared/http/response.js';
import { ValidationError } from '../../shared/errors/AppError.js';
import { RECOMMENDATION_CONFIG } from '../../config/recommendation.js';
import { timeOfDaySchema } from '../places/places.schemas.js';
import { todayIn } from '../recommendations/schedule.js';
import { createRoutingService } from './routing.service.js';

export const MAX_STOPS_PER_ROUTE = 12;

const location = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) });

export const optimizeRouteSchema = z.object({
  start: location,
  travelMode: z.enum(['car', 'walking', 'cycling', 'public_transport']).default('car'),
  returnToStart: z.boolean().default(true),
  days: z
    .array(
      z
        .object({
          date: z.iso.date().optional(), // default: consecutive days from today
          dailyStartTime: timeOfDaySchema.default('09:00'),
          dailyEndTime: timeOfDaySchema.default('20:00'),
          placeIds: z
            .array(z.uuid())
            .min(1)
            .max(MAX_STOPS_PER_ROUTE)
            .refine((ids) => new Set(ids).size === ids.length, 'each place may appear only once per day'),
        })
        .refine((day) => day.dailyStartTime < day.dailyEndTime, { message: 'dailyStartTime must be before dailyEndTime', path: ['dailyEndTime'] }),
    )
    .min(1)
    .max(14),
});

export function createRoutingModule({ mapService, placesService, authenticate, rateLimit }) {
  const routingService = createRoutingService({ mapService });
  const router = Router();

  // Only places this user can see and that are approved can be routed.
  async function resolvePlaces(days, user) {
    const resolved = [];
    const found = await placesService.getVisibleByIds(days.flatMap((day) => day.placeIds), user);
    for (const [d, day] of days.entries()) {
      const places = [];
      for (const [p, placeId] of day.placeIds.entries()) {
        const place = found.get(placeId);
        if (!place || place.status !== 'APPROVED') {
          throw new ValidationError('Invalid request data', [
            { location: 'body', path: `days.${d}.placeIds.${p}`, message: 'Unknown or unapproved place' },
          ]);
        }
        places.push(place);
      }
      resolved.push({ date: day.date, dailyStartTime: day.dailyStartTime, dailyEndTime: day.dailyEndTime, places });
    }
    return resolved;
  }

  // Calls the (paid) routing provider: signed-in users only, fail-closed rate limit.
  router.post('/optimize', authenticate, rateLimit('routing'), validate({ body: optimizeRouteSchema }), async (req, res) => {
    const { days, ...rest } = req.validated.body;
    const result = await routingService.optimize({
      ...rest,
      startDate: todayIn(RECOMMENDATION_CONFIG.timezone),
      days: await resolvePlaces(days, req.user),
    });
    sendSuccess(res, result);
  });

  return { router, routingService };
}

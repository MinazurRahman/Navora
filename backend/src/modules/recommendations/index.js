import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.middleware.js';
import { sendSuccess } from '../../shared/http/response.js';
import { RECOMMENDATION_CONFIG } from '../../config/recommendation.js';
import { timeOfDaySchema } from '../places/places.schemas.js';
import { createRecommendationsService, MAX_SEARCH_RADIUS_KM } from './recommendations.service.js';

const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9_]{1,50}$/, 'must be a slug like "history"');
const uniqueSlugs = z.array(slug).max(10).default([]).transform((slugs) => [...new Set(slugs)]);

export const recommendationRequestSchema = z
  .object({
    location: z.object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
    }),
    searchRadiusKm: z.number().gt(0).max(MAX_SEARCH_RADIUS_KM).default(10),
    interests: uniqueSlugs,
    preferredCategories: uniqueSlugs,
    budget: z
      .object({
        amount: z.number().min(0).max(100_000_000),
        type: z.enum(['total', 'per_day']),
        currency: z.string().regex(/^[A-Z]{3}$/).default('BDT'),
      })
      .optional(),
    durationDays: z.number().int().min(1).max(14).default(1),
    startDate: z.iso.date().optional(), // default: today in the configured timezone
    dailyStartTime: timeOfDaySchema.default('09:00'),
    dailyEndTime: timeOfDaySchema.default('20:00'),
    // Hard requirements: only places explicitly marked YES qualify.
    travelingWithPet: z.boolean().default(false),
    parkingRequired: z.boolean().default(false),
    wheelchairAccessRequired: z.boolean().default(false),
    // Hard filter when given: unrated places do not qualify.
    minimumRating: z.number().min(1).max(5).optional(),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .refine((body) => body.dailyStartTime < body.dailyEndTime, {
    message: 'dailyStartTime must be before dailyEndTime',
    path: ['dailyEndTime'],
  });

export function createRecommendationsModule({ placesService, categoriesService, cache, rateLimit, config = RECOMMENDATION_CONFIG }) {
  const service = createRecommendationsService({ placesService, categoriesService, cache, config });
  const router = Router();

  // No login needed; the rate limit buckets by user when a token is sent, else by IP.
  router.post('/', rateLimit('recommendations'), validate({ body: recommendationRequestSchema }), async (req, res) => {
    const { recommendations, meta } = await service.recommend(req.validated.body);
    sendSuccess(res, recommendations, { meta });
  });

  return { router };
}

import { hashKey } from '../../integrations/redis/cache.js';
import { CACHE_TTL } from '../../config/cache.js';
import { CACHE_NAMESPACE as PLACES_CACHE_NAMESPACE } from '../places/places.service.js';
import { applyHardConstraints, buildContext, buildSuggestions, rankPlaces } from './scoring.js';
import { todayIn } from './schedule.js';

export const MAX_SEARCH_RADIUS_KM = 50;

const round3 = (value) => Math.round(value * 1000) / 1000;

export function createRecommendationsService({ placesService, categoriesService, cache, config, today = () => todayIn(config.timezone) }) {
  async function compute(input) {
    const ctx = buildContext(input, input.startDate);
    const { places, total } = await placesService.findCandidates({
      ...input.location,
      radiusMeters: ctx.radiusMeters,
      limit: config.maxCandidates,
    });
    const { eligible, excludedBy } = applyHardConstraints(places, ctx, config);
    const recommendations = rankPlaces(eligible, ctx, config).slice(0, input.limit);

    return {
      recommendations,
      meta: {
        startDate: input.startDate,
        durationDays: input.durationDays,
        searchRadiusKm: input.searchRadiusKm,
        candidatesInRadius: total,
        candidatesConsidered: places.length,
        eligible: eligible.length,
        returned: recommendations.length,
        excludedBy,
        suggestions: eligible.length < config.suggestBelow ? buildSuggestions(excludedBy, ctx, MAX_SEARCH_RADIUS_KM) : [],
      },
    };
  }

  return {
    async recommend(input) {
      await Promise.all([
        categoriesService.requireTags(input.interests, 'interests'),
        categoriesService.requireCategories(input.preferredCategories, 'preferredCategories'),
      ]);

      // Normalised so equivalent requests share a cache entry. Coordinates rounded to
      // ~110 m (used for the query too, so cached and fresh results are identical).
      const normalized = {
        ...input,
        location: { latitude: round3(input.location.latitude), longitude: round3(input.location.longitude) },
        startDate: input.startDate ?? today(),
        interests: [...input.interests].sort(),
        preferredCategories: [...input.preferredCategories].sort(),
      };

      // Results depend only on the request and public place data: cached in the places
      // namespace, so any place or review change invalidates them.
      return cache.getOrSet(`recommendations:${hashKey(normalized)}`, CACHE_TTL.recommendations, () => compute(normalized), {
        namespace: PLACES_CACHE_NAMESPACE,
      });
    },
  };
}

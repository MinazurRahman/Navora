import { AppError, UnauthorizedError, UnprocessableError } from '../../shared/errors/AppError.js';
import { getLogger } from '../../shared/logger.js';
import { recommendationRequestSchema } from '../recommendations/index.js';
import { buildAssistantContext } from './context.js';

// Loads everything the assistant's context needs through other modules' services, so their
// authorisation rules apply unchanged (other users' trips and itineraries are 404). Read-only:
// it calls no write methods and never touches the database itself.
export function createAssistantContextLoader({ itinerariesService, tripsService, placesService, recommendationsService, config }) {
  function requireUser(user) {
    if (!user?.id) throw new UnauthorizedError();
  }

  // The engine's own ranking for the trip's requirements, validated by its own schema.
  // Unavailable (e.g. an interest tag was removed since the trip was saved) → null: the
  // assistant can still explain the itinerary, it just has no scores to quote.
  async function recommendationsFor(trip, startDate) {
    const parsed = recommendationRequestSchema.safeParse({
      location: trip.startLocation,
      searchRadiusKm: trip.searchRadiusKm,
      interests: trip.interests,
      preferredCategories: trip.preferredCategories,
      ...(trip.budget && { budget: trip.budget }),
      durationDays: trip.durationDays,
      ...(startDate && { startDate }),
      dailyStartTime: trip.dailyStartTime,
      dailyEndTime: trip.dailyEndTime,
      travelingWithPet: trip.travelingWithPet,
      parkingRequired: trip.parkingRequired,
      wheelchairAccessRequired: trip.wheelchairAccessRequired,
      ...(trip.minimumRating !== null && trip.minimumRating !== undefined && { minimumRating: trip.minimumRating }),
      limit: config.recommendationCandidates,
    });
    if (!parsed.success) {
      getLogger().warn({ issues: parsed.error.issues.map((i) => i.path.join('.')) }, 'Trip does not form a valid recommendation request');
      return null;
    }
    try {
      return await recommendationsService.recommend(parsed.data);
    } catch (err) {
      if (!(err instanceof AppError && err.status < 500)) throw err;
      getLogger().warn({ code: err.code }, 'Recommendations unavailable for assistant context');
      return null;
    }
  }

  return {
    // Context for one itinerary version, built from the trip snapshot it was planned with.
    async forItinerary(itineraryId, user) {
      requireUser(user);
      const itinerary = await itinerariesService.get(itineraryId, user); // 404 unless owned
      const { trip, startDate, startDateAssumed } = itinerary.generatedFrom;
      const placeIds = [
        ...itinerary.days.flatMap((day) => day.stops.map((stop) => stop.place.id)),
        ...(itinerary.warnings ?? []).filter((w) => w.placeId).map((w) => w.placeId),
      ];
      const [placesById, recommendations] = await Promise.all([
        placesService.getVisibleByIds(placeIds, user),
        recommendationsFor(trip, startDate),
      ]);
      const built = buildAssistantContext({ trip, startDate, startDateAssumed, itinerary, placesById, recommendations, config });
      return { ...built, itineraryId: itinerary.id };
    },

    // Context for a trip's current itinerary.
    async forCurrentItinerary(tripId, user) {
      requireUser(user);
      const trip = await tripsService.get(tripId, user); // 404 unless owned
      if (!trip.currentItineraryId) {
        throw new UnprocessableError('ITINERARY_NOT_GENERATED', 'This trip has no itinerary yet; generate one first');
      }
      return this.forItinerary(trip.currentItineraryId, user);
    },

    // Context for a saved trip without an itinerary: requirements and recommendations.
    async forTrip(tripId, user) {
      requireUser(user);
      const trip = await tripsService.get(tripId, user); // 404 unless owned
      const recommendations = await recommendationsFor(trip, trip.startDate);
      return buildAssistantContext({
        trip,
        startDate: trip.startDate ?? recommendations?.meta.startDate ?? null,
        startDateAssumed: trip.startDate === null,
        recommendations,
        config,
      });
    },
  };
}

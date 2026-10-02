import { NotFoundError, ValidationError } from '../../shared/errors/AppError.js';
import { buildPaginationMeta } from '../../shared/validation/common.schemas.js';

const hhmm = (time) => time.slice(0, 5); // pg returns "HH:MM:SS"

export function toTripDto(row) {
  return {
    id: row.id,
    title: row.title,
    startLocation: { latitude: row.start_latitude, longitude: row.start_longitude },
    startAddress: row.start_address,
    startDate: row.start_date,
    durationDays: row.duration_days,
    dailyStartTime: hhmm(row.daily_start_time),
    dailyEndTime: hhmm(row.daily_end_time),
    searchRadiusKm: row.search_radius_m / 1000,
    budget: row.budget_amount === null ? null : { amount: Number(row.budget_amount), type: row.budget_type, currency: row.budget_currency },
    travelMode: row.travel_mode,
    travelingWithPet: row.traveling_with_pet,
    parkingRequired: row.parking_required,
    wheelchairAccessRequired: row.wheelchair_access_required,
    partySize: row.party_size,
    minimumRating: row.min_rating === null ? null : Number(row.min_rating),
    interests: row.interests,
    preferredCategories: row.preferred_categories,
    selectedPlaceIds: row.selected_place_ids,
    currentItineraryId: row.current_itinerary_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Trips are private: other users get 404, as if the trip did not exist.
export function createTripsService({ tripsRepository, categoriesService, placesService, transaction }) {
  const notFound = () => new NotFoundError('Trip not found', 'TRIP_NOT_FOUND');

  async function findOwnedRow(id, user) {
    const trip = await tripsRepository.findById(id);
    if (!trip || trip.user_id !== user.id) throw notFound();
    return trip;
  }

  // Slugs → IDs; selected places must exist, be visible to the user and be approved.
  async function resolveLinks(fields, user) {
    const links = {};
    if (fields.interests) links.tagIds = (await categoriesService.requireTags(fields.interests, 'interests')).map((t) => t.id);
    if (fields.preferredCategories) {
      links.categoryIds = (await categoriesService.requireCategories(fields.preferredCategories)).map((c) => c.id);
    }
    if (fields.selectedPlaceIds) {
      const found = await placesService.getVisibleByIds(fields.selectedPlaceIds, user);
      for (const [index, placeId] of fields.selectedPlaceIds.entries()) {
        const place = found.get(placeId);
        if (!place || place.status !== 'APPROVED') {
          throw new ValidationError('Invalid request data', [
            { location: 'body', path: `selectedPlaceIds.${index}`, message: 'Unknown or unapproved place' },
          ]);
        }
      }
      links.selectedPlaceIds = fields.selectedPlaceIds;
    }
    return links;
  }

  return {
    findOwnedRow,

    async create(input, user) {
      const links = await resolveLinks(input, user);
      const id = await transaction(async (trx) => {
        const tripId = await tripsRepository.create({ ...input, userId: user.id }, trx);
        await tripsRepository.replaceLinks(tripId, links, trx);
        return tripId;
      });
      return toTripDto(await tripsRepository.findById(id));
    },

    async get(id, user) {
      return toTripDto(await findOwnedRow(id, user));
    },

    async list(pagination, user) {
      const { trips, total } = await tripsRepository.listByUser(user.id, pagination);
      return { trips: trips.map(toTripDto), meta: buildPaginationMeta(pagination, total) };
    },

    async update(id, patch, user) {
      const current = toTripDto(await findOwnedRow(id, user));
      const start = patch.dailyStartTime ?? current.dailyStartTime;
      const end = patch.dailyEndTime ?? current.dailyEndTime;
      if (start >= end) {
        throw new ValidationError('Invalid request data', [
          { location: 'body', path: 'dailyEndTime', message: 'dailyStartTime must be before dailyEndTime' },
        ]);
      }

      const links = await resolveLinks(patch, user);
      await transaction(async (trx) => {
        await tripsRepository.update(id, patch, trx);
        await tripsRepository.replaceLinks(id, links, trx);
      });
      return toTripDto(await tripsRepository.findById(id));
    },

    // Deletes the trip and, via ON DELETE CASCADE, its itineraries.
    async delete(id, user) {
      await findOwnedRow(id, user);
      await tripsRepository.delete(id);
      return { id, deleted: true };
    },
  };
}

import { ConflictError } from '../../shared/errors/AppError.js';
import { buildPaginationMeta } from '../../shared/validation/common.schemas.js';

export function createSavedPlacesService({ savedPlacesRepository, placesService, config }) {
  return {
    async list(pagination, user) {
      const { placeIds, total } = await savedPlacesRepository.listApprovedPlaceIds(user.id, pagination);
      const places = await placesService.getVisibleByIds(placeIds, user);
      return {
        places: placeIds.map((id) => places.get(id)).filter(Boolean),
        meta: buildPaginationMeta(pagination, total),
      };
    },

    async status(placeId, user) {
      return { placeId, saved: await savedPlacesRepository.isSaved(user.id, placeId) };
    },

    // Idempotent. Only approved (public) places can be saved; others are 404 unless the
    // caller may see them (same rule as GET /places/:id).
    async save(placeId, user) {
      const place = await placesService.getById(placeId, user);
      if (place.status !== 'APPROVED') {
        throw new ConflictError('Only approved places can be saved', 'PLACE_NOT_SAVEABLE');
      }
      // ponytail: count-then-insert is not atomic; two parallel saves at the limit can
      // go one over. Harmless for a soft cap; use a DB constraint if it must be exact.
      if (!(await savedPlacesRepository.isSaved(user.id, placeId))) {
        if ((await savedPlacesRepository.countByUser(user.id)) >= config.maxPerUser) {
          throw new ConflictError(`You can save up to ${config.maxPerUser} places`, 'SAVED_PLACES_LIMIT_REACHED');
        }
        await savedPlacesRepository.save(user.id, placeId);
      }
      return { placeId, saved: true };
    },

    // Idempotent: removing a place that is not saved succeeds.
    async remove(placeId, user) {
      await savedPlacesRepository.remove(user.id, placeId);
      return { placeId, saved: false };
    },
  };
}

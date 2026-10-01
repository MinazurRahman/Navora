import { ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors/AppError.js';
import { isModerator } from '../../shared/auth/authorization.js';
import { buildPaginationMeta } from '../../shared/validation/common.schemas.js';
import { toPlaceDto } from './places.mapper.js';

const notFound = () => new NotFoundError('Place not found', 'PLACE_NOT_FOUND');

// Approved places are public. Anything else is visible only to its submitter and
// moderators; for everyone else it does not exist (404, not 403, so nothing leaks).
function canView(place, user) {
  return place.status === 'APPROVED' || isModerator(user) || (user && place.created_by === user.id);
}

// Submitter edit rules: PENDING stays PENDING; REJECTED goes back to PENDING (resubmission);
// APPROVED and ARCHIVED only moderators may change.
function planEdit(place, user) {
  if (isModerator(user)) return { action: 'EDITED', toStatus: place.status };
  if (place.created_by !== user.id) throw new ForbiddenError('Only the submitter or a moderator can modify this place');
  if (place.status === 'PENDING') return { action: 'EDITED', toStatus: 'PENDING' };
  if (place.status === 'REJECTED') return { action: 'RESUBMITTED', toStatus: 'PENDING' };
  throw new ForbiddenError(
    place.status === 'APPROVED' ? 'Approved places can only be changed by moderators' : 'Archived places cannot be changed',
  );
}

export function createPlacesService({ placesRepository, categoriesService, transaction }) {
  async function findVisible(id, user, conn, options) {
    const place = await placesRepository.findById(id, conn, options);
    if (!place || !canView(place, user)) throw notFound();
    return place;
  }

  async function withCategoryId({ category, ...fields }) {
    if (category === undefined) return fields;
    return { ...fields, categoryId: (await categoriesService.requireBySlug(category)).id };
  }

  async function searchPage(query, extra) {
    const { places, total } = await placesRepository.search({
      categories: query.category,
      maxEntryFee: query.maxEntryFee,
      minRating: query.minRating,
      page: query.page,
      limit: query.limit,
      ...extra,
    });
    return { places: places.map(toPlaceDto), meta: buildPaginationMeta(query, total) };
  }

  return {
    list(query) {
      return searchPage(query, { sort: 'newest' });
    },

    nearby(query) {
      const near = { latitude: query.latitude, longitude: query.longitude, radiusMeters: query.radiusKm * 1000 };
      return searchPage(query, { near, sort: 'distance' });
    },

    search(query) {
      return searchPage(query, { q: query.q, sort: 'relevance' });
    },

    async getById(id, user) {
      return toPlaceDto(await findVisible(id, user));
    },

    // Community submissions start PENDING; moderators' places are approved directly.
    async create(input, user) {
      const fields = await withCategoryId(input);
      const status = isModerator(user) ? 'APPROVED' : 'PENDING';

      return transaction(async (trx) => {
        const id = await placesRepository.create({ ...fields, status, createdBy: user.id }, trx);
        await placesRepository.addModerationEvent(
          { placeId: id, actorId: user.id, action: 'SUBMITTED', fromStatus: null, toStatus: status },
          trx,
        );
        return toPlaceDto(await placesRepository.findById(id, trx));
      });
    },

    async update(id, patch, user) {
      const fields = await withCategoryId(patch);

      return transaction(async (trx) => {
        // Row lock: a moderator decision and a resubmission cannot interleave.
        const place = await findVisible(id, user, trx, { lock: true });
        const { action, toStatus } = planEdit(place, user);

        await placesRepository.update(id, { ...fields, status: toStatus }, trx);
        await placesRepository.addModerationEvent(
          { placeId: id, actorId: user.id, action, fromStatus: place.status, toStatus },
          trx,
        );
        return toPlaceDto(await placesRepository.findById(id, trx));
      });
    },

    // Moderator decision on a PENDING submission. decision: 'APPROVED' | 'REJECTED'.
    async moderate(id, user, decision, note) {
      return transaction(async (trx) => {
        const place = await placesRepository.findById(id, trx, { lock: true });
        if (!place) throw notFound();
        if (place.status !== 'PENDING') {
          throw new ConflictError(
            `Only PENDING places can be approved or rejected (this one is ${place.status})`,
            'INVALID_STATUS_TRANSITION',
          );
        }

        await placesRepository.update(id, { status: decision }, trx);
        await placesRepository.addModerationEvent(
          { placeId: id, actorId: user.id, action: decision, fromStatus: 'PENDING', toStatus: decision, note },
          trx,
        );
        return toPlaceDto(await placesRepository.findById(id, trx));
      });
    },

    async moderationQueue(query) {
      const { places, total } = await placesRepository.listForModeration({ ...query, oldestFirst: true });
      return { places: places.map(toPlaceDto), meta: buildPaginationMeta(query, total) };
    },

    async mySubmissions(query, user) {
      const { places, total } = await placesRepository.listForModeration({ ...query, createdBy: user.id });
      return { places: places.map(toPlaceDto), meta: buildPaginationMeta(query, total) };
    },

    // Status history incl. rejection reasons: submitter and moderators only.
    async moderationHistory(id, user) {
      const place = await findVisible(id, user);
      if (!isModerator(user) && place.created_by !== user.id) throw notFound();
      const events = await placesRepository.listModerationEvents(id);
      return events.map((e) => ({
        action: e.action,
        fromStatus: e.from_status,
        toStatus: e.to_status,
        note: e.note,
        createdAt: e.created_at,
      }));
    },

    // DELETE archives: saved itineraries keep referring to a real row.
    async archive(id, user) {
      return transaction(async (trx) => {
        const place = await findVisible(id, user, trx, { lock: true });
        if (place.status !== 'ARCHIVED') {
          planEdit(place, user); // same permission rules as editing
          await placesRepository.update(id, { status: 'ARCHIVED' }, trx);
          await placesRepository.addModerationEvent(
            { placeId: id, actorId: user.id, action: 'ARCHIVED', fromStatus: place.status, toStatus: 'ARCHIVED' },
            trx,
          );
        }
        return toPlaceDto(await placesRepository.findById(id, trx));
      });
    },
  };
}

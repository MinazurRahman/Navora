import { ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors/AppError.js';
import { isModerator } from '../../shared/auth/authorization.js';
import { buildPaginationMeta } from '../../shared/validation/common.schemas.js';
import { hashKey } from '../../integrations/redis/cache.js';
import { CACHE_TTL } from '../../config/cache.js';
import { toPlaceDto } from './places.mapper.js';

const notFound = () => new NotFoundError('Place not found', 'PLACE_NOT_FOUND');

// Every public place cache entry lives in this namespace; any write that changes public
// place data bumps it. Only APPROVED (public) data is ever cached.
export const CACHE_NAMESPACE = 'places';

// ~110 m. Nearby searches from points this close share a cache entry; the query itself
// uses the rounded point, so cached and fresh results are identical.
const roundCoordinate = (value) => Math.round(value * 1000) / 1000;

// Approved places are public. Anything else is visible only to its submitter and
// moderators; for everyone else it does not exist (404, not 403, so nothing leaks).
function canView(status, ownerId, user) {
  return status === 'APPROVED' || isModerator(user) || (user && ownerId === user.id);
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

export function createPlacesService({ placesRepository, categoriesService, transaction, cache }) {
  async function findVisible(id, user, conn, options) {
    const place = await placesRepository.findById(id, conn, options);
    if (!place || !canView(place.status, place.created_by, user)) throw notFound();
    return place;
  }

  const invalidateCache = () => cache.bumpVersion(CACHE_NAMESPACE);

  // Invalidate only after the transaction committed.
  async function writeThenInvalidate(work) {
    const result = await transaction(work);
    await invalidateCache();
    return result;
  }

  // Resolves slugs from the request body to IDs before the transaction starts.
  async function resolveReferences({ category, tags, ...fields }) {
    const resolved = { ...fields };
    if (category !== undefined) resolved.categoryId = (await categoriesService.requireBySlug(category)).id;
    if (tags !== undefined) resolved.tagIds = (await categoriesService.requireTags(tags)).map((tag) => tag.id);
    return resolved;
  }

  async function writeTagsAndHours(placeId, { tagIds, openingHours }, trx) {
    if (tagIds !== undefined) await placesRepository.replaceTags(placeId, tagIds, trx);
    if (openingHours !== undefined) await placesRepository.replaceOpeningHours(placeId, openingHours, trx);
  }

  // Public, approved-only results: safe to cache and share between users.
  function searchPage(query, extra) {
    const params = {
      categories: query.category && [...query.category].sort(),
      maxEntryFee: query.maxEntryFee,
      minRating: query.minRating,
      page: query.page,
      limit: query.limit,
      ...extra,
    };
    return cache.getOrSet(
      `${extra.sort}:${hashKey(params)}`,
      CACHE_TTL.placeLists,
      async () => {
        const { places, total } = await placesRepository.search(params);
        return { places: places.map(toPlaceDto), meta: buildPaginationMeta(query, total) };
      },
      { namespace: CACHE_NAMESPACE },
    );
  }

  return {
    invalidateCache,

    list(query) {
      return searchPage(query, { sort: 'newest' });
    },

    nearby(query) {
      const near = {
        latitude: roundCoordinate(query.latitude),
        longitude: roundCoordinate(query.longitude),
        radiusMeters: query.radiusKm * 1000,
      };
      return searchPage(query, { near, sort: 'distance' });
    },

    search(query) {
      // Case and spacing do not change the results, so they do not change the key either.
      return searchPage(query, { q: query.q.toLowerCase().replace(/\s+/g, ' '), sort: 'relevance' });
    },

    async getById(id, user) {
      const place = await cache.getOrSet(
        `detail:${id}`,
        CACHE_TTL.placeDetail,
        async () => {
          const row = await placesRepository.findById(id);
          return row ? toPlaceDto(row) : null;
        },
        { namespace: CACHE_NAMESPACE, cacheIf: (dto) => dto.status === 'APPROVED' },
      );
      if (!place || !canView(place.status, place.createdBy, user)) throw notFound();
      return place;
    },

    // Approved places within radiusMeters, nearest first, capped at `limit` (for the
    // recommender, which caches its own results).
    async findCandidates({ latitude, longitude, radiusMeters, limit }) {
      const { places, total } = await placesRepository.search({
        near: { latitude, longitude, radiusMeters },
        sort: 'distance',
        page: 1,
        limit,
      });
      return { places: places.map(toPlaceDto), total };
    },

    // Community submissions start PENDING; moderators' places are approved directly.
    async create(input, user) {
      const fields = await resolveReferences(input);
      const status = isModerator(user) ? 'APPROVED' : 'PENDING';

      return writeThenInvalidate(async (trx) => {
        const id = await placesRepository.create({ ...fields, status, createdBy: user.id }, trx);
        await writeTagsAndHours(id, fields, trx);
        await placesRepository.addModerationEvent(
          { placeId: id, actorId: user.id, action: 'SUBMITTED', fromStatus: null, toStatus: status },
          trx,
        );
        return toPlaceDto(await placesRepository.findById(id, trx));
      });
    },

    async update(id, patch, user) {
      const fields = await resolveReferences(patch);

      return writeThenInvalidate(async (trx) => {
        // Row lock: a moderator decision and a resubmission cannot interleave.
        const place = await findVisible(id, user, trx, { lock: true });
        const { action, toStatus } = planEdit(place, user);

        await placesRepository.update(id, { ...fields, status: toStatus }, trx);
        await writeTagsAndHours(id, fields, trx);
        await placesRepository.addModerationEvent(
          { placeId: id, actorId: user.id, action, fromStatus: place.status, toStatus },
          trx,
        );
        return toPlaceDto(await placesRepository.findById(id, trx));
      });
    },

    // Moderator decision on a PENDING submission. decision: 'APPROVED' | 'REJECTED'.
    async moderate(id, user, decision, note) {
      return writeThenInvalidate(async (trx) => {
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
      return writeThenInvalidate(async (trx) => {
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

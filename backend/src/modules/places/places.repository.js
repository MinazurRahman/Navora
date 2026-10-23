// All geography work (distance, radius, ordering) happens in PostGIS, using the GiST
// index on places.location. Coordinates are passed as (longitude, latitude): PostGIS order.
const POINT_SQL = 'ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography';

const COLUMNS = {
  name: 'name',
  description: 'description',
  categoryId: 'category_id',
  address: 'address',
  city: 'city',
  entryFee: 'entry_fee',
  typicalVisitMinutes: 'typical_visit_minutes',
  parkingAvailable: 'parking_available',
  petFriendly: 'pet_friendly',
  wheelchairAccessible: 'wheelchair_accessible',
  accessibilityNotes: 'accessibility_notes',
  restrictions: 'restrictions',
  status: 'status',
  createdBy: 'created_by',
};

function toRow(conn, fields) {
  const row = {};
  for (const [field, column] of Object.entries(COLUMNS)) {
    if (fields[field] !== undefined) row[column] = fields[field];
  }
  if (fields.location) {
    row.location = conn.raw(POINT_SQL, [fields.location.longitude, fields.location.latitude]);
  }
  return row;
}

const placeColumns = (conn) => [
  'p.id', 'p.name', 'p.description', 'p.address', 'p.city', 'p.entry_fee', 'p.currency',
  'p.typical_visit_minutes', 'p.parking_available', 'p.pet_friendly', 'p.wheelchair_accessible',
  'p.accessibility_notes', 'p.restrictions', 'p.facilities_verified_at', 'p.status', 'p.created_by',
  'p.avg_rating', 'p.review_count', 'p.created_at', 'p.updated_at',
  'p.image_url', 'p.image_author', 'p.image_license', 'p.image_license_url', 'p.image_source_url',
  'c.slug as category_slug', 'c.name as category_name',
  conn.raw('ST_Y(p.location::geometry) AS latitude'),
  conn.raw('ST_X(p.location::geometry) AS longitude'),
  // Per-row subqueries on indexed keys, inside the same SQL statement (no N+1).
  conn.raw(`(SELECT coalesce(array_agg(t.slug ORDER BY t.slug), '{}')
             FROM place_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.place_id = p.id) AS tags`),
  conn.raw(`(SELECT coalesce(json_agg(json_build_object(
               'dayOfWeek', h.day_of_week,
               'opensAt', to_char(h.opens_at, 'HH24:MI'),
               'closesAt', to_char(h.closes_at, 'HH24:MI')) ORDER BY h.day_of_week, h.opens_at), '[]')
             FROM place_opening_hours h WHERE h.place_id = p.id) AS opening_hours`),
];

const fromPlaces = (conn) => conn('places as p').join('categories as c', 'c.id', 'p.category_id');

export function createPlacesRepository(db) {
  return {
    // Approved places only. near = { latitude, longitude, radiusMeters }.
    // sort: 'newest' | 'distance' (needs near) | 'relevance' (needs q).
    // facilities: field names (petFriendly, …) that must be YES; NO and UNKNOWN both fail.
    async search({ categories, maxEntryFee, minRating, facilities = [], near, q, sort, page, limit }) {
      const filtered = () => {
        const query = fromPlaces(db).where('p.status', 'APPROVED');
        if (categories?.length) query.whereIn('c.slug', categories);
        // NULL (unknown fee / no rating yet) never satisfies a filter.
        if (maxEntryFee !== undefined) query.where('p.entry_fee', '<=', maxEntryFee);
        if (minRating !== undefined) query.where('p.avg_rating', '>=', minRating);
        for (const field of facilities) query.where(`p.${COLUMNS[field]}`, 'YES');
        if (near) {
          query.whereRaw(`ST_DWithin(p.location, ${POINT_SQL}, ?)`, [near.longitude, near.latitude, near.radiusMeters]);
        }
        if (q) {
          // Full-text (whole words) or trigram similarity on the name (typos, partial names).
          query.where((match) =>
            match
              .whereRaw("p.search_vector @@ websearch_to_tsquery('simple', ?)", [q])
              .orWhereRaw('p.name % ?', [q]),
          );
        }
        return query;
      };

      const pageQuery = filtered()
        .select(placeColumns(db))
        .limit(limit)
        .offset((page - 1) * limit);

      if (near) {
        pageQuery.select(db.raw(`ST_Distance(p.location, ${POINT_SQL}) AS distance_m`, [near.longitude, near.latitude]));
      }
      if (sort === 'distance') {
        pageQuery.orderByRaw(`p.location <-> ${POINT_SQL}`, [near.longitude, near.latitude]);
      } else if (sort === 'relevance') {
        pageQuery.orderByRaw(
          "greatest(ts_rank(p.search_vector, websearch_to_tsquery('simple', ?)), similarity(p.name, ?)) DESC",
          [q, q],
        );
      } else {
        pageQuery.orderBy('p.created_at', 'desc');
      }
      pageQuery.orderBy('p.id');

      const [places, [{ total }]] = await Promise.all([pageQuery, filtered().count({ total: '*' })]);
      return { places, total: Number(total) };
    },

    // Many places in one query (avoids one query per ID).
    findByIds(ids, conn = db) {
      return fromPlaces(conn).select(placeColumns(conn)).whereIn('p.id', ids);
    },

    // lock: SELECT … FOR UPDATE OF p, for status transitions inside a transaction.
    findById(id, conn = db, { lock = false } = {}) {
      const query = fromPlaces(conn).select(placeColumns(conn)).where('p.id', id).first();
      return lock ? query.forUpdate('p') : query;
    },

    async create(fields, conn = db) {
      const [{ id }] = await conn('places').insert(toRow(conn, fields)).returning('id');
      return id;
    },

    async update(id, fields, conn = db) {
      await conn('places').where({ id }).update(toRow(conn, fields));
    },

    async replaceTags(placeId, tagIds, conn = db) {
      await conn('place_tags').where({ place_id: placeId }).delete();
      if (tagIds.length > 0) {
        await conn('place_tags').insert(tagIds.map((tagId) => ({ place_id: placeId, tag_id: tagId })));
      }
    },

    async replaceOpeningHours(placeId, hours, conn = db) {
      await conn('place_opening_hours').where({ place_id: placeId }).delete();
      if (hours.length > 0) {
        await conn('place_opening_hours').insert(
          hours.map((h) => ({ place_id: placeId, day_of_week: h.dayOfWeek, opens_at: h.opensAt, closes_at: h.closesAt })),
        );
      }
    },

    async addModerationEvent({ placeId, actorId, action, fromStatus, toStatus, note = null }, conn = db) {
      await conn('place_moderation_events').insert({
        place_id: placeId,
        actor_id: actorId,
        action,
        from_status: fromStatus,
        to_status: toStatus,
        note,
      });
    },

    // Any status; for the moderation queue (oldest first) and "my submissions" (newest first).
    async listForModeration({ status, createdBy, oldestFirst, page, limit }) {
      const filtered = () => {
        const query = fromPlaces(db);
        if (status) query.where('p.status', status);
        if (createdBy) query.where('p.created_by', createdBy);
        return query;
      };
      const pageQuery = filtered()
        .select(placeColumns(db))
        .orderBy('p.created_at', oldestFirst ? 'asc' : 'desc')
        .orderBy('p.id')
        .limit(limit)
        .offset((page - 1) * limit);

      const [places, [{ total }]] = await Promise.all([pageQuery, filtered().count({ total: '*' })]);
      return { places, total: Number(total) };
    },

    listModerationEvents(placeId) {
      return db('place_moderation_events')
        .select('action', 'from_status', 'to_status', 'note', 'created_at')
        .where({ place_id: placeId })
        .orderBy('created_at', 'asc');
    },
  };
}

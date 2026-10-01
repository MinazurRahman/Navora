const POINT_SQL = 'ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography';

const COLUMNS = {
  title: 'title',
  startAddress: 'start_address',
  startDate: 'start_date',
  durationDays: 'duration_days',
  dailyStartTime: 'daily_start_time',
  dailyEndTime: 'daily_end_time',
  travelMode: 'travel_mode',
  travelingWithPet: 'traveling_with_pet',
  parkingRequired: 'parking_required',
  wheelchairAccessRequired: 'wheelchair_access_required',
  partySize: 'party_size',
  minimumRating: 'min_rating',
};

function toRow(conn, fields) {
  const row = {};
  for (const [field, column] of Object.entries(COLUMNS)) {
    if (fields[field] !== undefined) row[column] = fields[field];
  }
  if (fields.userId) row.user_id = fields.userId;
  if (fields.searchRadiusKm !== undefined) row.search_radius_m = Math.round(fields.searchRadiusKm * 1000);
  if (fields.budget !== undefined) {
    row.budget_amount = fields.budget?.amount ?? null;
    row.budget_type = fields.budget?.type ?? null;
  }
  if (fields.startLocation) {
    row.start_location = conn.raw(POINT_SQL, [fields.startLocation.longitude, fields.startLocation.latitude]);
  }
  return row;
}

const tripColumns = (conn) => [
  't.id', 't.user_id', 't.title', 't.start_address', 't.start_date', 't.duration_days',
  't.daily_start_time', 't.daily_end_time', 't.search_radius_m', 't.budget_amount', 't.budget_type',
  't.budget_currency', 't.travel_mode', 't.traveling_with_pet', 't.parking_required',
  't.wheelchair_access_required', 't.party_size', 't.min_rating', 't.created_at', 't.updated_at',
  conn.raw('ST_Y(t.start_location::geometry) AS start_latitude'),
  conn.raw('ST_X(t.start_location::geometry) AS start_longitude'),
  conn.raw(`(SELECT coalesce(array_agg(g.slug ORDER BY g.slug), '{}') FROM trip_interests ti
             JOIN tags g ON g.id = ti.tag_id WHERE ti.trip_id = t.id) AS interests`),
  conn.raw(`(SELECT coalesce(array_agg(c.slug ORDER BY c.slug), '{}') FROM trip_preferred_categories tc
             JOIN categories c ON c.id = tc.category_id WHERE tc.trip_id = t.id) AS preferred_categories`),
  conn.raw(`(SELECT coalesce(array_agg(sp.place_id ORDER BY sp.created_at, sp.place_id), '{}')
             FROM trip_selected_places sp WHERE sp.trip_id = t.id) AS selected_place_ids`),
  conn.raw('(SELECT i.id FROM itineraries i WHERE i.trip_id = t.id AND i.is_current) AS current_itinerary_id'),
];

async function replaceLinks(conn, table, tripId, column, ids) {
  await conn(table).where({ trip_id: tripId }).delete();
  if (ids.length > 0) await conn(table).insert(ids.map((id) => ({ trip_id: tripId, [column]: id })));
}

export function createTripsRepository(db) {
  return {
    async create(fields, conn = db) {
      const [{ id }] = await conn('trips').insert(toRow(conn, fields)).returning('id');
      return id;
    },

    async update(id, fields, conn = db) {
      const row = toRow(conn, fields);
      if (Object.keys(row).length > 0) await conn('trips').where({ id }).update(row);
    },

    // Links are replaced only when given (undefined = unchanged).
    async replaceLinks(tripId, { tagIds, categoryIds, selectedPlaceIds }, conn = db) {
      if (tagIds) await replaceLinks(conn, 'trip_interests', tripId, 'tag_id', tagIds);
      if (categoryIds) await replaceLinks(conn, 'trip_preferred_categories', tripId, 'category_id', categoryIds);
      if (selectedPlaceIds) await replaceLinks(conn, 'trip_selected_places', tripId, 'place_id', selectedPlaceIds);
    },

    findById(id, conn = db) {
      return conn('trips as t').select(tripColumns(conn)).where('t.id', id).first();
    },

    // Uses trips_user_created_idx (user_id, created_at DESC).
    async listByUser(userId, { page, limit }) {
      const [trips, [{ total }]] = await Promise.all([
        db('trips as t')
          .select(tripColumns(db))
          .where('t.user_id', userId)
          .orderBy('t.created_at', 'desc')
          .orderBy('t.id')
          .limit(limit)
          .offset((page - 1) * limit),
        db('trips').where({ user_id: userId }).count({ total: '*' }),
      ]);
      return { trips, total: Number(total) };
    },

    async delete(id) {
      await db('trips').where({ id }).delete();
    },
  };
}

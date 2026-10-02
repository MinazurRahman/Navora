export function createItinerariesRepository(db) {
  async function insertDays(itineraryId, days, trx) {
    for (const { stops, ...day } of days) {
      const [{ id: dayId }] = await trx('itinerary_days').insert({ ...day, itinerary_id: itineraryId }).returning('id');
      if (stops.length > 0) await trx('itinerary_stops').insert(stops.map((stop) => ({ ...stop, day_id: dayId })));
    }
  }

  return {
    // Inserts a new version and makes it the current one. Must run in a transaction.
    async createVersion({ tripId, itinerary, days }, trx) {
      // Serialises concurrent generations for the same trip.
      await trx('trips').where({ id: tripId }).forUpdate().first();
      const [{ max }] = await trx('itineraries').where({ trip_id: tripId }).max({ max: 'version' });
      await trx('itineraries').where({ trip_id: tripId, is_current: true }).update({ is_current: false });

      const [{ id }] = await trx('itineraries')
        .insert({ ...itinerary, trip_id: tripId, version: (max ?? 0) + 1, is_current: true })
        .returning('id');
      await insertDays(id, days, trx);
      return id;
    },

    // Replaces the given days (by day_number) and recomputes the itinerary totals from
    // all its days. Must run in a transaction.
    async replaceDays(itineraryId, days, fields, trx) {
      await trx('itinerary_days')
        .where({ itinerary_id: itineraryId })
        .whereIn('day_number', days.map((d) => d.day_number))
        .delete(); // stops cascade
      await insertDays(itineraryId, days, trx);

      const totals = trx('itinerary_days').where({ itinerary_id: itineraryId });
      await trx('itineraries')
        .where({ id: itineraryId })
        .update({
          ...fields,
          is_user_modified: true,
          total_distance_m: totals.clone().sum('total_distance_m'),
          total_travel_seconds: totals.clone().sum('total_travel_seconds'),
          total_visit_minutes: totals.clone().sum('total_visit_minutes'),
          estimated_cost: trx('itinerary_stops as s')
            .join('itinerary_days as d', 'd.id', 's.day_id')
            .where('d.itinerary_id', itineraryId)
            .select(trx.raw('coalesce(sum(s.estimated_cost), 0)')),
        });
    },

    // Row lock so concurrent edits/deletes of the same itinerary serialise.
    lockById(id, trx) {
      return trx('itineraries').where({ id }).forUpdate().first();
    },

    // Deletes one version; if it was current, the newest remaining version becomes current.
    async delete(id, trx) {
      const itinerary = await trx('itineraries').where({ id }).forUpdate().first();
      await trx('itineraries').where({ id }).delete();
      if (itinerary.is_current) {
        const newest = await trx('itineraries').where({ trip_id: itinerary.trip_id }).orderBy('version', 'desc').first();
        if (newest) await trx('itineraries').where({ id: newest.id }).update({ is_current: true });
      }
    },

    // Summaries of a user's itineraries, newest first. Uses trips_user_created_idx and
    // itineraries_trip_version_key.
    async listByUser(userId, { tripId, currentOnly, page, limit }) {
      const filtered = () => {
        const query = db('itineraries as i').join('trips as t', 't.id', 'i.trip_id').where('t.user_id', userId);
        if (tripId) query.where('i.trip_id', tripId);
        if (currentOnly) query.where('i.is_current', true);
        return query;
      };
      const [rows, [{ total }]] = await Promise.all([
        filtered()
          .select(
            'i.id', 'i.trip_id', 'i.version', 'i.is_current', 'i.is_user_modified', 'i.total_distance_m',
            'i.total_travel_seconds', 'i.total_visit_minutes', 'i.estimated_cost', 'i.currency',
            'i.travel_times_estimated', 'i.created_at', 'i.updated_at', 't.title as trip_title',
            db.raw('(SELECT count(*)::int FROM itinerary_days d WHERE d.itinerary_id = i.id) AS day_count'),
            db.raw(`(SELECT count(*)::int FROM itinerary_stops s JOIN itinerary_days d ON d.id = s.day_id
                     WHERE d.itinerary_id = i.id) AS stop_count`),
          )
          .orderBy('i.created_at', 'desc')
          .orderBy('i.id')
          .limit(limit)
          .offset((page - 1) * limit),
        filtered().count({ total: '*' }),
      ]);
      return { itineraries: rows, total: Number(total) };
    },

    // Three queries regardless of size (no N+1).
    async findById(id) {
      const itinerary = await db('itineraries as i')
        .join('trips as t', 't.id', 'i.trip_id')
        .select('i.*', 't.user_id')
        .where('i.id', id)
        .first();
      if (!itinerary) return null;

      const [days, stops] = await Promise.all([
        db('itinerary_days').where({ itinerary_id: id }).orderBy('day_number'),
        db('itinerary_stops as s')
          .join('itinerary_days as d', 'd.id', 's.day_id')
          .join('places as p', 'p.id', 's.place_id')
          .join('categories as c', 'c.id', 'p.category_id')
          .where('d.itinerary_id', id)
          .orderBy(['d.day_number', 's.visit_order'])
          .select(
            's.*',
            'p.name as place_name',
            'c.slug as category_slug',
            'c.name as category_name',
            db.raw('ST_Y(p.location::geometry) AS latitude'),
            db.raw('ST_X(p.location::geometry) AS longitude'),
          ),
      ]);
      return { itinerary, days, stops };
    },
  };
}

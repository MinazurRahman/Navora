export function createItinerariesRepository(db) {
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

      for (const { stops, ...day } of days) {
        const [{ id: dayId }] = await trx('itinerary_days').insert({ ...day, itinerary_id: id }).returning('id');
        await trx('itinerary_stops').insert(stops.map((stop) => ({ ...stop, day_id: dayId })));
      }
      return id;
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

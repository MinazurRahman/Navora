export function createSavedPlacesRepository(db) {
  const where = (userId, placeId) => ({ user_id: userId, place_id: placeId });

  return {
    // Saving an already saved place changes nothing.
    async save(userId, placeId) {
      await db('saved_places').insert(where(userId, placeId)).onConflict(['user_id', 'place_id']).ignore();
    },

    async remove(userId, placeId) {
      await db('saved_places').where(where(userId, placeId)).delete();
    },

    async isSaved(userId, placeId) {
      return Boolean(await db('saved_places').where(where(userId, placeId)).first('place_id'));
    },

    async countByUser(userId) {
      const [{ total }] = await db('saved_places').where({ user_id: userId }).count({ total: '*' });
      return Number(total);
    },

    // IDs of the user's saved places that are still approved, most recently saved first.
    // Rows of places that were later archived stay, but are not listed.
    // Uses saved_places_user_created_idx (user_id, created_at DESC).
    async listApprovedPlaceIds(userId, { page, limit }) {
      const approved = () =>
        db('saved_places as s')
          .join('places as p', 'p.id', 's.place_id')
          .where('s.user_id', userId)
          .where('p.status', 'APPROVED');
      const [rows, [{ total }]] = await Promise.all([
        approved()
          .select('s.place_id')
          .orderBy('s.created_at', 'desc')
          .orderBy('s.place_id')
          .limit(limit)
          .offset((page - 1) * limit),
        approved().count({ total: '*' }),
      ]);
      return { placeIds: rows.map((row) => row.place_id), total: Number(total) };
    },
  };
}

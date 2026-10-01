// Place rating aggregates (rating_sum, review_count, avg_rating) are kept in sync by the
// reviews trigger in the database, on every insert/update/delete path.
const selectReviews = (db) =>
  db('reviews as r')
    .join('users as u', 'u.id', 'r.user_id')
    .select('r.id', 'r.place_id', 'r.user_id', 'r.rating', 'r.comment', 'r.created_at', 'r.updated_at', 'u.name as author_name');

export function createReviewsRepository(db) {
  return {
    async create({ userId, placeId, rating, comment }) {
      const [{ id }] = await db('reviews')
        .insert({ user_id: userId, place_id: placeId, rating, comment })
        .returning('id');
      return id;
    },

    findById(id) {
      return selectReviews(db).where('r.id', id).first();
    },

    // Uses reviews_place_created_idx (place_id, created_at DESC).
    async listByPlace(placeId, { page, limit }) {
      const [reviews, [{ total }]] = await Promise.all([
        selectReviews(db)
          .where('r.place_id', placeId)
          .orderBy('r.created_at', 'desc')
          .orderBy('r.id')
          .limit(limit)
          .offset((page - 1) * limit),
        db('reviews').where({ place_id: placeId }).count({ total: '*' }),
      ]);
      return { reviews, total: Number(total) };
    },

    // patch holds only the fields the client sent.
    async update(id, patch) {
      await db('reviews').where({ id }).update(patch);
    },

    async delete(id) {
      await db('reviews').where({ id }).delete();
    },
  };
}

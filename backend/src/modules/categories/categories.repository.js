export function createCategoriesRepository(db) {
  return {
    list() {
      return db('categories').select('slug', 'name', 'description').orderBy('name');
    },

    findBySlug(slug) {
      return db('categories').select('id', 'slug', 'name').where({ slug }).first();
    },
  };
}

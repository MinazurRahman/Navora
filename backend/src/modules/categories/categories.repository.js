export function createCategoriesRepository(db) {
  return {
    list() {
      return db('categories').select('slug', 'name', 'description').orderBy('name');
    },

    findBySlug(slug) {
      return db('categories').select('id', 'slug', 'name').where({ slug }).first();
    },

    findCategoriesBySlugs(slugs) {
      return db('categories').select('id', 'slug').whereIn('slug', slugs);
    },

    listTags() {
      return db('tags').select('slug', 'name').orderBy('name');
    },

    findTagsBySlugs(slugs) {
      return db('tags').select('id', 'slug').whereIn('slug', slugs);
    },
  };
}

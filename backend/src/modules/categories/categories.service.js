import { ValidationError } from '../../shared/errors/AppError.js';

export function createCategoriesService({ categoriesRepository }) {
  return {
    list() {
      return categoriesRepository.list();
    },

    // For request bodies that reference a category by slug.
    async requireBySlug(slug) {
      const category = await categoriesRepository.findBySlug(slug);
      if (!category) {
        throw new ValidationError('Invalid request data', [
          { location: 'body', path: 'category', message: `Unknown category "${slug}"` },
        ]);
      }
      return category;
    },
  };
}

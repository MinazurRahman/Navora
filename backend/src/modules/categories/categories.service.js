import { ValidationError } from '../../shared/errors/AppError.js';

function unknownError(path, missing, kind) {
  return new ValidationError('Invalid request data', [
    { location: 'body', path, message: `Unknown ${kind}: ${missing.join(', ')}` },
  ]);
}

// Categories (one per place) and tags/interests (many per place): the shared catalogue.
export function createCategoriesService({ categoriesRepository }) {
  async function requireAll(find, slugs, path, kind) {
    if (slugs.length === 0) return [];
    const rows = await find(slugs);
    const found = new Set(rows.map((row) => row.slug));
    const missing = slugs.filter((slug) => !found.has(slug));
    if (missing.length > 0) throw unknownError(path, missing, kind);
    return rows;
  }

  return {
    list() {
      return categoriesRepository.list();
    },

    listTags() {
      return categoriesRepository.listTags();
    },

    async requireBySlug(slug) {
      const category = await categoriesRepository.findBySlug(slug);
      if (!category) throw unknownError('category', [slug], 'category');
      return category;
    },

    requireCategories(slugs, path = 'preferredCategories') {
      return requireAll(categoriesRepository.findCategoriesBySlugs, slugs, path, 'category');
    },

    requireTags(slugs, path = 'tags') {
      return requireAll(categoriesRepository.findTagsBySlugs, slugs, path, 'interest');
    },
  };
}

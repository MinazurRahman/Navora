import { Router } from 'express';
import { sendSuccess } from '../../shared/http/response.js';
import { createCategoriesService } from './categories.service.js';

export { createCategoriesRepository } from './categories.repository.js';

export function createCategoriesModule({ categoriesRepository }) {
  const categoriesService = createCategoriesService({ categoriesRepository });

  const router = Router();
  router.get('/', async (req, res) => {
    sendSuccess(res, await categoriesService.list());
  });

  // Interests (tags) the frontend can offer, e.g. history, food, nature.
  const tagsRouter = Router();
  tagsRouter.get('/', async (req, res) => {
    sendSuccess(res, await categoriesService.listTags());
  });

  return { router, tagsRouter, categoriesService };
}

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

  return { router, categoriesService };
}

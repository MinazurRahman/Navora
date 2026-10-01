import { Router } from 'express';

export function createHealthRouter(healthController) {
  const router = Router();
  router.get('/health', healthController.getHealth);
  router.get('/ready', healthController.getReady);
  return router;
}

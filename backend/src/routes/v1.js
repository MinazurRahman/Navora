import { Router } from 'express';
import { sendSuccess } from '../shared/http/response.js';

// Mounts every feature module's router under /api/v1.
// Feature modules (places, trips, …) are added here as they are implemented.
export function createV1Router({ authRouter }) {
  const router = Router();

  router.get('/', (req, res) => {
    sendSuccess(res, { name: 'navora-api', version: 'v1' });
  });

  router.use('/auth', authRouter);

  return router;
}

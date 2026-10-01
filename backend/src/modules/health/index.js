import { createHealthService } from './health.service.js';
import { createHealthController } from './health.controller.js';
import { createHealthRouter } from './health.routes.js';

export function createHealthModule({ healthRepository, lifecycle, config }) {
  const healthService = createHealthService({
    healthRepository,
    lifecycle,
    readinessTimeoutMs: config.http.readinessTimeoutMs,
  });
  return { router: createHealthRouter(createHealthController(healthService)) };
}

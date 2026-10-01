import { ServiceUnavailableError } from '../../shared/errors/AppError.js';
import { getLogger } from '../../shared/logger.js';
import { withTimeout } from '../../shared/withTimeout.js';

export function createHealthService({ healthRepository, lifecycle, readinessTimeoutMs }) {
  return {
    // Liveness: the process is up and serving. Deliberately checks no dependencies,
    // so a database outage does not make the orchestrator restart every instance.
    getLiveness() {
      return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
    },

    // Readiness: this instance should receive traffic.
    async assertReady() {
      if (lifecycle.isShuttingDown()) {
        throw new ServiceUnavailableError('Instance is shutting down', { shuttingDown: true });
      }

      const checks = { database: 'ok' };
      try {
        await withTimeout(healthRepository.ping(), readinessTimeoutMs);
      } catch (err) {
        getLogger().error({ err }, 'Readiness check failed: database');
        checks.database = 'fail';
      }

      if (checks.database !== 'ok') {
        throw new ServiceUnavailableError('Service dependencies are unavailable', { checks });
      }
      return { status: 'ready', checks };
    },
  };
}

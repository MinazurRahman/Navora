import { setTimeout as delay } from 'node:timers/promises';

// Graceful shutdown for SIGTERM/SIGINT (and fatal errors):
// 1. mark not-ready → /ready returns 503, the load balancer stops sending traffic
// 2. wait drainMs   → give the load balancer time to notice
// 3. stop accepting connections and let in-flight requests finish
// 4. close the database pool, then exit
// A hard timeout forces exit if any step hangs.
export function createShutdownHandler({
  server,
  db,
  lifecycle,
  logger,
  drainMs,
  timeoutMs,
  exit = (code) => process.exit(code),
}) {
  let inProgress = null;

  return function shutdown(reason, exitCode = 0) {
    if (inProgress) return inProgress;

    lifecycle.markShuttingDown();
    logger.info({ reason }, 'Shutdown started');

    const forceExit = setTimeout(() => {
      logger.error({ timeoutMs }, 'Shutdown timed out; forcing exit');
      server.closeAllConnections();
      exit(1);
    }, timeoutMs);
    forceExit.unref();

    inProgress = (async () => {
      let code = exitCode;
      try {
        await delay(drainMs);
        await new Promise((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        });
        await db.destroy();
        logger.info('Shutdown complete');
      } catch (err) {
        logger.error({ err }, 'Error during shutdown');
        code = 1;
      } finally {
        clearTimeout(forceExit);
        exit(code);
      }
    })();

    return inProgress;
  };
}

import http from 'node:http';
import { env } from './config/env.js';
import { createDb } from './config/database.js';
import { createRedis } from './config/redis.js';
import { RATE_LIMIT_POLICIES } from './config/rateLimits.js';
import { createUpstashRateLimiter } from './integrations/redis/rateLimiter.js';
import { createCache } from './integrations/redis/cache.js';
import { logger } from './shared/logger.js';
import { createLifecycle } from './shared/lifecycle.js';
import { createApp } from './app.js';
import { createRepositories } from './repositories.js';
import { createShutdownHandler } from './shutdown.js';

// Composition root: creates real dependencies, wires the app, starts listening.
const db = createDb(env, { logger });
const lifecycle = createLifecycle();
const redis = createRedis(env);
const app = createApp({
  config: env,
  lifecycle,
  repositories: createRepositories(db),
  rateLimiter: createUpstashRateLimiter(redis, RATE_LIMIT_POLICIES),
  cache: createCache(redis),
});

const server = http.createServer(app);
server.keepAliveTimeout = env.http.keepAliveTimeoutMs;
server.headersTimeout = env.http.keepAliveTimeoutMs + 1_000;

const shutdown = createShutdownHandler({
  server,
  db,
  lifecycle,
  logger,
  drainMs: env.shutdown.drainMs,
  timeoutMs: env.shutdown.timeoutMs,
});

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

// After an unexpected error the process state is unknown: log, shut down, let the
// orchestrator start a fresh instance.
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection');
  shutdown('unhandledRejection', 1);
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  shutdown('uncaughtException', 1);
});

server.on('error', (err) => {
  logger.fatal({ err }, 'HTTP server error');
  shutdown('serverError', 1);
});

server.listen(env.port, () => {
  logger.info({ port: env.port, nodeEnv: env.nodeEnv }, 'Navora API listening');
});

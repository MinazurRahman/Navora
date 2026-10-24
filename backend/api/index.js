// Vercel entry point: the whole API runs as one serverless function (vercel.json sends
// every path here). Same wiring as src/server.js, minus listen() and the shutdown
// handling: the platform starts and stops instances itself.
import { env, productionWarnings } from '../src/config/env.js';
import { createDb } from '../src/config/database.js';
import { createRedis } from '../src/config/redis.js';
import { RATE_LIMIT_POLICIES } from '../src/config/rateLimits.js';
import { createUpstashRateLimiter } from '../src/integrations/redis/rateLimiter.js';
import { createCache } from '../src/integrations/redis/cache.js';
import { createMapServiceFromConfig } from '../src/integrations/maps/index.js';
import { createAiServiceFromConfig } from '../src/integrations/ai/index.js';
import { createMailServiceFromConfig } from '../src/integrations/mail/index.js';
import { createGoogleVerifierFromConfig } from '../src/integrations/google/index.js';
import { logger } from '../src/shared/logger.js';
import { createLifecycle } from '../src/shared/lifecycle.js';
import { createApp } from '../src/app.js';
import { createRepositories } from '../src/repositories.js';

for (const warning of productionWarnings(env)) logger.warn(`Configuration: ${warning}`);

const db = createDb(env, { logger });
const redis = createRedis(env);
const cache = createCache(redis);

export default createApp({
  config: env,
  lifecycle: createLifecycle(),
  repositories: createRepositories(db),
  rateLimiter: createUpstashRateLimiter(redis, RATE_LIMIT_POLICIES),
  cache,
  mapService: createMapServiceFromConfig(env, { cache }),
  aiService: createAiServiceFromConfig(env, { cache }),
  mailService: createMailServiceFromConfig(env),
  googleVerifier: createGoogleVerifierFromConfig(env),
});

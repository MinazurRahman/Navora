import { Redis } from '@upstash/redis';

export function createRedis(config) {
  return new Redis({
    url: config.redis.url,
    token: config.redis.token,
    // Default is 5 retries with exponential backoff (~10 s): far too slow to sit in front
    // of every request. Callers decide what a Redis failure means.
    retry: { retries: 1, backoff: () => 100 },
    enableTelemetry: false,
  });
}

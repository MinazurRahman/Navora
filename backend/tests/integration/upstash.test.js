import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Redis } from '@upstash/redis';
import { createUpstashRateLimiter } from '../../src/integrations/redis/rateLimiter.js';
import { createCache } from '../../src/integrations/redis/cache.js';

// Runs against the real Upstash database from .env (a handful of commands, all keys
// expire or are deleted). Skipped when only the test placeholders are configured.
const url = process.env.UPSTASH_REDIS_REST_URL;
const configured = Boolean(url) && !url.includes('upstash.invalid');

describe.skipIf(!configured)('Upstash Redis (real service)', () => {
  const redis = new Redis({ url, token: process.env.UPSTASH_REDIS_REST_TOKEN, enableTelemetry: false });
  const runId = randomUUID();

  afterAll(async () => {
    const keys = await redis.keys(`nv:v1:*${runId}*`);
    if (keys.length > 0) await redis.del(...keys);
  });

  it('enforces a sliding-window limit shared through Redis', async () => {
    const windowMs = 30_000;
    const policies = { itest: { limit: 2, window: '30 s', failOpen: false } };
    // Two separate limiter instances = two app instances behind a load balancer.
    const instanceA = createUpstashRateLimiter(redis, policies);
    const instanceB = createUpstashRateLimiter(redis, policies);
    const id = `ip:test-${runId}`;

    // The sliding window rounds the previous window's weighted count down, so requests that
    // straddle a window boundary may legitimately let a third one through. Start well inside
    // a window so all three land in the same one.
    const msLeft = windowMs - (Date.now() % windowMs);
    if (msLeft < 5_000) await new Promise((resolve) => setTimeout(resolve, msLeft + 100));

    expect((await instanceA.limit('itest', id)).success).toBe(true);
    expect((await instanceB.limit('itest', id)).success).toBe(true);
    const third = await instanceA.limit('itest', id);

    expect(third.success).toBe(false);
    expect(third.limit).toBe(2);
    expect(third.reset).toBeGreaterThan(Date.now());
  }, 15_000);

  it('caches objects and invalidates a namespace', async () => {
    const cache = createCache(redis);
    const namespace = `itest-${runId}`;

    expect(await cache.getOrSet('k', 30, async () => ({ n: 1 }), { namespace })).toEqual({ n: 1 });
    await new Promise((resolve) => setTimeout(resolve, 300)); // write is fire-and-forget
    expect(await cache.getOrSet('k', 30, async () => ({ n: 2 }), { namespace })).toEqual({ n: 1 });

    await cache.bumpVersion(namespace);
    expect(await cache.getOrSet('k', 30, async () => ({ n: 3 }), { namespace })).toEqual({ n: 3 });
  });
});

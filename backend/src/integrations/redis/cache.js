import { createHash } from 'node:crypto';
import { getLogger } from '../../shared/logger.js';

const PREFIX = 'nv:v1';

// Deterministic key part from a flat params object: key order and undefined values do
// not matter, so equivalent requests share one entry. Normalise values (sort arrays,
// round coordinates) before calling.
export function hashKey(params) {
  const entries = Object.keys(params)
    .sort()
    .filter((key) => params[key] !== undefined)
    .map((key) => [key, params[key]]);
  return createHash('sha256').update(JSON.stringify(entries)).digest('base64url');
}

// Cache-aside over Upstash Redis. Redis is never the source of truth: every entry has a
// TTL and can be rebuilt from PostgreSQL. Failures are logged and never fail a request.
export function createCache(redis) {
  const fullKey = (key) => `${PREFIX}:${key}`;
  const versionKey = (namespace) => `${PREFIX}:ver:${namespace}`;

  async function safely(operation, fallback, message, context) {
    try {
      return await operation();
    } catch (err) {
      getLogger().warn({ err, ...context }, message);
      return fallback;
    }
  }

  return {
    get(key) {
      return safely(() => redis.get(fullKey(key)), null, 'Cache read failed', { key });
    },

    async set(key, value, ttlSeconds) {
      await safely(() => redis.set(fullKey(key), value, { ex: ttlSeconds }), undefined, 'Cache write failed', { key });
    },

    async del(key) {
      await safely(() => redis.del(fullKey(key)), undefined, 'Cache delete failed; entry stays until its TTL', { key });
    },

    // namespace: entries become invalidatable as a group via bumpVersion(namespace). The
    // version is read before loading, so a slow reader that loaded pre-update data writes
    // it under the old version, where no one looks any more.
    // cacheIf(value): store only when true (e.g. public data only). null/undefined never cached.
    async getOrSet(key, ttlSeconds, load, { namespace, cacheIf = () => true } = {}) {
      let cacheKey;
      try {
        cacheKey = namespace ? fullKey(`${namespace}:${(await redis.get(versionKey(namespace))) ?? 0}:${key}`) : fullKey(key);
        const hit = await redis.get(cacheKey);
        if (hit !== null) return hit;
      } catch (err) {
        // Without a trustworthy version we could serve stale data: skip the cache entirely.
        getLogger().warn({ err, key }, 'Cache read failed; using source');
        return load();
      }

      const value = await load();
      if (value !== null && value !== undefined && cacheIf(value)) {
        redis.set(cacheKey, value, { ex: ttlSeconds }).catch((err) => {
          getLogger().warn({ err, key }, 'Cache write failed');
        });
      }
      return value;
    },

    async bumpVersion(namespace) {
      await safely(
        () => redis.incr(versionKey(namespace)),
        undefined,
        'Cache version bump failed; entries stay until their TTL',
        { namespace },
      );
    },
  };
}

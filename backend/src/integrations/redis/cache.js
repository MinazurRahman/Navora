import { getLogger } from '../../shared/logger.js';

const PREFIX = 'nv:v1';

// Cache-aside over Upstash Redis. Redis failures never fail a request: they are logged
// and the loader (the database) is used instead.
export function createCache(redis) {
  const fullKey = (key) => `${PREFIX}:${key}`;
  const versionKey = (namespace) => `${PREFIX}:ver:${namespace}`;

  return {
    // `namespace` makes the entry invalidatable as a group via bumpVersion(namespace),
    // e.g. every nearby/search result when any place changes, without scanning keys.
    async getOrSet(key, ttlSeconds, load, { namespace } = {}) {
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
      if (value !== null && value !== undefined) {
        redis.set(cacheKey, value, { ex: ttlSeconds }).catch((err) => {
          getLogger().warn({ err, key }, 'Cache write failed');
        });
      }
      return value;
    },

    async del(key) {
      try {
        await redis.del(fullKey(key));
      } catch (err) {
        getLogger().error({ err, key }, 'Cache delete failed; entry stays until its TTL');
      }
    },

    async bumpVersion(namespace) {
      try {
        await redis.incr(versionKey(namespace));
      } catch (err) {
        getLogger().error({ err, namespace }, 'Cache version bump failed; entries stay until their TTL');
      }
    },
  };
}

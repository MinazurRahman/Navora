import { describe, expect, it, vi } from 'vitest';
import { createCache } from '../../src/integrations/redis/cache.js';

function createFakeRedis() {
  const store = new Map();
  return {
    store,
    get: vi.fn(async (key) => (store.has(key) ? store.get(key) : null)),
    set: vi.fn(async (key, value) => void store.set(key, value)),
    del: vi.fn(async (key) => void store.delete(key)),
    incr: vi.fn(async (key) => {
      store.set(key, (store.get(key) ?? 0) + 1);
      return store.get(key);
    }),
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('cache', () => {
  it('loads once, then serves from cache with a TTL', async () => {
    const redis = createFakeRedis();
    const cache = createCache(redis);
    const load = vi.fn(async () => ({ id: 'p1' }));

    expect(await cache.getOrSet('place:p1', 600, load)).toEqual({ id: 'p1' });
    await flush();
    expect(await cache.getOrSet('place:p1', 600, load)).toEqual({ id: 'p1' });

    expect(load).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith('nv:v1:place:p1', { id: 'p1' }, { ex: 600 });
  });

  it('does not cache null (e.g. not found)', async () => {
    const redis = createFakeRedis();
    await createCache(redis).getOrSet('place:missing', 600, async () => null);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('del removes an entry', async () => {
    const redis = createFakeRedis();
    const cache = createCache(redis);
    await cache.getOrSet('place:p1', 600, async () => 'v1');
    await flush();
    await cache.del('place:p1');

    expect(await cache.getOrSet('place:p1', 600, async () => 'v2')).toBe('v2');
  });

  it('bumpVersion invalidates every entry in a namespace', async () => {
    const redis = createFakeRedis();
    const cache = createCache(redis);
    const opts = { namespace: 'places' };

    await cache.getOrSet('nearby:a', 120, async () => 'old-a', opts);
    await cache.getOrSet('nearby:b', 120, async () => 'old-b', opts);
    await flush();
    await cache.bumpVersion('places');

    expect(await cache.getOrSet('nearby:a', 120, async () => 'new-a', opts)).toBe('new-a');
    expect(await cache.getOrSet('nearby:b', 120, async () => 'new-b', opts)).toBe('new-b');
  });

  it('falls back to the loader when Redis is down, never failing the request', async () => {
    const redis = createFakeRedis();
    redis.get.mockRejectedValue(new Error('fetch failed'));
    redis.set.mockRejectedValue(new Error('fetch failed'));
    const cache = createCache(redis);

    expect(await cache.getOrSet('place:p1', 600, async () => 'from-db', { namespace: 'places' })).toBe('from-db');
    await expect(cache.del('place:p1')).resolves.toBeUndefined();
    await expect(cache.bumpVersion('places')).resolves.toBeUndefined();
  });
});

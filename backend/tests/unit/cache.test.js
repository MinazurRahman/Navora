import { describe, expect, it, vi } from 'vitest';
import { createCache, hashKey } from '../../src/integrations/redis/cache.js';
import { createInMemoryRedis } from '../helpers/testApp.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));

function failingRedis() {
  const fail = vi.fn(async () => {
    throw new Error('fetch failed');
  });
  return { get: fail, set: fail, del: fail, incr: fail };
}

describe('cache primitives', () => {
  it('get/set/del with TTL under the nv:v1 prefix', async () => {
    const redis = createInMemoryRedis();
    const setSpy = vi.spyOn(redis, 'set');
    const cache = createCache(redis);

    expect(await cache.get('k')).toBeNull();
    await cache.set('k', { a: 1 }, 60);
    expect(await cache.get('k')).toEqual({ a: 1 });
    expect(setSpy).toHaveBeenCalledWith('nv:v1:k', { a: 1 }, { ex: 60 });

    await cache.del('k');
    expect(await cache.get('k')).toBeNull();
  });

  it('never throws when Redis is down', async () => {
    const cache = createCache(failingRedis());
    await expect(cache.get('k')).resolves.toBeNull();
    await expect(cache.set('k', 1, 60)).resolves.toBeUndefined();
    await expect(cache.del('k')).resolves.toBeUndefined();
    await expect(cache.bumpVersion('places')).resolves.toBeUndefined();
    await expect(cache.getOrSet('k', 60, async () => 'from-db', { namespace: 'places' })).resolves.toBe('from-db');
  });
});

describe('getOrSet', () => {
  it('loads once, then serves from cache', async () => {
    const cache = createCache(createInMemoryRedis());
    const load = vi.fn(async () => ({ id: 'p1' }));

    await cache.getOrSet('place:p1', 600, load);
    await flush();
    expect(await cache.getOrSet('place:p1', 600, load)).toEqual({ id: 'p1' });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not cache null or values rejected by cacheIf', async () => {
    const redis = createInMemoryRedis();
    const cache = createCache(redis);

    await cache.getOrSet('missing', 600, async () => null);
    await cache.getOrSet('pending', 600, async () => ({ status: 'PENDING' }), { cacheIf: (p) => p.status === 'APPROVED' });
    await flush();
    expect(redis.store.size).toBe(0);
  });

  it('bumpVersion invalidates every entry in a namespace', async () => {
    const cache = createCache(createInMemoryRedis());
    const opts = { namespace: 'places' };

    await cache.getOrSet('a', 120, async () => 'old-a', opts);
    await cache.getOrSet('b', 120, async () => 'old-b', opts);
    await flush();
    await cache.bumpVersion('places');

    expect(await cache.getOrSet('a', 120, async () => 'new-a', opts)).toBe('new-a');
    expect(await cache.getOrSet('b', 120, async () => 'new-b', opts)).toBe('new-b');
  });

  it('a slow reader cannot re-cache data loaded before an invalidation', async () => {
    const cache = createCache(createInMemoryRedis());
    const opts = { namespace: 'places' };
    let release;

    // Reader starts, reads version 0, loads old data slowly…
    const slowRead = cache.getOrSet('detail:p1', 300, () => new Promise((resolve) => { release = resolve; }), opts);
    await flush();
    // …meanwhile a write commits and invalidates…
    await cache.bumpVersion('places');
    // …then the reader finishes with the old value and caches it (under version 0).
    release('old');
    await slowRead;
    await flush();

    expect(await cache.getOrSet('detail:p1', 300, async () => 'new', opts)).toBe('new');
  });
});

describe('hashKey', () => {
  it('is deterministic regardless of key order and ignores undefined values', () => {
    expect(hashKey({ a: 1, b: [2, 3] })).toBe(hashKey({ b: [2, 3], a: 1, c: undefined }));
  });

  it('differs when any value differs', () => {
    expect(hashKey({ page: 1 })).not.toBe(hashKey({ page: 2 }));
    expect(hashKey({ near: { latitude: 23.81 } })).not.toBe(hashKey({ near: { latitude: 23.82 } }));
  });

  it('produces a compact, Redis-safe key part', () => {
    expect(hashKey({ q: 'lalbagh fort', categories: ['museum'] })).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

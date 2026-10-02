import { describe, expect, it } from 'vitest';
import { parseEnv, productionWarnings } from '../../src/config/env.js';

const base = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/navora',
  JWT_SECRET: 'x'.repeat(32),
  UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: 'token',
};

describe('parseEnv', () => {
  it('applies safe defaults', () => {
    const config = parseEnv(base);
    expect(config.nodeEnv).toBe('development');
    expect(config.port).toBe(3000);
    expect(config.trustProxy).toBe(0);
    expect(config.corsOrigins).toEqual([]);
    expect(config.db).toMatchObject({ poolMin: 0, poolMax: 10, statementTimeoutMs: 10_000 });
    expect(config.shutdown).toEqual({ drainMs: 5_000, timeoutMs: 25_000 });
  });

  it('coerces numeric strings and parses the CORS origin list', () => {
    const config = parseEnv({
      ...base,
      PORT: '8080',
      DB_POOL_MAX: '25',
      CORS_ORIGINS: ' http://localhost:5173 , https://app.navora.example ',
    });
    expect(config.port).toBe(8080);
    expect(config.db.poolMax).toBe(25);
    expect(config.corsOrigins).toEqual(['http://localhost:5173', 'https://app.navora.example']);
  });

  it('requires DATABASE_URL', () => {
    expect(() => parseEnv({ JWT_SECRET: base.JWT_SECRET })).toThrow(/DATABASE_URL/);
  });

  it('requires a JWT secret of at least 32 characters', () => {
    expect(() => parseEnv({ DATABASE_URL: base.DATABASE_URL })).toThrow(/JWT_SECRET/);
    expect(() => parseEnv({ ...base, JWT_SECRET: 'too-short' })).toThrow(/JWT_SECRET/);
  });

  it('applies auth defaults: 15-minute access tokens, 30-day refresh tokens', () => {
    expect(parseEnv(base).auth).toEqual({
      jwtSecret: base.JWT_SECRET,
      accessTokenTtlSeconds: 900,
      issuer: 'navora-api',
      audience: 'navora-app',
      refreshTokenTtlDays: 30,
    });
  });

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() => parseEnv({ DATABASE_URL: 'mysql://localhost/db' })).toThrow(/DATABASE_URL/);
  });

  it('rejects CORS origins with a path or trailing slash', () => {
    expect(() => parseEnv({ ...base, CORS_ORIGINS: 'https://app.example.com/' })).toThrow(/CORS_ORIGINS/);
  });

  it('rejects an out-of-range port and an unknown NODE_ENV', () => {
    expect(() => parseEnv({ ...base, PORT: '70000' })).toThrow(/PORT/);
    expect(() => parseEnv({ ...base, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('rejects a pool minimum above the maximum', () => {
    expect(() => parseEnv({ ...base, DB_POOL_MIN: '20', DB_POOL_MAX: '5' })).toThrow(/DB_POOL_MIN/);
  });

  it('requires Upstash credentials over https', () => {
    const { UPSTASH_REDIS_REST_TOKEN: _token, ...withoutToken } = base;
    expect(() => parseEnv(withoutToken)).toThrow(/UPSTASH_REDIS_REST_TOKEN/);
    expect(() => parseEnv({ ...base, UPSTASH_REDIS_REST_URL: 'http://example.upstash.io' })).toThrow(/UPSTASH_REDIS_REST_URL/);
  });

  it('warns about risky production settings, and only in production', () => {
    const risky = parseEnv({ ...base, NODE_ENV: 'production' });
    const warnings = productionWarnings(risky).join('\n');
    expect(warnings).toMatch(/TRUST_PROXY=0/);
    expect(warnings).toMatch(/CORS_ORIGINS is empty/);
    expect(warnings).toMatch(/MAP_PROVIDER=estimate/);
    expect(productionWarnings(parseEnv({ ...base, NODE_ENV: 'development' }))).toEqual([]);
  });

  it('has no warnings for a well-configured production deployment', () => {
    const good = parseEnv({
      ...base,
      NODE_ENV: 'production',
      TRUST_PROXY: '1',
      CORS_ORIGINS: 'https://app.navora.example',
      SHUTDOWN_DRAIN_MS: '5000',
      MAP_PROVIDER: 'openrouteservice',
      MAP_API_KEY: 'k',
    });
    expect(productionWarnings(good)).toEqual([]);
  });

  it('returns a frozen config object', () => {
    const config = parseEnv(base);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.db)).toBe(true);
  });
});

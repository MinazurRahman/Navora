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

  it('only warns that no mail is sent for a well-configured production deployment', () => {
    const good = parseEnv({
      ...base,
      NODE_ENV: 'production',
      TRUST_PROXY: '1',
      CORS_ORIGINS: 'https://app.navora.example',
      APP_BASE_URL: 'https://app.navora.example',
      SHUTDOWN_DRAIN_MS: '5000',
      MAP_PROVIDER: 'openrouteservice',
      MAP_API_KEY: 'k',
    });
    // log is the only mail provider so far.
    expect(productionWarnings(good)).toEqual([expect.stringMatching(/^MAIL_PROVIDER=log/)]);
  });

  it('warns when reset links would point to localhost in production', () => {
    const config = parseEnv({ ...base, NODE_ENV: 'production' });
    expect(productionWarnings(config)).toContainEqual(expect.stringMatching(/^APP_BASE_URL=http:\/\/localhost:5173/));
    expect(() => parseEnv({ ...base, APP_BASE_URL: 'https://app.example/path' })).toThrow(/APP_BASE_URL/);
  });

  it('disables AI by default, with local Ollama defaults', () => {
    expect(parseEnv(base).ai).toEqual({
      enabled: false,
      provider: 'ollama',
      timeoutMs: 30_000,
      maxOutputTokens: 600,
      contextWindowTokens: 8_192,
      maxConcurrent: 2,
      ollama: { baseUrl: 'http://localhost:11434', model: 'llama3.2:3b', apiKey: null },
    });
  });

  it('parses the AI settings', () => {
    const { ai } = parseEnv({
      ...base,
      AI_ENABLED: 'true',
      OLLAMA_BASE_URL: 'http://10.0.0.5:11434',
      OLLAMA_MODEL: 'qwen2.5:7b',
      AI_TIMEOUT_MS: '45000',
      AI_MAX_OUTPUT_TOKENS: '800',
    });
    expect(ai).toMatchObject({ enabled: true, timeoutMs: 45_000, maxOutputTokens: 800, ollama: { baseUrl: 'http://10.0.0.5:11434', model: 'qwen2.5:7b' } });
  });

  it('rejects invalid AI settings', () => {
    expect(() => parseEnv({ ...base, AI_ENABLED: 'yes' })).toThrow(/AI_ENABLED/);
    expect(() => parseEnv({ ...base, AI_PROVIDER: 'openai' })).toThrow(/AI_PROVIDER/);
    expect(() => parseEnv({ ...base, OLLAMA_BASE_URL: 'http://localhost:11434/' })).toThrow(/OLLAMA_BASE_URL/);
    expect(() => parseEnv({ ...base, OLLAMA_BASE_URL: 'localhost:11434' })).toThrow(/OLLAMA_BASE_URL/);
    expect(() => parseEnv({ ...base, OLLAMA_MODEL: 'bad model; rm -rf' })).toThrow(/OLLAMA_MODEL/);
    // Above the HTTP keep-alive timeout an AI call could outlive its connection.
    expect(() => parseEnv({ ...base, AI_TIMEOUT_MS: '120000' })).toThrow(/AI_TIMEOUT_MS/);
    expect(() => parseEnv({ ...base, AI_MAX_OUTPUT_TOKENS: '100000' })).toThrow(/AI_MAX_OUTPUT_TOKENS/);
  });

  it('accepts an Ollama cloud API key only with an https base URL', () => {
    const cloud = parseEnv({ ...base, AI_ENABLED: 'true', OLLAMA_BASE_URL: 'https://ollama.com', OLLAMA_MODEL: 'gemma4:31b', OLLAMA_API_KEY: 'test-key' });
    expect(cloud.ai.ollama).toEqual({ baseUrl: 'https://ollama.com', model: 'gemma4:31b', apiKey: 'test-key' });
    expect(() => parseEnv({ ...base, OLLAMA_API_KEY: 'test-key' })).toThrow(/OLLAMA_API_KEY: needs an https OLLAMA_BASE_URL/);
    const production = parseEnv({ ...base, NODE_ENV: 'production', AI_ENABLED: 'true', OLLAMA_BASE_URL: 'https://ollama.com', OLLAMA_API_KEY: 'test-key' });
    expect(productionWarnings(production).some((w) => w.includes("Ollama's cloud"))).toBe(true);
  });

  it('parses the AI context window and concurrency limits', () => {
    expect(parseEnv({ ...base, AI_CONTEXT_WINDOW_TOKENS: '16384', AI_MAX_CONCURRENT: '4' }).ai).toMatchObject({ contextWindowTokens: 16_384, maxConcurrent: 4 });
    expect(() => parseEnv({ ...base, AI_CONTEXT_WINDOW_TOKENS: '1024' })).toThrow(/AI_CONTEXT_WINDOW_TOKENS/);
    expect(() => parseEnv({ ...base, AI_MAX_CONCURRENT: '0' })).toThrow(/AI_MAX_CONCURRENT/);
    expect(() => parseEnv({ ...base, AI_MAX_CONCURRENT: '100' })).toThrow(/AI_MAX_CONCURRENT/);
  });

  it('requires room for the prompt: answer tokens at most half the context window', () => {
    expect(() => parseEnv({ ...base, AI_CONTEXT_WINDOW_TOKENS: '2048', AI_MAX_OUTPUT_TOKENS: '1500' })).toThrow(/AI_MAX_OUTPUT_TOKENS/);
    expect(parseEnv({ ...base, AI_CONTEXT_WINDOW_TOKENS: '2048', AI_MAX_OUTPUT_TOKENS: '1024' }).ai.maxOutputTokens).toBe(1_024);
  });

  it('warns in production when AI talks plain http to a non-private Ollama host', () => {
    const prod = (url, enabled = 'true') => productionWarnings(parseEnv({ ...base, NODE_ENV: 'production', AI_ENABLED: enabled, OLLAMA_BASE_URL: url })).join('\n');
    expect(prod('http://203.0.113.7:11434')).toContain('OLLAMA_BASE_URL=http://203.0.113.7:11434: plain http to a non-private host');
    expect(prod('http://ollama.example.com:11434')).toMatch(/OLLAMA_BASE_URL/);
    for (const safe of ['http://localhost:11434', 'http://127.0.0.1:11434', 'http://[::1]:11434', 'http://10.0.0.5:11434', 'http://172.20.1.2:11434', 'http://192.168.1.9:11434', 'http://ollama:11434', 'http://ai.internal:11434', 'https://ollama.example.com']) {
      expect(prod(safe), safe).not.toMatch(/OLLAMA_BASE_URL/);
    }
    expect(prod('http://203.0.113.7:11434', 'false')).not.toMatch(/OLLAMA_BASE_URL/);
  });

  it('returns a frozen config object', () => {
    const config = parseEnv(base);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.db)).toBe(true);
  });
});

import { z } from 'zod';

// Load .env for local development. Real environments inject variables directly,
// and variables that are already set are never overridden by the file.
// Tests get their values from vitest.config.js instead.
if (process.env.NODE_ENV !== 'test') {
  try {
    process.loadEnvFile();
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

const intInRange = (min, max) => z.coerce.number().int().min(min).max(max);

const originSchema = z
  .string()
  .regex(/^https?:\/\/[^/\s]+$/, 'must be an origin like https://app.example.com (no path or trailing slash)');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: intInRange(1, 65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // Number of reverse-proxy / load-balancer hops in front of the app, so req.ip is the real client.
  TRUST_PROXY: intInRange(0, 10).default(0),

  // Comma-separated list of allowed browser origins. Empty = no cross-origin browser access.
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((value) => value.split(',').map((origin) => origin.trim()).filter(Boolean))
    .pipe(z.array(originSchema)),

  JSON_BODY_LIMIT: z.string().regex(/^\d+(b|kb|mb)$/i).default('100kb'),

  // TLS: add ?sslmode=require (or verify-full) to the URL; pg reads it from the connection string.
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\/.+/, 'must be a postgres:// connection string'),
  DB_POOL_MIN: intInRange(0, 100).default(0),
  DB_POOL_MAX: intInRange(1, 100).default(10),
  DB_STATEMENT_TIMEOUT_MS: intInRange(100, 600_000).default(10_000),

  // Must exceed the load balancer's idle timeout to avoid intermittent 502s.
  HTTP_KEEP_ALIVE_TIMEOUT_MS: intInRange(1_000, 600_000).default(65_000),
  READINESS_TIMEOUT_MS: intInRange(100, 30_000).default(2_000),

  // Time to keep serving after /ready turns 503, so the load balancer can stop routing here.
  SHUTDOWN_DRAIN_MS: intInRange(0, 60_000).default(5_000),
  SHUTDOWN_TIMEOUT_MS: intInRange(1_000, 120_000).default(25_000),

  // HS256 signing key shared by every instance. Generate with:
  // node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
  JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
  JWT_ACCESS_TOKEN_TTL_SECONDS: intInRange(60, 3_600).default(900),
  JWT_ISSUER: z.string().min(1).default('navora-api'),
  JWT_AUDIENCE: z.string().min(1).default('navora-app'),
  REFRESH_TOKEN_TTL_DAYS: intInRange(1, 90).default(30),

  // Shared by every instance: rate-limit counters and cache.
  UPSTASH_REDIS_REST_URL: z.string().regex(/^https:\/\/\S+$/, 'must be an https:// URL'),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),

  // Routing provider. "estimate" = straight-line estimates, no external calls.
  MAP_PROVIDER: z.enum(['estimate', 'openrouteservice']).default('estimate'),
  MAP_API_KEY: z.string().min(1).optional(),
  MAP_TIMEOUT_MS: intInRange(500, 30_000).default(5_000),
  // On provider failure: "true" = use flagged estimates; "false" = fail with 503.
  MAP_FALLBACK_TO_ESTIMATE: z.enum(['true', 'false']).default('true'),
});

export function parseEnv(source) {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment configuration:\n${problems.join('\n')}`);
  }

  const e = result.data;
  if (e.DB_POOL_MIN > e.DB_POOL_MAX) {
    throw new Error('Invalid environment configuration:\n  - DB_POOL_MIN: must not exceed DB_POOL_MAX');
  }
  if (e.MAP_PROVIDER !== 'estimate' && !e.MAP_API_KEY) {
    throw new Error(`Invalid environment configuration:\n  - MAP_API_KEY: required when MAP_PROVIDER=${e.MAP_PROVIDER}`);
  }

  return Object.freeze({
    nodeEnv: e.NODE_ENV,
    isProduction: e.NODE_ENV === 'production',
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    trustProxy: e.TRUST_PROXY,
    corsOrigins: Object.freeze(e.CORS_ORIGINS),
    jsonBodyLimit: e.JSON_BODY_LIMIT,
    db: Object.freeze({
      url: e.DATABASE_URL,
      poolMin: e.DB_POOL_MIN,
      poolMax: e.DB_POOL_MAX,
      statementTimeoutMs: e.DB_STATEMENT_TIMEOUT_MS,
    }),
    http: Object.freeze({
      keepAliveTimeoutMs: e.HTTP_KEEP_ALIVE_TIMEOUT_MS,
      readinessTimeoutMs: e.READINESS_TIMEOUT_MS,
    }),
    shutdown: Object.freeze({
      drainMs: e.SHUTDOWN_DRAIN_MS,
      timeoutMs: e.SHUTDOWN_TIMEOUT_MS,
    }),
    auth: Object.freeze({
      jwtSecret: e.JWT_SECRET,
      accessTokenTtlSeconds: e.JWT_ACCESS_TOKEN_TTL_SECONDS,
      issuer: e.JWT_ISSUER,
      audience: e.JWT_AUDIENCE,
      refreshTokenTtlDays: e.REFRESH_TOKEN_TTL_DAYS,
    }),
    redis: Object.freeze({
      url: e.UPSTASH_REDIS_REST_URL,
      token: e.UPSTASH_REDIS_REST_TOKEN,
    }),
    maps: Object.freeze({
      provider: e.MAP_PROVIDER,
      apiKey: e.MAP_API_KEY,
      timeoutMs: e.MAP_TIMEOUT_MS,
      fallbackToEstimate: e.MAP_FALLBACK_TO_ESTIMATE === 'true',
    }),
  });
}

// Settings that are valid but almost certainly wrong in production. Warnings, not errors:
// e.g. a deployment without a proxy legitimately has TRUST_PROXY=0.
export function productionWarnings(config) {
  if (!config.isProduction) return [];
  const warnings = [];
  if (config.trustProxy === 0) {
    warnings.push('TRUST_PROXY=0: behind a load balancer or reverse proxy every client then shares one rate-limit bucket and logs show the proxy IP. Set it to the number of proxy hops.');
  }
  if (config.corsOrigins.length === 0) {
    warnings.push('CORS_ORIGINS is empty: no browser frontend can call the API.');
  }
  if (config.shutdown.drainMs === 0) {
    warnings.push('SHUTDOWN_DRAIN_MS=0: the load balancer may still route requests to an instance that is shutting down.');
  }
  if (config.maps.provider === 'estimate') {
    warnings.push('MAP_PROVIDER=estimate: itineraries use distance-based travel-time estimates, not road routing.');
  }
  if (config.logLevel === 'debug' || config.logLevel === 'trace') {
    warnings.push(`LOG_LEVEL=${config.logLevel}: very verbose logging in production.`);
  }
  return warnings;
}

export const env = parseEnv(process.env);

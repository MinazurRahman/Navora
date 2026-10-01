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
  });
}

export const env = parseEnv(process.env);

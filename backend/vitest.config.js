import { defineConfig } from 'vitest/config';

// Picks up TEST_DATABASE_URL from .env; test.env below still overrides app settings.
try {
  process.loadEnvFile();
} catch {
  // no .env: database tests are skipped
}
if (process.env.TEST_DATABASE_URL && process.env.TEST_DATABASE_URL === process.env.DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL must not equal DATABASE_URL: the database tests wipe their database.');
}

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    // Deterministic config for tests; .env is not loaded when NODE_ENV=test.
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: 'postgres://test:test@localhost:5432/navora_unused',
      JWT_SECRET: 'test-only-jwt-secret-that-is-long-enough-123',
    },
    // Integration test files share one database; run files one at a time.
    fileParallelism: false,
  },
});

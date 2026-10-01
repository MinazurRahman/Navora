import knex from 'knex';
import pg from 'pg';

// DATE columns as plain "YYYY-MM-DD" strings. By default pg builds a JS Date at local
// midnight, which shifts the day when serialised to UTC (e.g. in Asia/Dhaka, UTC+6).
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

// Shared by the app (createDb) and the Knex CLI (knexfile.js) so both use identical settings.
export function buildKnexConfig(config) {
  return {
    client: 'pg',
    connection: {
      connectionString: config.db.url,
      application_name: 'navora-api',
      statement_timeout: config.db.statementTimeoutMs,
    },
    pool: { min: config.db.poolMin, max: config.db.poolMax },
    acquireConnectionTimeout: 10_000,
    migrations: {
      directory: './migrations',
      tableName: 'knex_migrations',
    },
    seeds: {
      directory: './seeds',
    },
  };
}

// `logger` routes Knex's own warnings/errors into structured logs instead of the console.
export function createDb(config, { logger } = {}) {
  const knexConfig = buildKnexConfig(config);
  if (logger) {
    const dbLogger = logger.child({ component: 'knex' });
    knexConfig.log = {
      warn: (message) => dbLogger.warn({ detail: String(message) }, 'Knex warning'),
      error: (message) => dbLogger.error({ detail: String(message) }, 'Knex error'),
      deprecate: (message) => dbLogger.warn({ detail: String(message) }, 'Knex deprecation'),
      debug: (message) => dbLogger.debug({ detail: message }, 'Knex debug'),
    };
  }
  return knex(knexConfig);
}

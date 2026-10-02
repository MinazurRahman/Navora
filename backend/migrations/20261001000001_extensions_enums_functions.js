export async function up(knex) {
  await knex.raw(`
    CREATE EXTENSION IF NOT EXISTS postgis;
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    CREATE EXTENSION IF NOT EXISTS citext;

    CREATE TYPE user_role         AS ENUM ('user', 'moderator', 'admin');
    CREATE TYPE place_status      AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'ARCHIVED');
    -- Practical facts about a place. UNKNOWN is never treated as YES.
    CREATE TYPE facility_status   AS ENUM ('YES', 'NO', 'UNKNOWN');
    CREATE TYPE travel_mode       AS ENUM ('car', 'walking', 'cycling', 'public_transport');
    CREATE TYPE budget_type       AS ENUM ('total', 'per_day');
    CREATE TYPE moderation_action AS ENUM
      ('SUBMITTED', 'EDITED', 'RESUBMITTED', 'APPROVED', 'REJECTED', 'ARCHIVED', 'RESTORED');

    -- Shared BEFORE UPDATE trigger function that keeps updated_at current.
    CREATE FUNCTION set_updated_at() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$;
  `);
}

export async function down(knex) {
  await knex.raw(`
    DROP FUNCTION IF EXISTS set_updated_at();
    DROP TYPE IF EXISTS moderation_action;
    DROP TYPE IF EXISTS budget_type;
    DROP TYPE IF EXISTS travel_mode;
    DROP TYPE IF EXISTS facility_status;
    DROP TYPE IF EXISTS place_status;
    DROP TYPE IF EXISTS user_role;
  `);
  // Extensions are left installed: they are database-wide and other objects may depend on
  // them (the postgis/postgis Docker image pre-installs postgis_topology, which needs
  // postgis). `up` uses IF NOT EXISTS, so re-applying works.
}

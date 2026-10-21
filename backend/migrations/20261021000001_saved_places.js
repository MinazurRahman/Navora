export async function up(knex) {
  await knex.raw(`
    CREATE TABLE saved_places (
      user_id     uuid        NOT NULL REFERENCES users (id)  ON DELETE CASCADE,
      place_id    uuid        NOT NULL REFERENCES places (id) ON DELETE CASCADE,
      created_at  timestamptz NOT NULL DEFAULT now(),
      -- One row per user and place: saving twice is a no-op.
      PRIMARY KEY (user_id, place_id)
    );

    -- "My saved places", most recently saved first.
    CREATE INDEX saved_places_user_created_idx ON saved_places (user_id, created_at DESC);
  `);
}

export async function down(knex) {
  await knex.raw('DROP TABLE IF EXISTS saved_places;');
}

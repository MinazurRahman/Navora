export async function up(knex) {
  await knex.raw(`
    CREATE TABLE reviews (
      id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     uuid        NOT NULL REFERENCES users (id)  ON DELETE CASCADE,
      place_id    uuid        NOT NULL REFERENCES places (id) ON DELETE CASCADE,
      rating      smallint    NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment     text        CHECK (comment IS NULL OR char_length(comment) <= 2000),
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now(),
      -- One review per user per place; also serves lookups by user.
      CONSTRAINT reviews_user_place_key UNIQUE (user_id, place_id)
    );

    CREATE INDEX reviews_place_created_idx ON reviews (place_id, created_at DESC);

    CREATE TRIGGER reviews_set_updated_at
      BEFORE UPDATE ON reviews FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    -- Keeps places.rating_sum / review_count correct on every write path, including
    -- cascade deletes that never pass through the application. Atomic increments,
    -- so concurrent reviews cannot race.
    CREATE FUNCTION apply_review_rating_change() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP IN ('UPDATE', 'DELETE') THEN
        UPDATE places
           SET rating_sum = rating_sum - OLD.rating, review_count = review_count - 1
         WHERE id = OLD.place_id;
      END IF;
      IF TG_OP IN ('INSERT', 'UPDATE') THEN
        UPDATE places
           SET rating_sum = rating_sum + NEW.rating, review_count = review_count + 1
         WHERE id = NEW.place_id;
      END IF;
      RETURN NULL;
    END;
    $$;

    CREATE TRIGGER reviews_rating_aggregate
      AFTER INSERT OR DELETE OR UPDATE OF rating, place_id ON reviews
      FOR EACH ROW EXECUTE FUNCTION apply_review_rating_change();
  `);
}

export async function down(knex) {
  await knex.raw(`
    DROP TABLE IF EXISTS reviews;
    DROP FUNCTION IF EXISTS apply_review_rating_change();
  `);
}

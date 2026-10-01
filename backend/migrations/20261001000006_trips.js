export async function up(knex) {
  await knex.raw(`
    -- Every requirement that can EXCLUDE a place is an explicit typed column, never
    -- buried in JSON, so the planner cannot silently ignore a hard requirement.
    CREATE TABLE trips (
      id                          uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id                     uuid           NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      title                       varchar(150)   NOT NULL CHECK (char_length(btrim(title)) > 0),

      start_location              geography(Point, 4326) NOT NULL,
      start_address               text,
      -- NULL = planner assumes the trip starts today.
      start_date                  date,
      duration_days               smallint       NOT NULL CHECK (duration_days BETWEEN 1 AND 14),
      daily_start_time            time           NOT NULL,
      daily_end_time              time           NOT NULL,
      search_radius_m             integer        NOT NULL CHECK (search_radius_m BETWEEN 500 AND 100000),

      budget_amount               numeric(12, 2) CHECK (budget_amount IS NULL OR budget_amount >= 0),
      budget_type                 budget_type,
      budget_currency             char(3)        NOT NULL DEFAULT 'BDT' CHECK (budget_currency ~ '^[A-Z]{3}$'),

      -- Hard requirements
      travel_mode                 travel_mode    NOT NULL,
      traveling_with_pet          boolean        NOT NULL DEFAULT false,
      parking_required            boolean        NOT NULL DEFAULT false,
      wheelchair_access_required  boolean        NOT NULL DEFAULT false,
      party_size                  smallint       NOT NULL DEFAULT 1 CHECK (party_size BETWEEN 1 AND 50),

      -- Soft preference
      min_rating                  numeric(2, 1)  CHECK (min_rating IS NULL OR min_rating BETWEEN 1 AND 5),

      -- Informational party details only; never used as a hard filter.
      party_details               jsonb          NOT NULL DEFAULT '{}'::jsonb
                                                 CHECK (jsonb_typeof(party_details) = 'object'),

      created_at                  timestamptz    NOT NULL DEFAULT now(),
      updated_at                  timestamptz    NOT NULL DEFAULT now(),

      CONSTRAINT trips_daily_window_check CHECK (daily_start_time < daily_end_time),
      CONSTRAINT trips_budget_pair_check  CHECK ((budget_amount IS NULL) = (budget_type IS NULL))
    );

    CREATE TRIGGER trips_set_updated_at
      BEFORE UPDATE ON trips FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    -- No spatial index on start_location: it is only ever the centre of a query.
    CREATE INDEX trips_user_created_idx ON trips (user_id, created_at DESC);

    CREATE TABLE trip_interests (
      trip_id  uuid NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
      tag_id   uuid NOT NULL REFERENCES tags (id)  ON DELETE RESTRICT,
      PRIMARY KEY (trip_id, tag_id)
    );
    CREATE INDEX trip_interests_tag_id_idx ON trip_interests (tag_id);

    CREATE TABLE trip_preferred_categories (
      trip_id      uuid NOT NULL REFERENCES trips (id)      ON DELETE CASCADE,
      category_id  uuid NOT NULL REFERENCES categories (id) ON DELETE RESTRICT,
      PRIMARY KEY (trip_id, category_id)
    );
    CREATE INDEX trip_preferred_categories_category_id_idx ON trip_preferred_categories (category_id);

    -- "Select places, then plan" flow: the planner must include these or fail with a reason.
    CREATE TABLE trip_selected_places (
      trip_id     uuid        NOT NULL REFERENCES trips (id)  ON DELETE CASCADE,
      place_id    uuid        NOT NULL REFERENCES places (id) ON DELETE RESTRICT,
      created_at  timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (trip_id, place_id)
    );
    CREATE INDEX trip_selected_places_place_id_idx ON trip_selected_places (place_id);
  `);
}

export async function down(knex) {
  await knex.raw(`
    DROP TABLE IF EXISTS trip_selected_places;
    DROP TABLE IF EXISTS trip_preferred_categories;
    DROP TABLE IF EXISTS trip_interests;
    DROP TABLE IF EXISTS trips;
  `);
}

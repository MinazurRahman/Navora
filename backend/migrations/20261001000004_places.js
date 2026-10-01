export async function up(knex) {
  await knex.raw(`
    CREATE TABLE places (
      id                         uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
      name                       varchar(200)     NOT NULL CHECK (char_length(btrim(name)) > 0),
      description                text,
      category_id                uuid             NOT NULL REFERENCES categories (id) ON DELETE RESTRICT,
      -- geography (not geometry): distances in metres, ST_DWithin can use the GiST index.
      location                   geography(Point, 4326) NOT NULL,
      address                    text,
      city                       varchar(100),
      -- IANA zone; opening hours are local times at the place.
      timezone                   varchar(64)      NOT NULL DEFAULT 'Asia/Dhaka',

      -- NULL = unknown, 0 = free
      entry_fee                  numeric(10, 2)   CHECK (entry_fee IS NULL OR entry_fee >= 0),
      currency                   char(3)          NOT NULL DEFAULT 'BDT' CHECK (currency ~ '^[A-Z]{3}$'),
      -- NULL = use the category default from configuration
      typical_visit_minutes      smallint         CHECK (typical_visit_minutes IS NULL
                                                         OR typical_visit_minutes BETWEEN 5 AND 720),

      parking_available          facility_status  NOT NULL DEFAULT 'UNKNOWN',
      pet_friendly               facility_status  NOT NULL DEFAULT 'UNKNOWN',
      wheelchair_accessible      facility_status  NOT NULL DEFAULT 'UNKNOWN',
      accessibility_notes        text,
      restrictions               text,
      facilities_verified_at     timestamptz,
      opening_hours_verified_at  timestamptz,

      status                     place_status     NOT NULL DEFAULT 'PENDING',
      created_by                 uuid             REFERENCES users (id) ON DELETE SET NULL,

      -- Rating aggregate, maintained by the trigger on reviews (see reviews migration).
      rating_sum                 integer          NOT NULL DEFAULT 0,
      review_count               integer          NOT NULL DEFAULT 0,
      avg_rating                 numeric(3, 2)    GENERATED ALWAYS AS (
                                   CASE WHEN review_count > 0
                                        THEN round(rating_sum::numeric / review_count, 2) END
                                 ) STORED,

      -- 'simple' config: no English stemming, so Bangla and other text is not mangled.
      search_vector              tsvector         GENERATED ALWAYS AS (
                                   setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
                                   setweight(to_tsvector('simple', coalesce(description, '')), 'B')
                                 ) STORED,

      created_at                 timestamptz      NOT NULL DEFAULT now(),
      updated_at                 timestamptz      NOT NULL DEFAULT now(),

      CONSTRAINT places_rating_aggregate_check
        CHECK (review_count >= 0 AND rating_sum BETWEEN review_count AND review_count * 5)
    );

    CREATE TRIGGER places_set_updated_at
      BEFORE UPDATE ON places FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    -- Radius search (ST_DWithin) and nearest-first ordering (<->). Covers all statuses
    -- so submission duplicate checks can also search PENDING places.
    CREATE INDEX places_location_gist     ON places USING gist (location);
    CREATE INDEX places_search_vector_gin ON places USING gin (search_vector);
    CREATE INDEX places_name_trgm_gin     ON places USING gin (name gin_trgm_ops);
    CREATE INDEX places_category_id_idx   ON places (category_id);
    CREATE INDEX places_created_by_idx    ON places (created_by);
    CREATE INDEX places_moderation_queue_idx ON places (created_at) WHERE status = 'PENDING';

    CREATE TABLE place_tags (
      place_id  uuid NOT NULL REFERENCES places (id) ON DELETE CASCADE,
      tag_id    uuid NOT NULL REFERENCES tags (id)   ON DELETE CASCADE,
      PRIMARY KEY (place_id, tag_id)
    );
    CREATE INDEX place_tags_tag_id_idx ON place_tags (tag_id);

    -- Weekly schedule. Several rows per day = split hours. Overnight hours are split
    -- across two days. No rows for a day (when other days have rows) = closed that day.
    -- No rows at all = opening hours UNKNOWN (never assumed open).
    CREATE TABLE place_opening_hours (
      id           uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
      place_id     uuid     NOT NULL REFERENCES places (id) ON DELETE CASCADE,
      day_of_week  smallint NOT NULL CHECK (day_of_week BETWEEN 1 AND 7), -- ISO: 1 = Monday
      opens_at     time     NOT NULL,
      closes_at    time     NOT NULL, -- '24:00' allowed
      CONSTRAINT place_opening_hours_interval_check CHECK (opens_at < closes_at)
    );
    CREATE INDEX place_opening_hours_place_day_idx ON place_opening_hours (place_id, day_of_week);

    -- Audit trail for community submissions and moderation.
    CREATE TABLE place_moderation_events (
      id           uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
      place_id     uuid              NOT NULL REFERENCES places (id) ON DELETE CASCADE,
      actor_id     uuid              REFERENCES users (id) ON DELETE SET NULL,
      action       moderation_action NOT NULL,
      from_status  place_status,
      to_status    place_status      NOT NULL,
      note         text,
      created_at   timestamptz       NOT NULL DEFAULT now()
    );
    CREATE INDEX place_moderation_events_place_idx ON place_moderation_events (place_id, created_at DESC);
    CREATE INDEX place_moderation_events_actor_idx ON place_moderation_events (actor_id);
  `);
}

export async function down(knex) {
  await knex.raw(`
    DROP TABLE IF EXISTS place_moderation_events;
    DROP TABLE IF EXISTS place_opening_hours;
    DROP TABLE IF EXISTS place_tags;
    DROP TABLE IF EXISTS places;
  `);
}

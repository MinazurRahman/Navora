export async function up(knex) {
  await knex.raw(`
    -- Versioned: regenerate inserts version N+1 and clears is_current on the previous one.
    CREATE TABLE itineraries (
      id                      uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
      trip_id                 uuid           NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
      version                 integer        NOT NULL CHECK (version >= 1),
      is_current              boolean        NOT NULL DEFAULT true,
      is_user_modified        boolean        NOT NULL DEFAULT false,

      total_distance_m        integer        NOT NULL DEFAULT 0 CHECK (total_distance_m >= 0),
      total_travel_seconds    integer        NOT NULL DEFAULT 0 CHECK (total_travel_seconds >= 0),
      total_visit_minutes     integer        NOT NULL DEFAULT 0 CHECK (total_visit_minutes >= 0),
      estimated_cost          numeric(12, 2) CHECK (estimated_cost IS NULL OR estimated_cost >= 0),
      currency                char(3)        NOT NULL DEFAULT 'BDT' CHECK (currency ~ '^[A-Z]{3}$'),

      routing_provider        varchar(30)    NOT NULL,
      -- true when the straight-line fallback was used instead of real routing data
      travel_times_estimated  boolean        NOT NULL DEFAULT false,
      algorithm               varchar(50)    NOT NULL,
      -- Snapshot of the inputs (incl. resolved start date) and scoring weights used.
      generation_params       jsonb          NOT NULL CHECK (jsonb_typeof(generation_params) = 'object'),
      -- e.g. [{ "code": "OPENING_HOURS_UNVERIFIED", "message": "...", "placeId": "...", "dayNumber": 2 }]
      warnings                jsonb          NOT NULL DEFAULT '[]'::jsonb
                                             CHECK (jsonb_typeof(warnings) = 'array'),

      created_at              timestamptz    NOT NULL DEFAULT now(),
      updated_at              timestamptz    NOT NULL DEFAULT now(),

      CONSTRAINT itineraries_trip_version_key UNIQUE (trip_id, version)
    );

    CREATE TRIGGER itineraries_set_updated_at
      BEFORE UPDATE ON itineraries FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    CREATE UNIQUE INDEX itineraries_one_current_per_trip ON itineraries (trip_id) WHERE is_current;

    -- Days and stops are always written with their itinerary; itineraries.updated_at covers edits.
    CREATE TABLE itinerary_days (
      id                    uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
      itinerary_id          uuid     NOT NULL REFERENCES itineraries (id) ON DELETE CASCADE,
      day_number            smallint NOT NULL CHECK (day_number >= 1),
      -- Always resolved (trip start_date, or "today" when it was not given).
      date                  date     NOT NULL,
      start_time            time     NOT NULL,
      end_time              time     NOT NULL,
      total_distance_m      integer  NOT NULL DEFAULT 0 CHECK (total_distance_m >= 0),
      total_travel_seconds  integer  NOT NULL DEFAULT 0 CHECK (total_travel_seconds >= 0),
      total_visit_minutes   integer  NOT NULL DEFAULT 0 CHECK (total_visit_minutes >= 0),
      -- Encoded polyline for map display only (never queried spatially).
      route_polyline        text,
      CONSTRAINT itinerary_days_window_check CHECK (start_time < end_time),
      CONSTRAINT itinerary_days_itinerary_day_key UNIQUE (itinerary_id, day_number)
    );

    CREATE TABLE itinerary_stops (
      id                               uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
      day_id                           uuid           NOT NULL REFERENCES itinerary_days (id) ON DELETE CASCADE,
      place_id                         uuid           NOT NULL REFERENCES places (id) ON DELETE RESTRICT,
      visit_order                      smallint       NOT NULL CHECK (visit_order >= 1),
      planned_start                    time           NOT NULL,
      planned_end                      time           NOT NULL,
      visit_minutes                    smallint       NOT NULL CHECK (visit_minutes > 0),
      travel_seconds_from_previous     integer        NOT NULL DEFAULT 0 CHECK (travel_seconds_from_previous >= 0),
      travel_distance_m_from_previous  integer        NOT NULL DEFAULT 0 CHECK (travel_distance_m_from_previous >= 0),
      -- Entry-fee snapshot at generation time.
      estimated_cost                   numeric(10, 2) CHECK (estimated_cost IS NULL OR estimated_cost >= 0),
      -- false = the place's opening hours are unknown; the stop is never assumed open.
      opening_hours_verified           boolean        NOT NULL,
      is_user_added                    boolean        NOT NULL DEFAULT false,
      CONSTRAINT itinerary_stops_time_check CHECK (planned_start < planned_end),
      -- Deferred so reordering (swapping positions) works inside one transaction.
      CONSTRAINT itinerary_stops_day_order_key UNIQUE (day_id, visit_order) DEFERRABLE INITIALLY DEFERRED,
      CONSTRAINT itinerary_stops_day_place_key UNIQUE (day_id, place_id)
    );
    CREATE INDEX itinerary_stops_place_id_idx ON itinerary_stops (place_id);
  `);
}

export async function down(knex) {
  await knex.raw(`
    DROP TABLE IF EXISTS itinerary_stops;
    DROP TABLE IF EXISTS itinerary_days;
    DROP TABLE IF EXISTS itineraries;
  `);
}

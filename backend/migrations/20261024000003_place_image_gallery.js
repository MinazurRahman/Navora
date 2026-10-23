export async function up(knex) {
  await knex.raw(`
    -- Several photos per place, in display order (position 0 = cover). Hosted elsewhere, so
    -- the API stays stateless; each row carries the credit its license requires.
    CREATE TABLE place_images (
      id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      place_id     uuid        NOT NULL REFERENCES places (id) ON DELETE CASCADE,
      position     smallint    NOT NULL CHECK (position BETWEEN 0 AND 49),
      url          text        NOT NULL CHECK (url ~ '^https://'),
      thumb_url    text        NOT NULL CHECK (thumb_url ~ '^https://'),
      author       text        NOT NULL CHECK (char_length(author) <= 200),
      license      text        NOT NULL CHECK (char_length(license) <= 100),
      license_url  text        CHECK (license_url ~ '^(http|https)://'),
      source_url   text        NOT NULL CHECK (source_url ~ '^https://'),
      created_at   timestamptz NOT NULL DEFAULT now(),
      UNIQUE (place_id, position)
    );

    INSERT INTO place_images (place_id, position, url, thumb_url, author, license, license_url, source_url)
      SELECT id, 0, image_url, image_url, image_author, image_license, image_license_url, image_source_url
      FROM places WHERE image_url IS NOT NULL;

    ALTER TABLE places
      DROP CONSTRAINT places_image_credit_check,
      DROP COLUMN image_url,
      DROP COLUMN image_author,
      DROP COLUMN image_license,
      DROP COLUMN image_license_url,
      DROP COLUMN image_source_url;
  `);
}

export async function down(knex) {
  await knex.raw(`
    ALTER TABLE places
      ADD COLUMN image_url          text CHECK (image_url ~ '^https://'),
      ADD COLUMN image_author       text CHECK (char_length(image_author) <= 200),
      ADD COLUMN image_license      text CHECK (char_length(image_license) <= 100),
      ADD COLUMN image_license_url  text CHECK (image_license_url ~ '^(http|https)://'),
      ADD COLUMN image_source_url   text CHECK (image_source_url ~ '^https://'),
      ADD CONSTRAINT places_image_credit_check
        CHECK (image_url IS NULL OR (image_author IS NOT NULL AND image_license IS NOT NULL AND image_source_url IS NOT NULL));

    UPDATE places p SET
      image_url = i.url, image_author = i.author, image_license = i.license,
      image_license_url = i.license_url, image_source_url = i.source_url
    FROM place_images i WHERE i.place_id = p.id AND i.position = 0;

    DROP TABLE place_images;
  `);
}

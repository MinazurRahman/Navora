export async function up(knex) {
  await knex.raw(`
    -- One photo per place, hosted elsewhere (the API stays stateless): a URL plus the
    -- credit its license requires (author, license name and link, source page).
    ALTER TABLE places
      ADD COLUMN image_url          text CHECK (image_url ~ '^https://'),
      ADD COLUMN image_author       text CHECK (char_length(image_author) <= 200),
      ADD COLUMN image_license      text CHECK (char_length(image_license) <= 100),
      ADD COLUMN image_license_url  text CHECK (image_license_url ~ '^(http|https)://'),
      ADD COLUMN image_source_url   text CHECK (image_source_url ~ '^https://'),
      ADD CONSTRAINT places_image_credit_check
        CHECK (image_url IS NULL OR (image_author IS NOT NULL AND image_license IS NOT NULL AND image_source_url IS NOT NULL));
  `);
}

export async function down(knex) {
  await knex.raw(`
    ALTER TABLE places
      DROP CONSTRAINT IF EXISTS places_image_credit_check,
      DROP COLUMN IF EXISTS image_url,
      DROP COLUMN IF EXISTS image_author,
      DROP COLUMN IF EXISTS image_license,
      DROP COLUMN IF EXISTS image_license_url,
      DROP COLUMN IF EXISTS image_source_url;
  `);
}

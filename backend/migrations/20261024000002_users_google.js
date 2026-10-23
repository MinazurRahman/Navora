export async function up(knex) {
  await knex.raw(`
    -- Sign-in with Google: the account's stable Google ID ("sub"). An account made through
    -- Google has no password until the user sets one (password reset).
    ALTER TABLE users
      ADD COLUMN google_sub text UNIQUE CHECK (char_length(google_sub) <= 255),
      ALTER COLUMN password_hash DROP NOT NULL,
      ADD CONSTRAINT users_can_sign_in_check CHECK (password_hash IS NOT NULL OR google_sub IS NOT NULL);
  `);
}

export async function down(knex) {
  // Google-only accounts get an unusable password hash (verification fails, never succeeds);
  // they can still reset their password by email.
  await knex.raw(`
    UPDATE users SET password_hash = '!google-only' WHERE password_hash IS NULL;
    ALTER TABLE users
      DROP CONSTRAINT IF EXISTS users_can_sign_in_check,
      ALTER COLUMN password_hash SET NOT NULL,
      DROP COLUMN IF EXISTS google_sub;
  `);
}

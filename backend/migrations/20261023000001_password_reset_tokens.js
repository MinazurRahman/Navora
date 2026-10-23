export async function up(knex) {
  await knex.raw(`
    -- Single-use password reset links. Like refresh tokens, only the SHA-256 hash of the
    -- random token is stored, so a database leak does not yield usable links.
    CREATE TABLE password_reset_tokens (
      id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      token_hash  text        NOT NULL UNIQUE,
      expires_at  timestamptz NOT NULL,
      used_at     timestamptz,
      created_at  timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX password_reset_tokens_user_idx ON password_reset_tokens (user_id);
  `);
}

export async function down(knex) {
  await knex.raw('DROP TABLE IF EXISTS password_reset_tokens;');
}

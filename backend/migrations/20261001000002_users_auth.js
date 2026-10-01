export async function up(knex) {
  await knex.raw(`
    CREATE TABLE users (
      id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
      name               varchar(100) NOT NULL CHECK (char_length(btrim(name)) > 0),
      email              citext       NOT NULL CHECK (char_length(email) <= 254),
      password_hash      text         NOT NULL,
      role               user_role    NOT NULL DEFAULT 'user',
      profile_image_url  text,
      is_active          boolean      NOT NULL DEFAULT true,
      created_at         timestamptz  NOT NULL DEFAULT now(),
      updated_at         timestamptz  NOT NULL DEFAULT now(),
      CONSTRAINT users_email_key UNIQUE (email)
    );

    CREATE TRIGGER users_set_updated_at
      BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    -- Only a SHA-256 hash of each refresh token is stored. family_id links a rotation
    -- chain so reuse of an already-rotated token can revoke the whole family.
    CREATE TABLE refresh_tokens (
      id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id         uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      family_id       uuid        NOT NULL,
      token_hash      char(64)    NOT NULL,
      expires_at      timestamptz NOT NULL,
      revoked_at      timestamptz,
      replaced_by_id  uuid        REFERENCES refresh_tokens (id) ON DELETE SET NULL,
      created_at      timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT refresh_tokens_token_hash_key UNIQUE (token_hash)
    );

    CREATE INDEX refresh_tokens_user_id_idx        ON refresh_tokens (user_id);
    CREATE INDEX refresh_tokens_family_id_idx      ON refresh_tokens (family_id);
    CREATE INDEX refresh_tokens_replaced_by_id_idx ON refresh_tokens (replaced_by_id);
  `);
}

export async function down(knex) {
  await knex.raw(`
    DROP TABLE IF EXISTS refresh_tokens;
    DROP TABLE IF EXISTS users;
  `);
}

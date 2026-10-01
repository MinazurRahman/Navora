// Categories: the single primary type of a place (museum, park, restaurant, …).
// Tags: interests that cut across categories (history, food, photography, …).
export async function up(knex) {
  await knex.raw(`
    CREATE TABLE categories (
      id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
      slug         varchar(50)  NOT NULL CHECK (slug ~ '^[a-z0-9_]+$'),
      name         varchar(100) NOT NULL,
      description  text,
      created_at   timestamptz  NOT NULL DEFAULT now(),
      updated_at   timestamptz  NOT NULL DEFAULT now(),
      CONSTRAINT categories_slug_key UNIQUE (slug),
      CONSTRAINT categories_name_key UNIQUE (name)
    );

    CREATE TRIGGER categories_set_updated_at
      BEFORE UPDATE ON categories FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    CREATE TABLE tags (
      id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
      slug        varchar(50)  NOT NULL CHECK (slug ~ '^[a-z0-9_]+$'),
      name        varchar(100) NOT NULL,
      created_at  timestamptz  NOT NULL DEFAULT now(),
      CONSTRAINT tags_slug_key UNIQUE (slug),
      CONSTRAINT tags_name_key UNIQUE (name)
    );
  `);
}

export async function down(knex) {
  await knex.raw(`
    DROP TABLE IF EXISTS tags;
    DROP TABLE IF EXISTS categories;
  `);
}

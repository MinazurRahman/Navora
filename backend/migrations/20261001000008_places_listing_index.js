// Default listing: newest approved places first (GET /places without a search or location).
export async function up(knex) {
  await knex.raw(`
    CREATE INDEX places_approved_newest_idx ON places (created_at DESC, id) WHERE status = 'APPROVED';
  `);
}

export async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS places_approved_newest_idx;');
}

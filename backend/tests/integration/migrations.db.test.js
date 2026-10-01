import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import knex from 'knex';

// Runs only when TEST_DATABASE_URL points at a disposable PostgreSQL database with
// PostGIS available. WARNING: it rolls back every migration, wiping that database.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('database schema (requires TEST_DATABASE_URL)', () => {
  let db;

  beforeAll(async () => {
    db = knex({
      client: 'pg',
      connection: url,
      migrations: { directory: './migrations', tableName: 'knex_migrations' },
      seeds: { directory: './seeds' },
    });
    await db.migrate.rollback(undefined, true);
  });

  afterAll(async () => {
    if (!db) return;
    await db.migrate.rollback(undefined, true);
    await db.destroy();
  });

  it('applies all migrations with PostGIS available', async () => {
    await db.migrate.latest();
    const { rows } = await db.raw('select postgis_version() as version');
    expect(rows[0].version).toBeTruthy();
  });

  it('seeds reference data idempotently', async () => {
    await db.seed.run();
    await db.seed.run();
    const [{ count }] = await db('categories').count();
    expect(Number(count)).toBe(16);
  });

  it('finds places within a radius using geography', async () => {
    const [category] = await db('categories').where({ slug: 'historical_site' }).select('id');
    const point = (lng, lat) => db.raw('ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography', [lng, lat]);

    await db('places').insert([
      { name: 'Lalbagh Fort', category_id: category.id, location: point(90.3882, 23.7189), status: 'APPROVED' },
      { name: 'Ahsan Manzil', category_id: category.id, location: point(90.4062, 23.7086), status: 'APPROVED' },
      { name: 'Chattogram Place', category_id: category.id, location: point(91.8317, 22.3569), status: 'APPROVED' },
    ]);

    const nearby = await db('places')
      .select('name')
      .whereRaw('ST_DWithin(location, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, ?)', [90.4125, 23.8103, 15_000])
      .orderByRaw('location <-> ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography', [90.4125, 23.8103]);

    // From the centre: Lalbagh ≈ 10.5 km, Ahsan Manzil ≈ 11.3 km, Chattogram ≈ 200 km (excluded).
    expect(nearby.map((p) => p.name)).toEqual(['Lalbagh Fort', 'Ahsan Manzil']);
  });

  it('defaults facility information to UNKNOWN', async () => {
    const place = await db('places').where({ name: 'Lalbagh Fort' }).first();
    expect(place).toMatchObject({ parking_available: 'UNKNOWN', pet_friendly: 'UNKNOWN', wheelchair_accessible: 'UNKNOWN' });
  });

  it('keeps the rating aggregate in sync through the reviews trigger', async () => {
    const place = await db('places').where({ name: 'Lalbagh Fort' }).first();
    const users = await db('users')
      .insert([
        { name: 'A', email: 'a@example.com', password_hash: 'x' },
        { name: 'B', email: 'b@example.com', password_hash: 'x' },
      ])
      .returning('id');

    await db('reviews').insert([
      { user_id: users[0].id, place_id: place.id, rating: 5 },
      { user_id: users[1].id, place_id: place.id, rating: 4 },
    ]);
    let updated = await db('places').where({ id: place.id }).first();
    expect(updated.review_count).toBe(2);
    expect(updated.avg_rating).toBe('4.50');

    // A cascade delete (user removed) must also update the aggregate.
    await db('users').where({ id: users[0].id }).delete();
    updated = await db('places').where({ id: place.id }).first();
    expect(updated.review_count).toBe(1);
    expect(updated.avg_rating).toBe('4.00');
  });

  it('enforces one review per user per place and the rating range', async () => {
    const place = await db('places').where({ name: 'Ahsan Manzil' }).first();
    const [user] = await db('users').insert({ name: 'C', email: 'c@example.com', password_hash: 'x' }).returning('id');

    await expect(db('reviews').insert({ user_id: user.id, place_id: place.id, rating: 6 })).rejects.toMatchObject({ code: '23514' });
    await db('reviews').insert({ user_id: user.id, place_id: place.id, rating: 3 });
    await expect(db('reviews').insert({ user_id: user.id, place_id: place.id, rating: 4 })).rejects.toMatchObject({ code: '23505' });
  });

  it('rolls back every migration cleanly', async () => {
    await db.migrate.rollback(undefined, true);
    const { rows } = await db.raw("select to_regclass('public.places') as places");
    expect(rows[0].places).toBeNull();
  });
});

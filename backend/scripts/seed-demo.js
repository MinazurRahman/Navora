// npm run seed:demo — loads demo places for development. Safe to re-run (updates in place).
// Run `npm run seed` first (categories and tags). Refuses to run in production.
import { createHash } from 'node:crypto';
import { env } from '../src/config/env.js';
import { createDb } from '../src/config/database.js';
import { DEMO_PLACES } from './demo-places.js';

if (env.isProduction) {
  console.error('Refusing to load demo places with NODE_ENV=production.');
  process.exit(1);
}

// Stable ID per place name, so re-running updates instead of duplicating.
function demoId(name) {
  const hex = createHash('sha256').update(`navora-demo:${name}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const db = createDb(env);
try {
  const categories = new Map((await db('categories').select('id', 'slug')).map((c) => [c.slug, c.id]));
  const tags = new Map((await db('tags').select('id', 'slug')).map((t) => [t.slug, t.id]));
  const unknown = DEMO_PLACES.flatMap(([name, category, , , placeTags]) =>
    [category, ...placeTags].filter((slug) => !categories.has(slug) && !tags.has(slug)).map((slug) => `${name}: ${slug}`),
  );
  if (unknown.length > 0) throw new Error(`Unknown category/tag slugs (run npm run seed first?): ${unknown.join(', ')}`);

  await db.transaction(async (trx) => {
    for (const [name, category, latitude, longitude, placeTags, description] of DEMO_PLACES) {
      const id = demoId(name);
      await trx('places')
        .insert({
          id,
          name,
          description,
          category_id: categories.get(category),
          location: trx.raw('ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography', [longitude, latitude]),
          city: 'Dhaka',
          status: 'APPROVED',
        })
        .onConflict('id')
        .merge(['name', 'description', 'category_id', 'location', 'city', 'status']);
      await trx('place_tags').where({ place_id: id }).delete();
      await trx('place_tags').insert(placeTags.map((slug) => ({ place_id: id, tag_id: tags.get(slug) })));
    }
  });
  console.log(`Loaded ${DEMO_PLACES.length} demo places (approved; fees, hours and facilities unknown).`);
} finally {
  await db.destroy();
}

// Reference data. Idempotent: safe to run repeatedly; updates names/descriptions in place.

export const CATEGORIES = [
  ['museum', 'Museum', 'Museums and exhibitions'],
  ['historical_site', 'Historical Site', 'Monuments, forts, heritage buildings and ruins'],
  ['religious_site', 'Religious Site', 'Mosques, temples, churches and other places of worship'],
  ['park', 'Park', 'Parks, gardens and green spaces'],
  ['lake_or_river', 'Lake or River', 'Lakes, riversides and waterfronts'],
  ['viewpoint', 'Viewpoint', 'Scenic viewpoints and observation spots'],
  ['restaurant', 'Restaurant', 'Sit-down restaurants'],
  ['cafe', 'Cafe', 'Cafes, tea stalls and coffee shops'],
  ['street_food', 'Street Food', 'Street food stalls and food streets'],
  ['market', 'Market', 'Bazaars and traditional markets'],
  ['shopping_mall', 'Shopping Mall', 'Shopping centres and malls'],
  ['art_gallery', 'Art Gallery', 'Art galleries and studios'],
  ['cultural_center', 'Cultural Center', 'Cultural centres, theatres and performance venues'],
  ['library', 'Library', 'Public and university libraries'],
  ['zoo', 'Zoo', 'Zoos, aquariums and safari parks'],
  ['amusement_park', 'Amusement Park', 'Amusement and theme parks'],
];

export const TAGS = [
  ['history', 'History'],
  ['food', 'Food'],
  ['nature', 'Nature'],
  ['photography', 'Photography'],
  ['architecture', 'Architecture'],
  ['art', 'Art'],
  ['culture', 'Culture'],
  ['shopping', 'Shopping'],
  ['religion', 'Religion'],
  ['family', 'Family'],
  ['nightlife', 'Nightlife'],
  ['adventure', 'Adventure'],
  ['relaxation', 'Relaxation'],
  ['local_experience', 'Local Experience'],
];

export async function seed(knex) {
  await knex('categories')
    .insert(CATEGORIES.map(([slug, name, description]) => ({ slug, name, description })))
    .onConflict('slug')
    .merge(['name', 'description']);

  await knex('tags')
    .insert(TAGS.map(([slug, name]) => ({ slug, name })))
    .onConflict('slug')
    .merge(['name']);
}

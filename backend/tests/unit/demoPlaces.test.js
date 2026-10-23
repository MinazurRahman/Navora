import { describe, expect, it } from 'vitest';
import { DEMO_PLACES } from '../../scripts/demo-places.js';
import { DEMO_PLACE_IMAGES } from '../../scripts/demo-place-images.js';
import { CATEGORIES, TAGS } from '../../seeds/01_categories_tags.js';

// The demo data is hand-curated; catch typos before they reach a database.
describe('demo places', () => {
  const categories = new Set(CATEGORIES.map(([slug]) => slug));
  const tags = new Set(TAGS.map(([slug]) => slug));

  it('uses known categories and tags, plausible coordinates, unique names and real descriptions', () => {
    const names = new Set();
    for (const [name, category, latitude, longitude, placeTags, description] of DEMO_PLACES) {
      expect(names.has(name), name).toBe(false);
      names.add(name);
      expect(categories.has(category), `${name}: ${category}`).toBe(true);
      for (const tag of placeTags) expect(tags.has(tag), `${name}: ${tag}`).toBe(true);
      // Dhaka Division, roughly: the demo places are all within a day trip of the city.
      expect(latitude, name).toBeGreaterThan(23.3);
      expect(latitude, name).toBeLessThan(24.3);
      expect(longitude, name).toBeGreaterThan(90.2);
      expect(longitude, name).toBeLessThan(90.7);
      expect(description.length, name).toBeGreaterThanOrEqual(80);
      expect(description.length, name).toBeLessThanOrEqual(5000);
    }
  });

  it('gives every photo a credited https source, and only for demo places', () => {
    const names = new Set(DEMO_PLACES.map(([name]) => name));
    for (const [name, images] of Object.entries(DEMO_PLACE_IMAGES)) {
      expect(names.has(name), name).toBe(true);
      expect(images.length, name).toBeGreaterThan(0);
      for (const image of images) {
        expect(image.url, name).toMatch(/^https:\/\//);
        expect(image.thumbUrl, name).toMatch(/^https:\/\//);
        expect(image.sourceUrl, name).toMatch(/^https:\/\//);
        expect(image.author, name).not.toMatch(/machine-readable|^User:/);
        expect(image.license, name).toMatch(/^(CC|Public domain|PD)/i);
      }
      expect(new Set(images.map((i) => i.url)).size, `${name}: duplicate photo`).toBe(images.length);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

// Database-free sanity checks; the real schema is exercised in tests/integration.
const migrationsDir = fileURLToPath(new URL('../../migrations/', import.meta.url));
const files = readdirSync(migrationsDir).filter((file) => file.endsWith('.js')).sort();

describe('migration files', () => {
  it('exist and use the timestamped naming convention', () => {
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) expect(file).toMatch(/^\d{14}_[a-z0-9_]+\.js$/);
  });

  it.each(files)('%s is a valid ESM module exporting up() and down()', async (file) => {
    const migration = await import(pathToFileURL(path.join(migrationsDir, file)).href);
    expect(typeof migration.up).toBe('function');
    expect(typeof migration.down).toBe('function');
  });
});

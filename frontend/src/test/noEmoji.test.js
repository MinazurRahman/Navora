import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Product rule: no emoji anywhere in the UI or its source (use lucide-react SVG icons instead).
const EMOJI = /\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]|\u{FE0F}/u;
const ROOTS = [join(import.meta.dirname, '..'), join(import.meta.dirname, '../../index.html')];

function sourceFiles(path) {
  if (/\.(jsx?|css|html|svg|json)$/.test(path)) return [path];
  try {
    return readdirSync(path, { withFileTypes: true }).flatMap((entry) => sourceFiles(join(path, entry.name)));
  } catch {
    return [];
  }
}

describe('no emoji', () => {
  it('appears in any frontend source file', () => {
    const offenders = ROOTS.flatMap(sourceFiles).filter((file) => EMOJI.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

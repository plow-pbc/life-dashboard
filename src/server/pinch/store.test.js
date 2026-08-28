import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { JsonStore } from './store.js';

// A string `lib` is written verbatim, so a malformed file is expressible as a
// fixture; anything else is serialized.
function storeWith(lib) {
  const dir = mkdtempSync(join(tmpdir(), 'pinch-store-'));
  const filePath = join(dir, 'collection.json');
  if (lib !== undefined) {
    writeFileSync(filePath, typeof lib === 'string' ? lib : JSON.stringify(lib), 'utf8');
  }
  return new JsonStore(filePath);
}

describe('JsonStore', () => {
  it('reads the recipe library', () => {
    const s = storeWith({ recipes: [{ id: 'a', title: 'Soup' }], categories: [{ id: 'c' }] });
    expect(s.read()).toEqual({ recipes: [{ id: 'a', title: 'Soup' }] });
  });

  it.each([
    ['an absent file', undefined],
    ['a non-array recipes field', { recipes: 'nope' }],
    ['an empty object', {}],
  ])('reads empty on %s', (_label, lib) => {
    expect(storeWith(lib).read()).toEqual({ recipes: [] });
  });

  // REVIEW.md's operating point prefers a loud failure to a fallback: absence is
  // the ordinary pre-sync state, anything else is a fault worth surfacing.
  it.each([
    ['a truncated file', '{"recipes": ['],
    ['a file of garbage', 'not json at all'],
  ])('throws on %s rather than reading empty', (_label, lib) => {
    expect(() => storeWith(lib).read()).toThrow();
  });
});

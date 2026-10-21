import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { JsonStore, readTonightPin, todayLocalYMD } from './store.js';

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
  it('reads the recipe library (dropping unknown top-level keys, tonightRecipeId null)', () => {
    const s = storeWith({ recipes: [{ id: 'a', title: 'Soup' }], categories: [{ id: 'c' }] });
    expect(s.read()).toEqual({ recipes: [{ id: 'a', title: 'Soup' }], tonightRecipeId: null });
  });

  it('preserves a top-level tonightRecipeId (Pinch meal-plan pick)', () => {
    const s = storeWith({ recipes: [{ id: 'a', title: 'Soup' }], tonightRecipeId: 'a' });
    expect(s.read()).toEqual({ recipes: [{ id: 'a', title: 'Soup' }], tonightRecipeId: 'a' });
  });

  it.each([
    ['an absent file', undefined],
    ['a non-array recipes field', { recipes: 'nope' }],
    ['an empty object', {}],
    ['a null tonightRecipeId', { recipes: [], tonightRecipeId: null }],
    ['a non-string tonightRecipeId', { recipes: [], tonightRecipeId: 123 }],
  ])('reads empty (recipes:[], tonightRecipeId:null) on %s', (_label, lib) => {
    expect(storeWith(lib).read()).toEqual({ recipes: [], tonightRecipeId: null });
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

// The pin reader deliberately diverges from JsonStore's fail-loud stance: the pin
// is a non-critical overlay, so a broken pin file must degrade to "no pin" rather
// than throw and take down the recipe tile.
function pinFileWith(contents) {
  const dir = mkdtempSync(join(tmpdir(), 'pinch-pin-'));
  const filePath = join(dir, 'tonight.json');
  if (contents !== undefined) {
    writeFileSync(filePath, typeof contents === 'string' ? contents : JSON.stringify(contents), 'utf8');
  }
  return filePath;
}

const TODAY = '2026-10-20';

describe('readTonightPin', () => {
  it('returns the pinned recipe id when no date is set (always-on, back-compat)', () => {
    expect(readTonightPin(pinFileWith({ recipeId: 'recipe-1' }), TODAY)).toBe('recipe-1');
  });

  it('trims surrounding whitespace', () => {
    expect(readTonightPin(pinFileWith({ recipeId: '  abc  ' }), TODAY)).toBe('abc');
  });

  it.each([
    ['an absent file (nothing pinned)', undefined],
    ['an explicit null recipeId', { recipeId: null }],
    ['an empty object', {}],
    ['a non-string recipeId', { recipeId: 123 }],
    ['a blank recipeId', { recipeId: '   ' }],
  ])('returns null on %s', (_label, contents) => {
    expect(readTonightPin(pinFileWith(contents), TODAY)).toBeNull();
  });

  // A malformed overlay must NOT throw (unlike the library read) — it degrades to
  // no pin so the recipe tile keeps rendering its fallback.
  it.each([
    ['truncated json', '{"recipeId": '],
    ['garbage', 'not json at all'],
  ])('returns null (does not throw) on %s', (_label, raw) => {
    expect(readTonightPin(pinFileWith(raw), TODAY)).toBeNull();
  });

  // Auto-expiry: a dated pin applies only on its own household-local day.
  it('applies a dated pin when date === today', () => {
    expect(readTonightPin(pinFileWith({ recipeId: 'abc', date: TODAY }), TODAY)).toBe('abc');
  });

  it.each([
    ['yesterday (expired)', '2026-10-19'],
    ['tomorrow (not yet)', '2026-10-21'],
    ['a malformed date string', 'tonight'],
    ['an empty date string', ''],
    ['a non-string date', 20261020],
  ])('ignores a dated pin on %s (fails closed, no lingering)', (_label, date) => {
    expect(readTonightPin(pinFileWith({ recipeId: 'abc', date }), TODAY)).toBeNull();
  });

  it('treats a null date as always-on (same as absent)', () => {
    expect(readTonightPin(pinFileWith({ recipeId: 'abc', date: null }), TODAY)).toBe('abc');
  });
});

describe('todayLocalYMD', () => {
  it('formats a local date as zero-padded YYYY-MM-DD', () => {
    // Construct via local components so the assertion is timezone-independent.
    expect(todayLocalYMD(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(todayLocalYMD(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});

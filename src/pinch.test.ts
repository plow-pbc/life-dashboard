import { describe, it, expect } from 'vitest';
import { isLocalPhotoUrl, pickTonight, type Collection } from './pinch';

const soup = { id: 'a', title: 'Soup' };
const stew = { id: 'b', title: 'Stew', lastOpenedAt: '2026-08-01T00:00:00Z' };
const pie = { id: 'c', title: 'Pie', lastOpenedAt: '2026-08-09T00:00:00Z' };
// Cooked-but-never-opened recipes, for the tertiary lastCookedAt fallback.
const roast = { id: 'roast', title: 'Roast', lastCookedAt: '2026-07-01T00:00:00Z' };
const chili = { id: 'chili', title: 'Chili', lastCookedAt: '2026-07-20T00:00:00Z' };

describe('pickTonight', () => {
  // Fallback (nothing planned): newest lastOpenedAt, else anything.
  it.each([
    ['the most recently opened', { recipes: [soup, stew, pie] }, 'Pie', 'Recently opened'],
    ['order does not matter', { recipes: [pie, stew] }, 'Pie', 'Recently opened'],
    ['anything at all when none was opened', { recipes: [soup] }, 'Soup', 'From your library'],
  ] as [string, Collection, string, string][])('picks %s', (_label, collection, title, meta) => {
    const pick = pickTonight(collection);
    expect(pick?.recipe.title).toBe(title);
    expect(pick?.meta).toBe(meta);
  });

  it('returns null for an empty library so the tile can render nothing', () => {
    expect(pickTonight({ recipes: [] })).toBeNull();
  });

  // Comparison is lexical, so a value that is not a real timestamp would sort
  // above every real one and silently win the "Recently opened" slot.
  it.each([
    ['null', null],
    ['a non-timestamp string', 'yesterday'],
    ['an empty string', ''],
  ])('ignores %s in lastOpenedAt rather than ranking on it', (_label, lastOpenedAt) => {
    const bad = { id: 'd', title: 'Bad', lastOpenedAt };
    expect(pickTonight({ recipes: [bad] })?.meta).toBe('From your library');
  });

  it('does not let a malformed value outrank a real timestamp', () => {
    const junk = { id: 'e', title: 'Junk', lastOpenedAt: 'yesterday' };
    expect(pickTonight({ recipes: [junk, pie] })?.recipe.title).toBe('Pie');
  });

  // Precedence: Hive pin (pinnedRecipeId) > Pinch plan (tonightRecipeId) > fallback.
  it('shows Pinch meal-plan (tonightRecipeId) as Cook Tonight, over the fallback', () => {
    const pick = pickTonight({ recipes: [soup, stew, pie], tonightRecipeId: 'a' });
    expect(pick?.recipe.title).toBe('Soup'); // not the most-recently-opened Pie
    expect(pick?.meta).toBe('Cook Tonight');
  });

  it("Hive's explicit pin overrides both the meal plan and the fallback", () => {
    const pick = pickTonight({ recipes: [soup, stew, pie], tonightRecipeId: 'b', pinnedRecipeId: 'a' });
    expect(pick?.recipe.title).toBe('Soup'); // pin 'a' beats plan 'b' and recency
    expect(pick?.meta).toBe('Cook Tonight');
  });

  it('falls through a stale pin to the meal plan', () => {
    const pick = pickTonight({ recipes: [stew, pie], tonightRecipeId: 'b', pinnedRecipeId: 'zzz' });
    expect(pick?.recipe.title).toBe('Stew'); // stale pin ignored, plan 'b' wins
    expect(pick?.meta).toBe('Cook Tonight');
  });

  it.each([
    ['a non-matching plan (stale/deleted)', 'zzz'],
    ['a null plan', null],
    ['an absent plan', undefined],
  ])('falls back to newest-opened on %s', (_label, tonightRecipeId) => {
    const pick = pickTonight({ recipes: [stew, pie], tonightRecipeId });
    expect(pick?.recipe.title).toBe('Pie'); // newest lastOpenedAt
    expect(pick?.meta).toBe('Recently opened');
  });

  // Tertiary: when lastOpenedAt is unpopulated (the current live state), keep the
  // meaningful recently-cooked default instead of dropping to an arbitrary recipes[0].
  it('falls back to newest lastCookedAt when no lastOpenedAt is populated', () => {
    const pick = pickTonight({ recipes: [soup, roast, chili] });
    expect(pick?.recipe.title).toBe('Chili'); // newest lastCookedAt
    expect(pick?.meta).toBe('Recently cooked');
  });

  it('prefers lastOpenedAt over lastCookedAt when both are present', () => {
    const pick = pickTonight({ recipes: [chili, pie] }); // pie opened, chili cooked
    expect(pick?.recipe.title).toBe('Pie');
    expect(pick?.meta).toBe('Recently opened');
  });

  it('falls back to the first recipe only when no timestamp is present at all', () => {
    const pick = pickTonight({ recipes: [soup, { id: 'z', title: 'Zuppa' }] });
    expect(pick?.recipe.title).toBe('Soup');
    expect(pick?.meta).toBe('From your library');
  });
});

describe('isLocalPhotoUrl', () => {
  // The sync returns Paprika's own URL verbatim when it is publicly fetchable,
  // so a web-imported recipe can carry a remote one — rendering that would make
  // the kiosk beacon a third party on every reload.
  // Annotated: without it vitest infers the rows loosely enough that a wrong
  // column type (a number where the url goes) type-checks clean.
  it.each<[string, string | null, boolean]>([
    ['our own route', '/api/pinch/photos/ABC-123_x', true],
    ['an https url', 'https://evil.example/p.jpg', false],
    ['a scheme-relative url', '//evil.example/p.jpg', false],
    ['a traversal payload under our prefix', '/api/pinch/photos/../../etc/passwd', false],
    ['a route with a query tacked on', '/api/pinch/photos/abc?x=1', false],
    ['an empty string', '', false],
    ['null', null, false],
  ])('%s', (_label, url, expected) => {
    expect(isLocalPhotoUrl(url)).toBe(expected);
  });
});

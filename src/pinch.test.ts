import { describe, it, expect } from 'vitest';
import {
  embedSrc,
  hasDinnerTonight,
  isLocalPhotoUrl,
  isMenuStale,
  MENU_STALE_MS,
  pickTonight,
  type Collection,
  type PlanEntry,
} from './pinch';

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
  it('shows Pinch meal-plan (tonightRecipeId) as Tonight, over the fallback', () => {
    const pick = pickTonight({ recipes: [soup, stew, pie], tonightRecipeId: 'a' });
    expect(pick?.recipe.title).toBe('Soup'); // not the most-recently-opened Pie
    expect(pick?.meta).toBe('Tonight');
  });

  it("Hive's explicit pin overrides both the meal plan and the fallback", () => {
    const pick = pickTonight({
      recipes: [soup, stew, pie],
      tonightRecipeId: 'b',
      pinnedRecipeId: 'a',
    });
    expect(pick?.recipe.title).toBe('Soup'); // pin 'a' beats plan 'b' and recency
    expect(pick?.meta).toBe('Tonight');
  });

  it('falls through a stale pin to the meal plan', () => {
    const pick = pickTonight({ recipes: [stew, pie], tonightRecipeId: 'b', pinnedRecipeId: 'zzz' });
    expect(pick?.recipe.title).toBe('Stew'); // stale pin ignored, plan 'b' wins
    expect(pick?.meta).toBe('Tonight');
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

describe('isMenuStale', () => {
  const NOW = new Date('2026-10-29T12:00:00Z');
  const at = (msAgo: number) => new Date(NOW.getTime() - msAgo).toISOString();

  it('is fresh just under the threshold', () => {
    expect(isMenuStale(at(MENU_STALE_MS - 60_000), NOW)).toBe(false);
  });

  it('is still fresh exactly at the threshold (exclusive boundary)', () => {
    expect(isMenuStale(at(MENU_STALE_MS), NOW)).toBe(false);
  });

  it('is stale just past the threshold', () => {
    expect(isMenuStale(at(MENU_STALE_MS + 60_000), NOW)).toBe(true);
  });

  it('treats a many-days-old snapshot as stale', () => {
    expect(isMenuStale('2026-10-21T09:56:00Z', NOW)).toBe(true);
  });

  it('does not claim staleness without a usable timestamp', () => {
    // Absence of a freshness signal is not a staleness claim — the tile keeps
    // its normal captions rather than asserting a date it doesn't have.
    expect(isMenuStale(null, NOW)).toBe(false);
    expect(isMenuStale(undefined, NOW)).toBe(false);
    expect(isMenuStale('not-a-date', NOW)).toBe(false);
  });
});

describe('embedSrc', () => {
  const O = 'https://pinch.example.com';
  const T = 'ro%2Dtok'; // already percent-encoded by the server; appended verbatim

  it('is the base library URL with no recipe', () => {
    expect(embedSrc(O, T)).toBe('https://pinch.example.com/embed?token=ro%2Dtok');
    expect(embedSrc(O, T, null)).toBe('https://pinch.example.com/embed?token=ro%2Dtok');
    expect(embedSrc(O, T, '')).toBe('https://pinch.example.com/embed?token=ro%2Dtok');
  });

  it('appends a one-time &recipe= deep-link when a recipe id is given', () => {
    expect(embedSrc(O, T, '0A1B2C3D-4E5F-6789-ABCD-EF0123456789')).toBe(
      'https://pinch.example.com/embed?token=ro%2Dtok&recipe=0A1B2C3D-4E5F-6789-ABCD-EF0123456789',
    );
  });

  it('url-encodes the recipe id (any unsafe char) without touching the token', () => {
    expect(embedSrc(O, T, 'a b/c')).toBe(
      'https://pinch.example.com/embed?token=ro%2Dtok&recipe=a%20b%2Fc',
    );
  });
});

describe('pickTonight with a meal plan', () => {
  // Wednesday 2026-11-11, 4pm.
  const wed4pm = new Date(2026, 10, 11, 16, 0);
  const at = (date: string, slot: PlanEntry['slot'], recipeId: string): PlanEntry => ({
    date,
    slot,
    recipeId,
  });

  it("shows tonight's planned dinner as Tonight, ahead of an earlier meal today", () => {
    const plan = [at('2026-11-11', 'snack', 'b'), at('2026-11-11', 'dinner', 'a')];
    expect(pickTonight({ recipes: [soup, stew, pie], plan }, new Date(2026, 10, 11, 9))).toEqual({
      recipe: soup,
      meta: 'Tonight',
    });
  });

  it('else shows the next planned meal with its day and slot', () => {
    const plan = [at('2026-11-13', 'dinner', 'b'), at('2026-11-12', 'dinner', 'a')];
    expect(pickTonight({ recipes: [soup, stew, pie], plan }, wed4pm)).toEqual({
      recipe: soup,
      meta: 'Thu dinner',
    });
  });

  it('labels a later meal today, and skips one that is already over', () => {
    const plan = [at('2026-11-11', 'lunch', 'a'), at('2026-11-11', 'snack', 'b')];
    // lunch is over at 4pm; the snack is still to come until 5pm
    expect(pickTonight({ recipes: [soup, stew, pie], plan }, wed4pm)).toEqual({
      recipe: stew,
      meta: 'Snack today',
    });
  });

  it('moves on once tonight’s dinner is over', () => {
    const plan = [at('2026-11-11', 'dinner', 'a'), at('2026-11-12', 'lunch', 'b')];
    expect(
      pickTonight({ recipes: [soup, stew, pie], plan }, new Date(2026, 10, 11, 21, 30))?.meta,
    ).toBe('Thu lunch');
  });

  it('skips planned recipes missing from the library, then falls back to recency', () => {
    const plan = [at('2026-11-12', 'dinner', 'gone')];
    expect(pickTonight({ recipes: [stew, pie], plan }, wed4pm)?.meta).toBe('Recently opened');
  });

  it("keeps Hive's pin and Pinch's tonight pick ahead of the plan", () => {
    const plan = [at('2026-11-12', 'dinner', 'a')];
    expect(pickTonight({ recipes: [soup, stew], plan, pinnedRecipeId: 'b' }, wed4pm)?.recipe).toBe(
      stew,
    );
    expect(pickTonight({ recipes: [soup, stew], plan, tonightRecipeId: 'b' }, wed4pm)?.recipe).toBe(
      stew,
    );
  });

  it('an empty plan keeps the old behaviour', () => {
    expect(pickTonight({ recipes: [stew, pie], plan: [] }, wed4pm)?.meta).toBe('Recently opened');
  });
});

describe('hasDinnerTonight', () => {
  const wed6pm = new Date(2026, 10, 11, 18, 0);
  const fresh = new Date(2026, 10, 11, 17, 0).toISOString();
  const dinner = { date: '2026-11-11', slot: 'dinner' as const, recipeId: 'a' };

  it.each<[string, Collection | null, boolean]>([
    ['a planned dinner today', { recipes: [soup], plan: [dinner], generatedAt: fresh }, true],
    ["Hive's pin", { recipes: [soup], pinnedRecipeId: 'a', generatedAt: fresh }, true],
    ['only a recently opened recipe', { recipes: [stew], generatedAt: fresh }, false],
    [
      "only tomorrow's dinner",
      { recipes: [soup], plan: [{ ...dinner, date: '2026-11-12' }], generatedAt: fresh },
      false,
    ],
    [
      'a stale library',
      { recipes: [soup], plan: [dinner], generatedAt: '2026-11-01T00:00:00Z' },
      false,
    ],
    ['no library', null, false],
  ])('%s → %s', (_label, collection, expected) => {
    expect(hasDinnerTonight(collection, wed6pm)).toBe(expected);
  });
});

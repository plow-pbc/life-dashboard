import { describe, it, expect } from 'vitest';
import { cookRecipeId, isCookUrl, isLocalPhotoUrl, pickTonight, type Collection } from './pinch';

const soup = { id: 'a', title: 'Soup' };
const stew = { id: 'b', title: 'Stew', lastCookedAt: '2026-08-01T00:00:00Z' };
const pie = { id: 'c', title: 'Pie', lastCookedAt: '2026-08-09T00:00:00Z' };

describe('pickTonight', () => {
  it.each([
    ['the most recent cook', { recipes: [soup, stew, pie] }, 'Pie', 'Recently cooked'],
    ['recency does not depend on array order', { recipes: [pie, stew] }, 'Pie', 'Recently cooked'],
    ['anything at all when none was cooked', { recipes: [soup] }, 'Soup', 'From your library'],
  ] as [string, Collection, string, string][])('picks %s', (_label, collection, title, meta) => {
    const pick = pickTonight(collection);
    expect(pick?.recipe.title).toBe(title);
    expect(pick?.meta).toBe(meta);
  });

  it('returns null for an empty library so the tile can render nothing', () => {
    expect(pickTonight({ recipes: [] })).toBeNull();
  });

  // Comparison is lexical, so a value that is not a real timestamp would sort
  // above every real one and silently win the "Recently cooked" slot.
  it.each([
    ['null', null],
    ['a non-timestamp string', 'yesterday'],
    ['an empty string', ''],
  ])('ignores %s in lastCookedAt rather than ranking on it', (_label, lastCookedAt) => {
    const bad = { id: 'd', title: 'Bad', lastCookedAt };
    expect(pickTonight({ recipes: [bad] })?.meta).toBe('From your library');
  });

  it('does not let a malformed value outrank a real timestamp', () => {
    const junk = { id: 'e', title: 'Junk', lastCookedAt: 'yesterday' };
    expect(pickTonight({ recipes: [junk, pie] })?.recipe.title).toBe('Pie');
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

describe('isCookUrl', () => {
  // The tile navigates the top-level document to this value on tap, so only an
  // absolute http(s) URL is tappable — a script/data scheme or a relative value
  // is rejected and the tile falls back to not-tappable. Host/path are not
  // pinned so the Pinch backend can move (preview → prod).
  it.each<[string, string | null | undefined, boolean]>([
    ['the live cookUrl shape', 'https://pinch-mt-preview.vercel.app/cook/80c34dfe-92cd-47a7-b7b4-3379f669d244', true],
    ['a prod https backend', 'https://pinch.app/cook/abc', true],
    ['a local http backend', 'http://localhost:3000/cook/abc', true],
    ['a javascript: scheme', 'javascript:alert(1)', false],
    ['a data: scheme', 'data:text/html,<script>1</script>', false],
    ['a relative url', '/cook/abc', false],
    ['a scheme-relative url', '//pinch.app/cook/abc', false],
    ['an empty string', '', false],
    ['null', null, false],
    ['undefined', undefined, false],
  ])('%s', (_label, url, expected) => {
    expect(isCookUrl(url)).toBe(expected);
  });
});

describe('cookRecipeId', () => {
  // Only the opaque "/cook/<id>" id is taken — the Meals tab joins it to the
  // CONFIGURED Pinch origin, never this cookUrl's host (which may differ from
  // PINCH_BACKEND_URL and would be blocked by the CSP frame-src).
  it.each<[string, string | null | undefined, string | null]>([
    ['the live cookUrl shape', 'https://pinch-mt-preview.vercel.app/cook/80c34dfe-92cd-47a7-b7b4-3379f669d244', '80c34dfe-92cd-47a7-b7b4-3379f669d244'],
    ['a different host (host is ignored)', 'https://other.example.com/cook/abc-123', 'abc-123'],
    ['a trailing slash', 'https://pinch.app/cook/abc/', 'abc'],
    ['not a /cook/ path', 'https://pinch.app/recipe/abc', null],
    ['a deeper path under cook', 'https://pinch.app/cook/abc/steps', null],
    ['a non-url', 'javascript:alert(1)', null],
    ['empty', '', null],
    ['null', null, null],
    ['undefined', undefined, null],
  ])('%s', (_label, url, expected) => {
    expect(cookRecipeId(url)).toBe(expected);
  });
});

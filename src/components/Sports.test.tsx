import { describe, it, expect } from 'vitest';
import { paginateGames } from './paginateGames';

// The tile shows up to three games per page. A breadcrumb dot is rendered per
// page, so the page count IS the dot count — and dots only show when there's
// more than one page (>3 games). These assert that math; the swipe itself is
// native scroll-snap (no logic to unit-test).
describe('paginateGames (3 per page → one dot per page)', () => {
  it('keeps ≤3 games on a single page (no breadcrumb, no swipe)', () => {
    for (const n of [0, 1, 2, 3]) {
      const pages = paginateGames(Array.from({ length: n }, (_, i) => i));
      // 0 games has no page to show (the tile renders "No upcoming games");
      // 1–3 games is exactly one page.
      expect(pages.length).toBe(n === 0 ? 0 : 1);
      expect(pages.length > 1).toBe(false); // → no dots
    }
  });

  it('splits >3 games into 3-per-page pages, one dot each', () => {
    expect(paginateGames([1, 2, 3, 4]).length).toBe(2);
    expect(paginateGames([1, 2, 3, 4, 5, 6]).length).toBe(2);
    expect(paginateGames([1, 2, 3, 4, 5, 6, 7]).length).toBe(3);
    expect(paginateGames(Array.from({ length: 9 }, (_, i) => i)).length).toBe(3);
  });

  it('chunks in order, last page holding the remainder', () => {
    expect(paginateGames([1, 2, 3, 4, 5])).toEqual([
      [1, 2, 3],
      [4, 5],
    ]);
  });
});

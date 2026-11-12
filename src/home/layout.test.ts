import { describe, it, expect } from 'vitest';
import { GRID_COLS, GRID_ROWS, SLOTS, SLOT_CANDIDATES, assignSlots } from './layout';

describe('Home grid', () => {
  it('tiles the 4×6 grid exactly: every cell in one slot, none outside it', () => {
    const owner = new Map<string, string>();
    for (const [id, s] of Object.entries(SLOTS)) {
      for (let r = s.row; r < s.row + s.rows; r++) {
        for (let c = s.col; c < s.col + s.cols; c++) {
          expect(r <= GRID_ROWS && c <= GRID_COLS, `${id} spills off the grid`).toBe(true);
          expect(owner.get(`${r},${c}`), `${id} overlaps`).toBeUndefined();
          owner.set(`${r},${c}`, id);
        }
      }
    }
    expect(owner.size).toBe(GRID_COLS * GRID_ROWS);
  });

  it.each(SLOT_CANDIDATES)('hero=%s: hero leaves the side slots, photos stays last', (hero) => {
    const a = assignSlots(hero);
    const side = [a.m1, a.m2, a.m3];
    expect(a.hero).toBe(hero);
    expect(side).not.toContain(hero);
    expect(new Set([hero, ...side])).toEqual(new Set(SLOT_CANDIDATES));
    if (hero !== 'photos') expect(a.m3).toBe('photos');
  });
});

// The Home grid: 4 columns × 6 rows, every slot a whole number of units. The
// slots are fixed; only which widget fills each one changes. The hero is always
// 4×2 — a moment picks what fills it, never its size.

export type SlotId = 'head' | 'hero' | 'cal' | 'm1' | 'm2' | 'm3';

/** Grid placement in units: 1-based column/row of the top-left cell, plus span. */
export type SlotGeom = { col: number; row: number; cols: number; rows: number };

export const GRID_COLS = 4;
export const GRID_ROWS = 6;

export const SLOTS: Record<SlotId, SlotGeom> = {
  head: { col: 1, row: 1, cols: 4, rows: 1 },
  hero: { col: 1, row: 2, cols: 4, rows: 2 },
  cal: { col: 1, row: 4, cols: 2, rows: 3 },
  m1: { col: 3, row: 4, cols: 2, rows: 1 },
  m2: { col: 3, row: 5, cols: 2, rows: 1 },
  m3: { col: 3, row: 6, cols: 2, rows: 1 },
};

/** Widgets that can fill the hero or a 2×1 side slot, highest priority first.
 *  Photos is last on purpose: it always takes the final side slot. */
export const SLOT_CANDIDATES = ['cooking', 'sports', 'weather', 'photos'] as const;
export type SlotWidget = (typeof SLOT_CANDIDATES)[number];

export type WidgetId = 'header' | 'calendar' | SlotWidget;

/** Which widget fills each slot, given the one in the hero. The hero's widget
 *  leaves the side slots; the other three fill m1–m3 in priority order. */
export function assignSlots(hero: SlotWidget): Record<SlotId, WidgetId> {
  const [m1, m2, m3] = SLOT_CANDIDATES.filter((w) => w !== hero);
  return { head: 'header', hero, cal: 'calendar', m1, m2, m3 };
}

/** CSS grid-area for a slot. */
export function gridArea({ col, row, cols, rows }: SlotGeom): string {
  return `${row} / ${col} / span ${rows} / span ${cols}`;
}

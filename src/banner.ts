// Pure index logic for the Photo/Banner tile — kept out of the component so it's unit-testable.
// The tile shows one image at a time; a horizontal SWIPE steps through the list (no visible UI).

// Hourly auto-rotation: the kiosk reloads the whole page every REFRESH_MS (~5 min), so a
// setInterval never advances. Index by the wall-clock hour instead — every reload within an
// hour shows the same image, and successive hours cycle deterministically. This is also the
// BASELINE the local swipe index starts from on each page load.
export const BANNER_ROTATE_MS = 60 * 60 * 1000;

export function hourlyIndex(count: number, now: number = Date.now()): number {
  return Math.floor(now / BANNER_ROTATE_MS) % count;
}

// Wrap-around step. dir +1 = next image, -1 = previous.
export function stepIndex(i: number, count: number, dir: 1 | -1): number {
  return (((i + dir) % count) + count) % count;
}

// Label for the empty-banner placeholder: the full English date from `now`,
// fully uppercased (e.g. "OCTOBER 17, 2026"). The household name is deliberately
// NOT shown — nothing on the wall identifies the family. Pure so the dynamic
// date formatting is unit-testable under the pinned TZ.
export function placeholderLabel(now: Date = new Date()): string {
  const date = now.toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  return date.toUpperCase();
}

// Classify a pointer/touch gesture from its delta. swipe LEFT (dx < 0) → next (+1), swipe
// RIGHT (dx > 0) → previous (-1); returns 0 (ignore) when the move is too small or mostly
// vertical. Threshold ~45px keeps a tap or a vertical drag from changing the photo.
export function swipeDir(dx: number, dy: number, threshold = 45): 1 | -1 | 0 {
  if (Math.abs(dx) < threshold) return 0; // too small (e.g. a tap)
  if (Math.abs(dx) <= Math.abs(dy)) return 0; // mostly vertical → not a horizontal swipe
  return dx < 0 ? 1 : -1;
}

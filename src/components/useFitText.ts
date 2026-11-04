import { useLayoutEffect, useRef } from 'react';

/**
 * Auto-fit a text element to its (bounded) box: pick the LARGEST font size, from
 * a ceiling down to a legible floor, at which the content still fits without
 * overflowing. Short lines render big so the tile never looks lost; long ones
 * shrink toward the floor. The element must be a height-bounded flex child
 * (flex:1; min-height:0; overflow:hidden) so clientHeight is the box and
 * scrollHeight is the content.
 *
 * It re-fits whenever the text changes or the box resizes (ResizeObserver), so
 * it stays correct across kiosk sizes. The floor is the legibility guarantee: if
 * even the floor overflows, the size stays at the floor (it does not go smaller),
 * and the box clips — that is the signal the cell is too small for the text, not
 * something to paper over with an illegible size.
 */
export function useFitText(
  dep: string | undefined,
  { min = 20, max = 34, step = 1 }: { min?: number; max?: number; step?: number } = {},
) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const fit = () => {
      // Largest size in [min, max] whose content fits the bounded box. Start at
      // the ceiling and step down; the first that fits wins. Always leave the
      // floor applied if nothing fits (legibility over no-clip).
      let chosen = min;
      for (let size = max; size >= min; size -= step) {
        el.style.fontSize = `${size}px`;
        if (el.scrollHeight <= el.clientHeight) {
          chosen = size;
          break;
        }
      }
      el.style.fontSize = `${chosen}px`;
    };

    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [dep, min, max, step]);

  return ref;
}

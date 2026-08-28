import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { hourlyIndex, stepIndex, swipeDir } from '../banner';

export function Banner() {
  const [banners, setBanners] = useState<string[]>([]);
  // Local displayed index. Initialized to the hourly auto-rotation baseline once the list
  // loads (and re-based if the count changes); a horizontal swipe steps it. Resets to the
  // hourly index on each page reload (the kiosk reloads every ~5 min) — that's fine.
  const [index, setIndex] = useState(0);
  const down = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('api/banners');
        if (!res.ok) return;
        const body = (await res.json()) as { banners: string[] };
        if (!cancelled) setBanners(body.banners);
      } catch {
        // Empty list collapses the row; the rest of the dashboard still loads.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Base the starting photo on the hourly rotation whenever the count changes
  // (the list is fetched once on mount, so count is the only thing that varies).
  useEffect(() => {
    if (banners.length > 0) setIndex(hourlyIndex(banners.length));
  }, [banners.length]);

  if (banners.length === 0) return null;

  const onPointerDown = (e: ReactPointerEvent<HTMLImageElement>) => {
    down.current = { x: e.clientX, y: e.clientY };
    // Capture so we still get pointerup even if the finger/cursor drifts off the image.
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLImageElement>) => {
    const start = down.current;
    down.current = null;
    if (!start) return;
    const dir = swipeDir(e.clientX - start.x, e.clientY - start.y);
    if (dir !== 0) setIndex((i) => stepIndex(i, banners.length, dir));
  };

  return (
    // .photo is the rounded card shell; its gradient placeholder (--photo-bg) shows
    // until/unless the image paints. The img absolute-fills the card.
    <div className="photo">
      <img
        className="banner"
        // encode the filename: a dropped-in name like `summer#1.png` would otherwise be parsed
        // as path `banners/summer` + fragment `#1.png`.
        src={`banners/${encodeURIComponent(banners[index])}`}
        alt=""
        draggable={false}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          down.current = null;
        }}
      />
    </div>
  );
}

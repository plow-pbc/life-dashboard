import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { hourlyIndex, stepIndex, swipeDir, placeholderLabel } from '../banner';

export function Banner() {
  const [banners, setBanners] = useState<string[]>([]);
  // `loaded` flips true only after a successful /api/banners read, so the empty
  // state is "we checked and there are no photos" — not "still loading" — and we
  // never flash the placeholder before real photos arrive.
  const [loaded, setLoaded] = useState(false);
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
        if (!cancelled) {
          setBanners(body.banners);
          setLoaded(true);
        }
      } catch {
        // Unreachable API: leave `loaded` false so the cell stays blank until a
        // later reload, rather than asserting an empty-folder placeholder.
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

  // No photos: show the designed placeholder (warm gradient + frosted label pill)
  // in the 2×1 cell, but only once we've confirmed the folder is empty.
  if (banners.length === 0) {
    if (!loaded) return null;
    return (
      <div className="photo photo--placeholder">
        <div className="photo-ph-label">
          <svg className="photo-ph-icon" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <circle cx="8.5" cy="8.5" r="1.8" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
          <span className="photo-ph-text">{placeholderLabel(new Date())}</span>
        </div>
      </div>
    );
  }

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

import { useEffect, useState } from 'react';
import { isLocalPhotoUrl, pickTonight, type Collection, type TonightPick } from '../pinch';

// The "Cook Tonight" tile: one recipe from the synced Paprika library, with its
// photo. Read-only — there is nothing to tap, by design; the full recipe app is
// not part of this kiosk.
//
// Renders NOTHING until there is a recipe to show, following <Banner/> — see
// the .pinch-tile block in index.css for the layout contract that rests on it.
//
// Self-fetching rather than fed from App, because the recipe snapshot is
// independent of the calendar and a recipe failure must never delay or break
// the calendar render.
//
// Note the tile does NOT infer "disabled" from a status code. When the snapshot
// is unconfigured, /api/pinch/* is never mounted, and server.js's SPA catch-all
// answers the path with 200 text/html rather than a 404 — so res.json() is what
// actually rejects, and the catch below is the real disabled path.
export function CookTonight() {
  const [pick, setPick] = useState<TonightPick | null>(null);
  // A recipe can carry a photoUrl whose bytes aren't cached yet — the library
  // outruns the photo download. Routine, so fall back to the neutral
  // placeholder rather than letting the browser paint a broken-image glyph on
  // a wall display.
  const [photoFailed, setPhotoFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('api/pinch/collection');
        if (!res.ok) return;
        const body = (await res.json()) as Collection;
        if (!cancelled) setPick(pickTonight(body));
      } catch {
        // Non-critical: render nothing. The calendar still loads.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!pick) return null;

  return (
    <section className="pinch-tile" aria-label="Cook Tonight">
      {isLocalPhotoUrl(pick.recipe.photoUrl) && !photoFailed ? (
        <img
          className="pinch-photo--tile"
          src={pick.recipe.photoUrl}
          alt=""
          onError={() => setPhotoFailed(true)}
        />
      ) : (
        <div className="pinch-photo--placeholder" />
      )}
      <div className="pinch-tile__body">
        <p className="pinch-tile__eyebrow">Cook Tonight</p>
        <h2 className="pinch-tile__title">
          {/* Inner span carries the clamp: a flex item gets blockified, which
              makes -webkit-box inert. See index.css. */}
          <span>{pick.recipe.title}</span>
        </h2>
        <p className="pinch-tile__meta">{pick.meta}</p>
      </div>
    </section>
  );
}

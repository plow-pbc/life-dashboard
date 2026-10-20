import { useEffect, useState } from 'react';
import { cookRecipeId, isLocalPhotoUrl, pickTonight, type Collection, type TonightPick } from '../pinch';
import { hashForMealsRecipe } from '../nav';

// The "Cook Tonight" tile: one recipe from the synced Paprika library, with its
// photo. Tapping it opens that recipe IN THE MEALS TAB — the tile is an anchor to
// the `#meals/cook/<id>` hash, so it switches to the embedded Pinch (staying in the
// shell: the nav stays, tap Home to return) and deep-links it to this recipe. The
// id is parsed from the recipe's cookUrl; the Meals pane joins it to the CONFIGURED
// Pinch origin (never the cookUrl host → always within the CSP frame-src). When the
// recipe carries no (valid) cookUrl the tile still renders, just not tappable —
// never an error.
//
// This slot is a CONFIGURABLE WIDGET slot. When no recipe is configured it shows
// a designed invite placeholder (see WidgetSlotPlaceholder below), in the spirit
// of the empty-<Banner/> state — not an empty cell. A later Lifey flow will let
// the user pick which widget lives here; for now the recipe is the one widget and
// the placeholder is the "open slot" invite. See the .pinch-tile / .widget-ph
// blocks in index.css for the layout contract.
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
  // `settled` flips true once the fetch attempt completes (configured or not), so
  // the invite placeholder only appears after we've CONFIRMED the slot is empty —
  // never flashing it during the initial load before a real recipe arrives. This
  // mirrors <Banner/>'s `loaded` gate.
  const [settled, setSettled] = useState(false);
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
        // Non-critical: the slot is unconfigured. The invite placeholder shows
        // (via `settled`), and the calendar still loads regardless.
      } finally {
        if (!cancelled) setSettled(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // No recipe: show the invite once we've confirmed the slot is empty; stay blank
  // (null) while the fetch is still in flight.
  if (!pick) return settled ? <WidgetSlotPlaceholder /> : null;

  const inner = (
    <>
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
      </div>
    </>
  );

  // Tappable when the recipe carries a parseable cookUrl: the anchor targets the
  // Meals deep-link hash (#meals/cook/<id>), which switches to the Meals tab and
  // opens this recipe in the embedded Pinch — no top-level navigation, the nav
  // stays visible. No/unparseable cookUrl → a plain section, identical look, just
  // not tappable (graceful, never an error).
  const recipeId = cookRecipeId(pick.recipe.cookUrl);
  if (recipeId) {
    return (
      <a
        className="pinch-tile pinch-tile--tappable"
        href={hashForMealsRecipe(recipeId)}
        aria-label={`Cook Tonight: open ${pick.recipe.title} in Meals`}
      >
        {inner}
      </a>
    );
  }

  return (
    <section className="pinch-tile" aria-label="Cook Tonight">
      {inner}
    </section>
  );
}

// The designed empty state for this widget slot: a soft clay wash + a small
// icon + a warm, human invite to set a widget up here via Plow. Same spirit as
// the empty-<Banner/> placeholder, tuned to this slot's clay accent.
function WidgetSlotPlaceholder() {
  return (
    <section className="widget-ph" aria-label="Open widget slot">
      <svg className="widget-ph__icon" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <path d="M12 8.5v7M8.5 12h7" />
      </svg>
      <p className="widget-ph__lead">This spot's open.</p>
      <p className="widget-ph__sub">Ask Hive to add a widget here.</p>
    </section>
  );
}

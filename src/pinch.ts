export type Recipe = {
  id: string;
  title: string;
  photoUrl?: string | null;
  lastCookedAt?: string | null;
  // When the recipe was last OPENED in Pinch (ISO-8601 UTC), from the wall-sync
  // meal-plan data. Distinct from lastCookedAt; it is the fallback ranking signal
  // when nothing is planned for tonight. Optional: an older snapshot may omit it.
  lastOpenedAt?: string | null;
  // The Pinch sync writes a cookUrl per recipe (<backend>/cook/<id>) so the tile
  // can open that recipe's cooking mode on tap. Optional: an older snapshot (or
  // a Pinch-side gap) may omit it, in which case the tile just isn't tappable.
  cookUrl?: string | null;
};

// Two independent "tonight" signals, reconciled in pickTonight (pin wins):
//   - tonightRecipeId: Pinch's MEAL-PLAN pick for tonight (top-level in
//     collection.json, preserved by JsonStore, resolved against the household tz).
//   - pinnedRecipeId: Hive's EXPLICIT pin (the server surfaces it from the durable
//     tonight.json sibling). An explicit pin overrides the meal plan.
export type Collection = {
  recipes: Recipe[];
  tonightRecipeId?: string | null;
  pinnedRecipeId?: string | null;
};

// The sync stores Paprika's own photo URL verbatim when it is publicly
// fetchable (resolvePhotoUrl in pinch-sync.mjs), so a recipe imported from the
// web can carry a REMOTE url. Rendering that would make the kiosk fetch an
// arbitrary third-party endpoint every reload, which is a beacon we never
// intended to serve. Only our own route is renderable; anything else shows the
// placeholder.
const LOCAL_PHOTO = /^\/api\/pinch\/photos\/[A-Za-z0-9_-]{1,128}$/;

// A type predicate, so the caller's `src` narrows to string on the true branch
// and there is no second null-check at the use site.
export function isLocalPhotoUrl(url: string | null | undefined): url is string {
  return typeof url === 'string' && LOCAL_PHOTO.test(url);
}

// A tappable cookUrl must be an absolute http(s) URL — the tile navigates the
// top-level document to it, so a `javascript:`/`data:` scheme or a relative
// value is rejected (the tile falls back to not-tappable). Scheme-only, not
// host/path pinned, so the Pinch backend can move (preview → prod) without a
// viewer change. A type predicate so the href narrows to string at the use site.
export function isCookUrl(url: string | null | undefined): url is string {
  if (typeof url !== 'string') return false;
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

// The Pinch cook-route id from a recipe's cookUrl ("<backend>/cook/<id>"). The
// tile deep-links the Meals tab to this id, which the Meals pane joins to the
// CONFIGURED Pinch origin (PINCH_BACKEND_URL) — NOT the cookUrl's own host, which
// may differ from the configured origin and would be blocked by the CSP frame-src.
// So we take only the opaque id (safe path-segment charset), never the host.
const COOK_PATH_RE = /^\/cook\/([A-Za-z0-9_-]+)\/?$/;

/** The "/cook/<id>" recipe id from a cookUrl, or null if it isn't that shape. */
export function cookRecipeId(url: string | null | undefined): string | null {
  if (!isCookUrl(url)) return null;
  try {
    const m = COOK_PATH_RE.exec(new URL(url).pathname);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// NOT named Pick — that would shadow TypeScript's built-in Pick<T, K> in this
// file and in every importer.
export type TonightPick = { recipe: Recipe; meta: string };

// Timestamps are only trusted when they are ISO-8601 shaped: the compare below is
// lexical, so a value like 'yesterday' would sort above every real timestamp and
// silently win. Same-shape UTC timestamps sort correctly as plain strings.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T/;

// The recipe with the newest valid ISO timestamp in `field`, or undefined if none
// has one. Lexical compare on same-shape timestamps; an unparseable value is
// skipped rather than silently ranking (it can't become epoch).
function newestBy(recipes: Recipe[], field: 'lastOpenedAt' | 'lastCookedAt'): Recipe | undefined {
  let newest: Recipe | undefined;
  for (const r of recipes) {
    const v = r[field];
    if (typeof v !== 'string' || !ISO_DATE.test(v)) continue;
    if (!newest || v > (newest[field] as string)) newest = r;
  }
  return newest;
}

// Which recipe the tile shows, and the caption explaining why. The precedence
// reconciles the two "tonight" signals, then falls back through recency:
//
//   1. pinnedRecipeId     → "Cook Tonight" — Hive's EXPLICIT pin, the override.
//   2. tonightRecipeId    → "Cook Tonight" — Pinch's MEAL-PLAN pick for tonight.
//   3. newest lastOpenedAt → "Recently opened" — the spec's fallback.
//   4. newest lastCookedAt → "Recently cooked" — tertiary, so the tile keeps a
//      meaningful default while lastOpenedAt is still empty (not yet populated).
//   5. else anything       → "From your library".
//
// Each id is re-validated against recipes[] so a stale/deleted id falls through
// (fail-closed) rather than selecting nothing.
export function pickTonight({
  recipes,
  tonightRecipeId,
  pinnedRecipeId,
}: Collection): TonightPick | null {
  if (recipes.length === 0) return null;

  // Explicit pin first, then the meal plan. Both present → the pin wins.
  for (const id of [pinnedRecipeId, tonightRecipeId]) {
    if (id) {
      const planned = recipes.find((r) => r.id === id);
      if (planned) return { recipe: planned, meta: 'Cook Tonight' };
    }
  }

  // Recency fallbacks: prefer most-recently-opened; fall back to most-recently-
  // cooked so an all-null lastOpenedAt (not yet populated) doesn't drop the tile
  // to an arbitrary recipes[0].
  const opened = newestBy(recipes, 'lastOpenedAt');
  if (opened) return { recipe: opened, meta: 'Recently opened' };

  const cooked = newestBy(recipes, 'lastCookedAt');
  if (cooked) return { recipe: cooked, meta: 'Recently cooked' };

  return { recipe: recipes[0], meta: 'From your library' };
}

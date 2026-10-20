export type Recipe = {
  id: string;
  title: string;
  photoUrl?: string | null;
  lastCookedAt?: string | null;
  // The Pinch sync writes a cookUrl per recipe (<backend>/cook/<id>) so the tile
  // can open that recipe's cooking mode on tap. Optional: an older snapshot (or
  // a Pinch-side gap) may omit it, in which case the tile just isn't tappable.
  cookUrl?: string | null;
};

// `tonightRecipeId` is the optional "Cook Tonight" pin: the id of the recipe a
// user explicitly pinned as tonight's meal. The server surfaces it (merged from a
// durable sibling pin file) only when it resolves to a recipe in `recipes`.
export type Collection = { recipes: Recipe[]; tonightRecipeId?: string | null };

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

// The sync is the only writer of lastCookedAt and nothing in this repo enforces
// its format, so require the shape and not just the type: comparison below is
// lexical, and a value like 'yesterday' would sort above every real timestamp
// and silently win.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T/;

// Which recipe the tile shows, and the caption explaining why:
//
//   0. an explicit pin (tonightRecipeId) → "Cook Tonight" — tonight's PLANNED meal
//      wins over recency; guarded so a stale/non-matching id falls through.
//   1. the most recently cooked          → "Recently cooked"
//   2. else anything at all              → "From your library"
export function pickTonight({ recipes, tonightRecipeId }: Collection): TonightPick | null {
  if (recipes.length === 0) return null;

  // A pinned recipe is tonight's intended meal, so it outranks every recency
  // signal. The server already only sends a resolvable id, but re-check here so
  // this pure pick is self-contained (and a stale id can never win nothing).
  if (tonightRecipeId) {
    const pinned = recipes.find((r) => r.id === tonightRecipeId);
    if (pinned) return { recipe: pinned, meta: 'Cook Tonight' };
  }

  // Same-shape ISO-8601 timestamps sort lexically, so no Date parsing is needed
  // to find the newest — and an unparseable value can't silently become epoch.
  let newest: Recipe | undefined;
  for (const r of recipes) {
    if (typeof r.lastCookedAt !== 'string' || !ISO_DATE.test(r.lastCookedAt)) continue;
    if (!newest || r.lastCookedAt > (newest.lastCookedAt as string)) newest = r;
  }
  if (newest) return { recipe: newest, meta: 'Recently cooked' };

  return { recipe: recipes[0], meta: 'From your library' };
}

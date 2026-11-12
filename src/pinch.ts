export type Recipe = {
  id: string;
  title: string;
  photoUrl?: string | null;
  lastCookedAt?: string | null;
  // When the recipe was last OPENED in Pinch (ISO-8601 UTC), from the wall-sync
  // meal-plan data. Distinct from lastCookedAt; it is the fallback ranking signal
  // when nothing is planned for tonight. Optional: an older snapshot may omit it.
  lastOpenedAt?: string | null;
  // DEPRECATED: the sync still writes a cookUrl per recipe, but the viewer no longer
  // uses it (the Cook Tonight tap opens the Meals tab, not a recipe deep-link). Kept
  // on the type only so a snapshot carrying it still types; it will go when the sync
  // drops it. (Pinch has aliased cookUrl to /recipe and plans to remove it.)
  cookUrl?: string | null;
  // Free-text times from the recipe ("10 mins", "1 hr 20 min"); optional, as
  // the snapshot may not carry them.
  prepTime?: string | null;
  cookTime?: string | null;
};

// Two independent "tonight" signals, reconciled in pickTonight (pin wins):
//   - tonightRecipeId: Pinch's MEAL-PLAN pick for tonight (top-level in
//     collection.json, preserved by JsonStore, resolved against the household tz).
//   - pinnedRecipeId: Hive's EXPLICIT pin (the server surfaces it from the durable
//     tonight.json sibling). An explicit pin overrides the meal plan.
// One planned meal from Pinch's meal plan, in the household's timezone.
export type PlanSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type PlanEntry = { date: string; slot: PlanSlot; recipeId: string };

export type Collection = {
  recipes: Recipe[];
  // Planned meals from today through the next week (the wall-sync writes it).
  // Absent on an older snapshot, which keeps the pre-plan behaviour.
  plan?: PlanEntry[];
  tonightRecipeId?: string | null;
  pinnedRecipeId?: string | null;
  // When the snapshot was last written (ISO-8601), the server's file mtime. Used
  // to detect a frozen library (a failed hourly sync) and date the tile rather
  // than present old data as tonight's plan. Optional: an older server omits it.
  generatedAt?: string | null;
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

// The Pinch embed iframe src. The BASE library URL, or — when `recipe` is given — a
// one-time recipe deep-link (Pinch opens that recipe's detail inside the embed session,
// then strips the param so its own reloads stay clean). The token is already
// percent-encoded by the server, so it is appended verbatim; the recipe id is encoded
// (Pinch matches it case-insensitively, so the UPPERCASE collection id works).
export function embedSrc(origin: string, token: string, recipe?: string | null): string {
  const base = `${origin}/embed?token=${token}`;
  return recipe ? `${base}&recipe=${encodeURIComponent(recipe)}` : base;
}

// NOT named Pick — that would shadow TypeScript's built-in Pick<T, K> in this
// file and in every importer.
export type TonightPick = { recipe: Recipe; meta: string };

// Meal data older than this is shown dated ("menu from Oct 21") rather than as
// tonight's plan. 36h, not 24h: the wall-sync cron runs hourly, so a normal day
// never approaches it, but a brief outage or a few missed ticks won't false-
// positive either; only a genuinely frozen library (a multi-hour-plus failed
// pull, e.g. an expired recipe token) crosses it. The "tonight" framing is only
// honest for same-day data, and 36h is one household day plus a half-day grace.
export const MENU_STALE_MS = 36 * 60 * 60 * 1000;

// Whether the snapshot is stale enough that the tile must date it instead of
// calling it tonight's plan. Pure — `now` is injected so the boundary is
// testable. A missing/unparseable stamp returns false: absence of a freshness
// signal (an older server, a fresh install) is not a staleness CLAIM, so the
// tile keeps its normal captions rather than asserting a date it doesn't have.
// Boundary is exclusive (`>`), so data exactly at the threshold is still fresh.
export function isMenuStale(
  generatedAt: string | null | undefined,
  now: Date,
  thresholdMs: number = MENU_STALE_MS,
): boolean {
  if (typeof generatedAt !== 'string') return false;
  const t = Date.parse(generatedAt);
  if (Number.isNaN(t)) return false;
  return now.getTime() - t > thresholdMs;
}

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

// Meal slots in the order they happen, and the hour each is over by: past
// that, today's entry for the slot no longer counts as coming up.
const SLOT_ORDER: Record<PlanSlot, number> = { breakfast: 0, lunch: 1, snack: 2, dinner: 3 };
const SLOT_OVER_HOUR: Record<PlanSlot, number> = {
  breakfast: 10,
  lunch: 14,
  snack: 17,
  dinner: 21,
};

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The label for a planned meal: "Tonight", "Lunch today", "Thu dinner". */
export function planLabel(entry: PlanEntry, now: Date): string {
  if (entry.date === ymd(now)) {
    return entry.slot === 'dinner'
      ? 'Tonight'
      : `${entry.slot[0].toUpperCase()}${entry.slot.slice(1)} today`;
  }
  const [y, m, d] = entry.date.split('-').map(Number);
  const weekday = new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short' });
  return `${weekday} ${entry.slot}`;
}

// Tonight's dinner if it's planned and not over; else the soonest planned meal
// still to come. Entries whose recipe isn't in the library are skipped.
function nextPlanned(plan: PlanEntry[], recipes: Recipe[], now: Date): TonightPick | null {
  const today = ymd(now);
  const hour = now.getHours();
  const upcoming = plan
    .filter((e) => e.date > today || (e.date === today && hour < SLOT_OVER_HOUR[e.slot]))
    .map((e) => ({ e, recipe: recipes.find((r) => r.id === e.recipeId) }))
    .filter((x): x is { e: PlanEntry; recipe: Recipe } => x.recipe !== undefined)
    .sort(
      (a, b) => a.e.date.localeCompare(b.e.date) || SLOT_ORDER[a.e.slot] - SLOT_ORDER[b.e.slot],
    );
  const chosen = upcoming.find((x) => x.e.date === today && x.e.slot === 'dinner') ?? upcoming[0];
  return chosen ? { recipe: chosen.recipe, meta: planLabel(chosen.e, now) } : null;
}

// Which recipe the tile shows, and the caption explaining why. The precedence
// reconciles the two "tonight" signals, then falls back through recency:
//
//   1. pinnedRecipeId     → "Tonight" — Hive's EXPLICIT pin, the override.
//   2. tonightRecipeId    → "Tonight" — Pinch's MEAL-PLAN pick for tonight.
//   3. plan, tonight's dinner → "Tonight".
//   4. plan, the next meal still to come → its label ("Lunch today", "Thu dinner").
//   5. newest lastOpenedAt → "Recently opened" — the spec's fallback.
//   6. newest lastCookedAt → "Recently cooked" — tertiary, so the tile keeps a
//      meaningful default while lastOpenedAt is still empty (not yet populated).
//   7. else anything       → "From your library".
//
// Each id is re-validated against recipes[] so a stale/deleted id falls through
// (fail-closed) rather than selecting nothing.
export function pickTonight(
  { recipes, tonightRecipeId, pinnedRecipeId, plan }: Collection,
  now: Date = new Date(),
): TonightPick | null {
  if (recipes.length === 0) return null;

  // Explicit pin first, then the meal plan. Both present → the pin wins.
  for (const id of [pinnedRecipeId, tonightRecipeId]) {
    if (id) {
      const planned = recipes.find((r) => r.id === id);
      if (planned) return { recipe: planned, meta: 'Tonight' };
    }
  }

  const next = nextPlanned(plan ?? [], recipes, now);
  if (next) return next;

  // Recency fallbacks: prefer most-recently-opened; fall back to most-recently-
  // cooked so an all-null lastOpenedAt (not yet populated) doesn't drop the tile
  // to an arbitrary recipes[0].
  const opened = newestBy(recipes, 'lastOpenedAt');
  if (opened) return { recipe: opened, meta: 'Recently opened' };

  const cooked = newestBy(recipes, 'lastCookedAt');
  if (cooked) return { recipe: cooked, meta: 'Recently cooked' };

  return { recipe: recipes[0], meta: 'From your library' };
}

/** Whether tonight's dinner is planned: the tile would label its pick
 *  "Tonight" and the library is fresh enough to trust that. */
export function hasDinnerTonight(collection: Collection | null, now: Date): boolean {
  if (!collection || isMenuStale(collection.generatedAt, now)) return false;
  return pickTonight(collection, now)?.meta === 'Tonight';
}

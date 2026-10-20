// Hash-based tab routing for the dashboard shell. No router dependency: the
// active tab IS the URL hash, which gives three properties for free —
//   (a) no new dependency for three tabs;
//   (b) it survives the viewer's ~5-min location.reload() (the hash persists, so
//       the wall stays on the current tab);
//   (c) the Pi's hourly kiosk recycle relaunches the BARE localhost:5174 (no
//       hash) → tabFromHash('') → Home, so the wall rests to Home each hour with
//       no timer of our own.

export const TABS = ['home', 'calendar', 'meals'] as const;
export type Tab = (typeof TABS)[number];

export const DEFAULT_TAB: Tab = 'home';

/** The tab for a `location.hash` value. Keyed on the FIRST path segment, so a
 *  deep-link like `#meals/cook/<id>` still resolves to the Meals tab. Anything
 *  unknown/empty/bare → Home. */
export function tabFromHash(hash: string): Tab {
  const name = hash.replace(/^#/, '').trim().toLowerCase().split('/')[0];
  return (TABS as readonly string[]).includes(name) ? (name as Tab) : DEFAULT_TAB;
}

/** The hash to write for a tab. Always explicit (even Home), so a reload while on
 *  a tab stays on that tab rather than falling back through the bare-URL path. */
export function hashForTab(tab: Tab): string {
  return `#${tab}`;
}

// A Meals deep-link carries a recipe's Pinch "/cook/<id>" route id in the hash:
// `#meals/cook/<id>`. The Cook Tonight tile writes it (hashForMealsRecipe) and the
// Meals pane reads it (mealsRecipeFromHash) to deep-link the embedded Pinch to that
// recipe. The id is the opaque Pinch cook-route id parsed from the recipe's cookUrl
// (pinch.ts cookRecipeId) — NOT a host, so there is no CSP concern here: the Meals
// pane joins it to the CONFIGURED Pinch origin, never the cookUrl's own host.
const MEALS_COOK_PREFIX = 'meals/cook/';
const RECIPE_ID_RE = /^[A-Za-z0-9_-]+$/;

/** The recipe id from a `#meals/cook/<id>` hash, else null (plain `#meals` → the
 *  Pinch library base). The id's case is preserved (cook-route ids are
 *  case-sensitive); only the known prefix is matched case-insensitively. */
export function mealsRecipeFromHash(hash: string): string | null {
  const s = hash.replace(/^#/, '').trim();
  if (!s.toLowerCase().startsWith(MEALS_COOK_PREFIX)) return null;
  const id = s.slice(MEALS_COOK_PREFIX.length);
  return RECIPE_ID_RE.test(id) ? id : null;
}

/** The hash that deep-links the Meals tab to one recipe. */
export function hashForMealsRecipe(recipeId: string): string {
  return `#${MEALS_COOK_PREFIX}${recipeId}`;
}

/** Display labels for the nav. */
export const TAB_LABELS: Record<Tab, string> = {
  home: 'Home',
  calendar: 'Calendar',
  meals: 'Meals',
};

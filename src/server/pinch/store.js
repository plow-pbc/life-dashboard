import { readFileSync } from 'node:fs';

// Read-only view of the recipe snapshot. The out-of-process Paprika sync (see
// SEED.md) owns every file here and rewrites the library atomically; this
// process only ever reads, so there is no write chain and no lock.
//
// ENOENT reads as empty: that is the ordinary state before the first sync, and
// a kiosk showing no recipe yet is correct. Every other failure — a permissions
// fault, a directory where a file belongs, a malformed file — throws, per
// REVIEW.md's operating point ("prefer loud failures to fallbacks").
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  read() {
    const lib = readJson(this.filePath) ?? {};
    // Preserve the top-level `tonightRecipeId` (Pinch's meal-plan pick for tonight)
    // alongside recipes — a non-string (absent/null) means "nothing planned".
    // Per-recipe fields (incl. lastOpenedAt) pass through untouched in `recipes`.
    return {
      recipes: Array.isArray(lib.recipes) ? lib.recipes : [],
      tonightRecipeId: typeof lib.tonightRecipeId === 'string' ? lib.tonightRecipeId : null,
    };
  }
}

// Today's date (YYYY-MM-DD) in the server's LOCAL timezone. The Pi runs in the
// household timezone (America/Los_Angeles), so local == household-local; this
// matches the repo's existing household-day convention (see calendarLayout.ts,
// which does day math off the same local getters). Used to auto-expire a dated
// pin. Injectable for tests.
export function todayLocalYMD(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

// The "Cook Tonight" pin. `tonight.json` is a tiny OPTIONAL overlay — shape
// `{ "recipeId": "<id>", "date"?: "YYYY-MM-DD" }` — written by the pin flow and
// kept as a SIBLING of collection.json. That separation is the durability
// mechanism: the hourly sync (wall-sync) only rewrites collection.json
// (temp+rename) and GCs photos/, so a sibling pin file is never read, rewritten,
// or pruned and survives every sync. There is one writer for the library (the
// sync) and one for the pin (the pin flow), so the two never race over a shared file.
//
// AUTO-EXPIRY: `date` is household-local YYYY-MM-DD (the day the pin is "for").
//   - absent/null date → always-on (back-compat: a bare { recipeId } still works);
//   - date present → the pin applies ONLY when it equals `today` (also
//     household-local). A past/future or malformed date fails CLOSED (no pin), so a
//     "tonight" pin can never linger past its day — the whole point of the date.
// `today` is the caller's household-local YYYY-MM-DD (server.js passes todayLocalYMD()).
//
// Returns the pinned recipe id (trimmed) or null. ENOENT is the ordinary
// "nothing pinned" state. DELIBERATELY NOT fail-loud like the library read: the
// pin is a non-critical overlay on top of the library, so a malformed or
// unreadable pin file must never take down the recipe tile — it degrades to "no
// pin" (warned for anything other than absence) and the tile keeps its normal
// fallback pick.
export function readTonightPin(filePath, today) {
  let obj;
  try {
    obj = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`Ignoring tonight.json pin (${filePath}): ${err.message}`);
    }
    return null;
  }
  const id = obj && typeof obj.recipeId === 'string' ? obj.recipeId.trim() : '';
  if (!id) return null;
  // No date → always-on (null is treated as "unset", same as absent).
  if (obj.date === undefined || obj.date === null) return id;
  // Dated → today-only; anything that isn't exactly today's string (including a
  // non-string or malformed date) fails closed so a stale pin cannot linger.
  return obj.date === today ? id : null;
}

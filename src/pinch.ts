export type Recipe = {
  id: string;
  title: string;
  photoUrl?: string | null;
  lastCookedAt?: string | null;
};

export type Collection = { recipes: Recipe[] };

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
//   1. the most recently cooked → "Recently cooked"
//   2. else anything at all     → "From your library"
export function pickTonight({ recipes }: Collection): TonightPick | null {
  if (recipes.length === 0) return null;

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

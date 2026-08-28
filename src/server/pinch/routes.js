import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Recipe read routes, mounted onto the dashboard's existing Hono app under
// /api/pinch/*. Read-only by design: the kiosk displays a tile, it does not
// edit the library — the out-of-process Paprika sync owns every write.
//
//   GET /api/pinch/collection  → { recipes }
//   GET /api/pinch/photos/:id  → locally-cached photo bytes
//
// Both inherit the caller app's /api/* host guard and add no auth of their own,
// because they expose nothing more sensitive than the calendar already does.
//
// Route NAMES match the sibling kiosk's so a later convergence adds that
// machine's write half rather than renaming anything here.

// Bound the photo id to an opaque token so it can never escape photosDir.
// Length is part of that bound: an over-long id fails the read with
// ENAMETOOLONG rather than ENOENT, which now throws rather than 404-ing, so
// capping here keeps a caller from turning a bad request into a 500.
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

// Content-types we will serve back for a cached photo. The sidecar is written
// by our own sync, but whitelist anyway so a tampered `.type` can never set an
// arbitrary content-type on bytes we serve. SVG is deliberately excluded: it is
// a scriptable document type, and no synced photo has ever been one.
//
// The non-JPEG entries are NOT speculative surface: today every synced photo is
// JPEG, but the sync stores whatever Paprika serves, and dropping a format here
// does not block it — it silently mislabels it as image/jpeg. A wrong declared
// type is wrong on its own terms: it is what caching, a save-image, and direct
// navigation all go by. (It would still *render* in the tile — an <img> decodes
// by magic bytes, and nosniff constrains script/style destinations, not images
// — so the cost is mislabeling, not a blank photo.)
const ALLOWED_PHOTO_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
]);

// A missing sidecar is routine — fall back to JPEG. Any other read failure
// throws, matching ./store.js and REVIEW.md's fail-loud operating point.
function readPhotoContentType(photosDir, id) {
  try {
    const t = readFileSync(join(photosDir, `${id}.type`), 'utf8')
      .trim()
      .toLowerCase();
    return ALLOWED_PHOTO_TYPES.has(t) ? t : 'image/jpeg';
  } catch (err) {
    if (err.code === 'ENOENT') return 'image/jpeg';
    throw err;
  }
}

export function registerPinchRoutes(app, { store, photosDir }) {
  app.get('/api/pinch/collection', (c) => c.json(store.read()));

  // Locally-cached photo bytes.
  app.get('/api/pinch/photos/:id', (c) => {
    const id = c.req.param('id');
    if (!ID_RE.test(id)) return c.json({ error: 'invalid photo id' }, 400);
    try {
      return c.body(readFileSync(join(photosDir, id)), 200, {
        'content-type': readPhotoContentType(photosDir, id),
        // no-store, not a long max-age: the library is rewritten hourly and
        // ids are reused, so a cached photo outlives the recipe it belongs
        // to. A stale cached photo is also what produced a false-pass while
        // verifying this PR's own fallback — the browser served the previous
        // run's bytes for a route that was answering 404.
        'cache-control': 'no-store',
        // Makes the declared type binding: the browser will not re-type this
        // response by inspecting its bytes. That is what pairs with the
        // allowlist above — together they mean a tampered sidecar cannot get
        // document bytes treated as anything but the image type we declared.
        'x-content-type-options': 'nosniff',
      });
    } catch (err) {
      // An absent photo is routine — the library outruns the photo download.
      // Anything else throws rather than being flattened into "not found".
      if (err.code === 'ENOENT') return c.json({ error: 'photo not found' }, 404);
      throw err;
    }
  });

  return app;
}

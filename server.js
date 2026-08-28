import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from './src/server/app.js';
import { createFileStore } from './src/server/store.js';
import { createBannerStore } from './src/server/banners.js';
import { JsonStore } from './src/server/pinch/store.js';

// Banner images are served from ./banners/ at runtime — not bundled. Drop new
// images in the folder and they appear at the next page reload. Missing or
// empty folder collapses the banner row entirely on the client.
const BANNER_DIR = './banners';
const BANNER_EXTS = /\.(png|jpe?g|webp|gif)$/i;

const ICAL_URL = process.env.ICAL_URL;
if (!ICAL_URL) {
  console.error('FATAL: ICAL_URL is required (set it in .env)');
  process.exit(1);
}

const DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN;
// One switch gates the whole remote-write surface (message API + banner CRUD)
// and the 0.0.0.0 bind below.
const remoteWritesEnabled = Boolean(DASHBOARD_TOKEN);
if (!remoteWritesEnabled) {
  console.warn('Remote writes disabled (set DASHBOARD_TOKEN to enable the message + banner APIs).');
}

// The Cook Tonight tile reads a recipe snapshot this process never writes — an
// out-of-process Paprika sync owns it (see SEED.md). No snapshot configured is a
// valid deploy, not an error: the routes never mount and the tile stays empty.
//
// The photos directory is DERIVED rather than separately configured: the sync
// always writes photos beside the library, so a second env var would only add a
// way for the two to disagree.
const PINCH_DATA_FILE = process.env.PINCH_DATA_FILE;
const pinch = PINCH_DATA_FILE
  ? {
      store: new JsonStore(PINCH_DATA_FILE),
      photosDir: join(dirname(PINCH_DATA_FILE), 'photos'),
    }
  : null;
if (!pinch) {
  console.warn('Recipe tile disabled (set PINCH_DATA_FILE to enable /api/pinch/*).');
}

// Deploy stamp dropped into the release dir by the updater at flip time.
// A dev tree has no stamp; /api/version then serves nulls.
let version = null;
try {
  version = JSON.parse(await readFile('./version.json', 'utf8'));
} catch {
  /* dev tree: no stamp */
}

const app = createApp({
  fetchUpstream: async () => {
    const res = await fetch(ICAL_URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Upstream returned HTTP ${res.status}`);
    return await res.text();
  },
  listBanners: async () => {
    let entries;
    try {
      entries = await readdir(BANNER_DIR, { withFileTypes: true });
    } catch (err) {
      // No ./banners/ folder is a valid "no banners configured" deploy, not
      // an error — return []. Any other failure (permissions, I/O) propagates
      // and surfaces as a 500 instead of being silently masked.
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    return entries
      .filter((e) => e.isFile() && BANNER_EXTS.test(e.name))
      .map((e) => e.name)
      .sort();
  },
  messageStore: remoteWritesEnabled ? await createFileStore('./data/messages.json') : undefined,
  // Texted-photo CRUD writes into the same ./banners/ dir listBanners reads +
  // /banners/* serves. Gated behind the same DASHBOARD_TOKEN as the message API.
  bannerStore: remoteWritesEnabled ? createBannerStore(BANNER_DIR) : undefined,
  messageToken: DASHBOARD_TOKEN,
  pinch,
  version,
});

// Banner images live outside the bundle so they can be swapped without a
// rebuild. Mount BEFORE the SPA catch-all so /banners/* lookups don't fall
// through to dist.
app.use('/banners/*', serveStatic({ root: './' }));

// SPA static + fallback. Order matters: API routes registered first inside createApp.
app.use('/*', serveStatic({ root: './dist' }));
app.get('*', serveStatic({ path: './dist/index.html' }));

// Remote producers (Plow on the Mac) need the message + banner write APIs;
// without a token there is no remote surface, so keep the loopback-only bind.
const HOST = remoteWritesEnabled ? '0.0.0.0' : '127.0.0.1';

// PORT override exists for the updater's pre-flip probe boot (:5199); the
// real viewer always runs on the default.
serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 5174), hostname: HOST }, (info) => {
  console.log(`life-dashboard-viewer listening on http://localhost:${info.port}`);
});

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from './src/server/app.js';
import { createDocumentStore, createFileStore } from './src/server/store.js';
import { createCardPoller, DEFAULT_TTL_MS } from './src/server/remote.js';
import { createBannerStore } from './src/server/banners.js';
import { JsonStore, readTonightPin, todayLocalYMD } from './src/server/pinch/store.js';
import { createWeatherFetcher } from './src/server/weather.js';
import { createSportsFetcher } from './src/server/sports.js';

// Banner images are served from ./banners/ at runtime — not bundled. Drop new
// images in the folder and they appear at the next page reload. Missing or
// empty folder collapses the banner row entirely on the client.
const BANNER_DIR = './banners';
const BANNER_EXTS = /\.(png|jpe?g|webp|gif)$/i;

// ICAL_URL is the owner's optional fallback to the pushed feed: blank means
// /api/ical answers 502, after which the client uses a stale feed or its error state.
const ICAL_URL = process.env.ICAL_URL;
if (!ICAL_URL) console.warn('ICAL_URL unset — ICS fallback disabled.');

const DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN;
// Remote store mode: cards live in the Plow kiosk store and DASHBOARD_TOKEN is
// the kiosk's READ token. The Pi accepts no connection in this mode — loopback
// bind, no producer writes, no banner CRUD (updater/README.md § Status).
const KIOSK_REMOTE_URL = process.env.KIOSK_REMOTE_URL;
const remoteMode = Boolean(KIOSK_REMOTE_URL);
if (remoteMode && !DASHBOARD_TOKEN) {
  console.error('FATAL: KIOSK_REMOTE_URL is set but DASHBOARD_TOKEN (the kiosk read token) is not');
  process.exit(1);
}
// One switch gates the whole remote-write surface (message/calendar APIs + banner CRUD)
// and the 0.0.0.0 bind below.
const remoteWritesEnabled = Boolean(DASHBOARD_TOKEN) && !remoteMode;
if (!remoteWritesEnabled && !remoteMode) {
  console.warn(
    'Remote writes disabled (set DASHBOARD_TOKEN to enable the message + calendar + banner APIs).',
  );
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
      // The "Cook Tonight" pin is a sibling `tonight.json` ({ recipeId, date? })
      // beside the library — DERIVED from PINCH_DATA_FILE, not separately configured,
      // the same way photosDir is. It is a separate file on purpose: the hourly sync
      // only rewrites collection.json + photos/, so the pin survives regeneration.
      // Read tolerantly (absent/malformed → no pin) so a bad pin never breaks the tile.
      // todayLocalYMD() is recomputed PER REQUEST so a dated pin auto-expires at the
      // household-local day boundary without the process restarting.
      readPin: () => readTonightPin(join(dirname(PINCH_DATA_FILE), 'tonight.json'), todayLocalYMD()),
    }
  : null;
if (!pinch) {
  console.warn('Recipe tile disabled (set PINCH_DATA_FILE to enable /api/pinch/*).');
}

// Deploy stamp dropped into the release dir by the updater at flip time.
// A dev tree has no stamp; /api/version then serves nulls. Only ENOENT means
// "no stamp" — a present-but-unreadable/corrupt stamp fails loudly (same
// convention as listBanners below) instead of masquerading as a dev tree.
let version = null;
try {
  version = JSON.parse(await readFile('./version.json', 'utf8'));
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

// Redirects are refused (the kiosk-protocol rule for bearers on the wire) so a
// 30x can never forward the read token elsewhere.
const fetchCards = async () => {
  const res = await fetch(KIOSK_REMOTE_URL, {
    headers: { authorization: `Bearer ${DASHBOARD_TOKEN}` },
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`remote store HTTP ${res.status}`);
  return (await res.json()).cards;
};
const messageStore = remoteMode
  ? createCardPoller({ fetchCards, store: await createFileStore('./data/messages.json') })
  : remoteWritesEnabled
    ? await createFileStore('./data/messages.json')
    : undefined;
// Background tick keeps the wall warm between page loads; reads coalesce on it.
if (remoteMode) setInterval(() => messageStore.refresh(), DEFAULT_TTL_MS).unref();
const calendarStore = remoteWritesEnabled
  ? await createDocumentStore('./data/calendar.json')
  : undefined;

// Weather tile (NWS, no key). Always on — it needs no secret and no pushed
// feed. WEATHER_LAT/WEATHER_LON/WEATHER_LOCATION override the default
// (Mountain View). The fetcher primes itself and refreshes on an interval; the
// tile reads only the cached snapshot via /api/weather.
const weatherStore = createWeatherFetcher({
  lat: Number(process.env.WEATHER_LAT ?? 37.386),
  lon: Number(process.env.WEATHER_LON ?? -122.083),
  location: process.env.WEATHER_LOCATION ?? 'Mountain View',
});

// Sports tile (ESPN, no key). Followed teams come from SPORTS_TEAMS — a JSON
// array of { abbr, sport, league }, e.g.
//   [{"abbr":"SF","sport":"football","league":"nfl"},
//    {"abbr":"GS","sport":"basketball","league":"nba"}]
// Blank or malformed → an empty list, and the tile shows "No upcoming games".
let sportsTeams = [];
if (process.env.SPORTS_TEAMS) {
  try {
    const parsed = JSON.parse(process.env.SPORTS_TEAMS);
    if (Array.isArray(parsed)) sportsTeams = parsed;
    else console.warn('SPORTS_TEAMS is not a JSON array — ignoring.');
  } catch {
    console.warn('SPORTS_TEAMS is not valid JSON — ignoring.');
  }
}
// Team logos are downloaded+cached here on each refresh and served back from
// /api/sports/logo/:id, so the kiosk loads only `self` images (CSP). Lives
// under ./data alongside the other runtime state; created on first refresh.
const SPORTS_LOGOS_DIR = process.env.SPORTS_LOGOS_DIR ?? './data/sports-logos';
const sportsStore = createSportsFetcher({ teams: sportsTeams, logosDir: SPORTS_LOGOS_DIR });

const app = createApp({
  fetchUpstream: async () => {
    if (!ICAL_URL) throw new Error('ICAL_URL unset');
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
  messageStore,
  messageReadOnly: remoteMode,
  // Texted-photo CRUD writes into the same ./banners/ dir listBanners reads +
  // /banners/* serves. Gated behind the same DASHBOARD_TOKEN as the message API.
  bannerStore: remoteWritesEnabled ? createBannerStore(BANNER_DIR) : undefined,
  messageToken: DASHBOARD_TOKEN,
  pinch,
  version,
  calendarStore,
  weatherStore,
  sportsStore,
  // Runtime FAMILY_NAME for the banner placeholder, served via GET /api/config.
  // A `.env` change + `systemctl --user restart life-dashboard-viewer` applies
  // it with no client rebuild (unlike the build-time Vite defines). Loopback-only.
  familyName: process.env.FAMILY_NAME,
  // The owner's configured Pinch backend origin for the Meals tab (iframe src +
  // CSP frame-src). Validated/normalized in createApp; unset → Meals shows a
  // placeholder and no frame-src is emitted. Same restart-to-apply story.
  pinchBackendUrl: process.env.PINCH_BACKEND_URL,
  // The read-only Pinch embed token for the Meals iframe. Kept OUT of
  // PINCH_BACKEND_URL on purpose (that value is normalized to origin-only for the
  // CSP). Read-only + rotatable, so it is a re-pasteable `.env` value read at
  // runtime; createApp URL-encodes it and serves it via loopback-only /api/config.
  pinchEmbedToken: process.env.PINCH_EMBED_TOKEN,
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

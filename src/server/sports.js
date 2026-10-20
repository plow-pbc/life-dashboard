// Server-side sports fetcher backed by ESPN's public scoreboard API
// (site.api.espn.com — no API key). For each followed team we hit its league
// scoreboard and keep the games that team is in, inside a ~14-day window.
//
//   GET site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard
//
// The parse is split from the fetch so it can be unit-tested against captured
// JSON with no network (see sports.test.js). createSportsFetcher() wraps it in
// a server-side cache that refreshes on an interval; the tile reads the cached
// snapshot, never the upstream.
//
// One bad team feed is skipped, not fatal: a single league outage or a typo in
// a followed team must not blank the whole tile.
//
// Team logos: the kiosk CSP is `img-src 'self' data:`, so the tile can never
// load ESPN's remote logo URLs directly. Instead each team side carries a LOCAL
// path (`api/sports/logo/<key>`) and the fetcher downloads+caches the PNG bytes
// to `logosDir` on the box (createSportsFetcher → cacheLogos), served back from
// our own origin by the /api/sports/logo/:id route in app.js. Mirrors the
// recipe-photo cache (pinch), only here THIS process does the download since it
// already talks to ESPN.

import { createHash } from 'node:crypto';
import { mkdir, writeFile, rename, access } from 'node:fs/promises';
import { join } from 'node:path';

const WINDOW_MS = 14 * 24 * 60 * 60_000;

// Logos are only ever fetched from ESPN's own CDN. Pinning the host closes the
// SSRF surface: a tampered/compromised scoreboard payload can't steer the
// server into fetching an arbitrary (e.g. internal) URL — a non-ESPN logo URL
// is refused and the tile just shows the team abbreviation instead.
function isEspnCdnUrl(url) {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'https:' && (hostname === 'a.espncdn.com' || hostname.endsWith('.espncdn.com'));
  } catch {
    return false;
  }
}

// A stable, opaque cache key for a logo URL: sha1 hex (40 chars of [0-9a-f]),
// which satisfies the serving route's id whitelist and never collides across
// distinct URLs. Derived purely from the URL so parse (which builds the local
// path) and the cacher (which names the file) agree without extra plumbing.
export function logoKey(url) {
  return createHash('sha1').update(String(url)).digest('hex');
}

// Pull the games an ESPN scoreboard payload describes, flattened to the shape
// the tile renders. Only events involving `abbr` are kept, and only those
// within `windowMs` of `now`. Pure — no network, no clock of its own.
export function parseScoreboard(json, abbr, now, windowMs = WINDOW_MS) {
  const events = Array.isArray(json?.events) ? json.events : [];
  const target = String(abbr).toUpperCase();
  // Scoreboard-level league label ("WNBA", "FIFA World Cup 2026"): the Apple
  // layout shows it above the matchup. Prefer the short abbreviation, fall back
  // to the full name, else null (the tile just omits the label).
  const league = json?.leagues?.[0]?.abbreviation || json?.leagues?.[0]?.name || null;
  const games = [];
  for (const event of events) {
    const comp = event?.competitions?.[0];
    const competitors = comp?.competitors;
    if (!Array.isArray(competitors) || competitors.length < 2) continue;

    // Away/home are resolved by ESPN's per-competitor `homeAway` flag, never by
    // array position: the competitors array order is not contract, so keying off
    // it would sometimes swap the sides. The snapshot therefore always carries a
    // true away/home, and the tile renders away-left/home-right off that. A game
    // whose competitors lack a clear home+away pair is skipped (fail-safe: an
    // ambiguous feed is never guessed into a wrong order). See the
    // "keys away/home off the homeAway flag" test.
    const home = competitors.find((t) => t.homeAway === 'home');
    const away = competitors.find((t) => t.homeAway === 'away');
    if (!home || !away) continue;

    const abbrs = [home, away].map((t) => (t.team?.abbreviation || '').toUpperCase());
    if (!abbrs.includes(target)) continue;

    const when = Date.parse(event.date);
    if (!Number.isNaN(when) && Math.abs(when - now.getTime()) > windowMs) continue;

    const status = event?.status ?? comp?.status;
    games.push({
      id: String(event.id ?? `${abbrs.join('-')}-${event.date}`),
      date: event.date ?? null,
      league,
      away: teamSide(away),
      home: teamSide(home),
      // ESPN's status.type: 'pre' | 'in' | 'post'. state drives whether the
      // tile shows a tip time, a live clock, or a final.
      state: status?.type?.state ?? 'pre',
      // shortDetail is the compact human label ESPN already formats:
      // "Sat 7:30 PM", "Q3 4:12", "Final", "Final/OT". The tile uses it for the
      // live/final center column; upcoming formats its own time/date from `date`
      // so the wall shows the household's local clock, not ESPN's venue zone.
      detail: status?.type?.shortDetail ?? status?.type?.description ?? '',
    });
  }
  return games;
}

function teamSide(competitor) {
  const score = competitor.score;
  // ESPN's team.logo is a remote PNG URL on a.espncdn.com. The tile can't load
  // it (CSP), so expose a local path keyed by the URL; `logoUrl` is kept for the
  // cacher to download and is harmless provenance in the API body.
  const logoUrl = competitor.team?.logo || null;
  return {
    abbr: (competitor.team?.abbreviation || '').toUpperCase(),
    // Score is a string pre-game ("0") or absent; coerce to a number when it
    // parses, else null so the tile can omit it before tip-off.
    score: score === undefined || score === null || score === '' ? null : Number(score),
    logo: logoUrl ? `api/sports/logo/${logoKey(logoUrl)}` : null,
    logoUrl,
  };
}

async function fetchScoreboard({ sport, league }, fetchImpl) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard`;
  const res = await fetchImpl(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`sports upstream HTTP ${res.status} (${url})`);
  return res.json();
}

// Fetch every followed team's scoreboard, skipping any feed that fails, and
// return up to `limit` upcoming/live games sorted by date. `teams` is a list of
// { abbr, sport, league }. An empty list yields [] — the tile shows
// "No upcoming games". Duplicate games (two followed teams meeting) collapse by
// event id.
export async function fetchSports(
  teams,
  { now = new Date(), limit = 3, windowMs = WINDOW_MS, fetchImpl = fetch } = {},
) {
  const seen = new Map();
  for (const team of teams ?? []) {
    try {
      const json = await fetchScoreboard(team, fetchImpl);
      for (const game of parseScoreboard(json, team.abbr, now, windowMs)) {
        if (!seen.has(game.id)) seen.set(game.id, game);
      }
    } catch (err) {
      // One bad feed is skipped, not fatal.
      console.warn(`sports feed ${team.sport}/${team.league} (${team.abbr}) failed: ${err.message}`);
    }
  }
  return [...seen.values()]
    .sort((a, b) => Date.parse(a.date ?? 0) - Date.parse(b.date ?? 0))
    .slice(0, limit);
}

// Download the logos a snapshot references into `logosDir`, skipping any already
// cached (keys are content-stable, so a present file is never stale). A logo
// that is never cached — whether skipped here (bad download, non-ESPN URL) or
// still warming up before the first refresh completes — just renders as the
// tile's abbreviation: the <img> onError swaps to the abbr, so a cache miss is
// never a broken-image glyph. A `.type` sidecar records the served content-type
// so the route can label the bytes without sniffing.
//
// Writes are atomic (temp file + rename): a crash mid-download can leave a
// stray `.tmp`, never a truncated logo pinned under a content-stable key that
// would otherwise be trusted forever.
export async function cacheLogos(games, { logosDir, fetchImpl = fetch } = {}) {
  if (!logosDir || !Array.isArray(games) || games.length === 0) return;
  const wanted = new Map(); // key -> remote url
  for (const game of games) {
    for (const side of [game.away, game.home]) {
      if (side?.logoUrl) wanted.set(logoKey(side.logoUrl), side.logoUrl);
    }
  }
  if (wanted.size === 0) return;
  await mkdir(logosDir, { recursive: true });
  for (const [key, url] of wanted) {
    const file = join(logosDir, key);
    try {
      await access(file);
      continue; // already cached
    } catch {
      // not cached yet — fall through and fetch it
    }
    // SSRF guard: only ESPN's CDN is ever a valid logo source.
    if (!isEspnCdnUrl(url)) {
      console.warn(`sports logo cache: refusing non-ESPN URL ${url}`);
      continue;
    }
    try {
      const res = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        console.warn(`sports logo cache: HTTP ${res.status} for ${url}`);
        continue;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      await writeAtomic(file, buffer);
      const type = res.headers?.get?.('content-type');
      if (type) await writeAtomic(`${file}.type`, type);
    } catch (err) {
      console.warn(`sports logo cache failed (${url}): ${err.message}`);
    }
  }
}

// Drop the server-only `logoUrl` from each team side so the client payload
// carries only the CSP-safe local `logo` path.
function stripLogoUrl(game) {
  const clean = (side) => ({ abbr: side.abbr, score: side.score, logo: side.logo });
  return { ...game, away: clean(game.away), home: clean(game.home) };
}

// Publish a file atomically: write a `.tmp` sibling, then rename it into place.
// rename(2) within a dir is atomic, so a reader (the serving route) only ever
// sees the complete file or no file — never a half-written one.
async function writeAtomic(file, data) {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}

// Single-slot cache + background refresh, mirroring createWeatherFetcher().
// get() returns the freshest snapshot ([] once primed with no games, null
// before the first fetch lands). A failed refresh keeps the last good snapshot.
// `logosDir`, when set, is where each refresh downloads+caches team logos; the
// route serves them from there. Exposed as .logosDir so app.js can mount the
// serving route against the same directory.
export function createSportsFetcher({
  teams = [],
  refreshMs = 10 * 60_000,
  limit = 3,
  logosDir = null,
  fetchImpl = fetch,
  setIntervalImpl = setInterval,
} = {}) {
  let snapshot = null;
  const refresh = async () => {
    try {
      const games = await fetchSports(teams, { limit, fetchImpl });
      // Cache first (needs logoUrl), then drop logoUrl so it never reaches the
      // client: the tile only ever uses the local `logo` path, and the remote
      // ESPN URL is server-only provenance.
      await cacheLogos(games, { logosDir, fetchImpl });
      snapshot = games.map(stripLogoUrl);
    } catch (err) {
      console.warn(`sports refresh failed: ${err.message}`);
    }
    return snapshot;
  };
  const primed = refresh();
  const timer = setIntervalImpl(refresh, refreshMs);
  if (timer && typeof timer.unref === 'function') timer.unref();
  return {
    get: () => snapshot,
    ready: () => primed,
    refresh,
    logosDir,
  };
}

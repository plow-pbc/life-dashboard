import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseScoreboard,
  fetchSports,
  createSportsFetcher,
  cacheLogos,
  logoKey,
} from './sports.js';

const NOW = new Date('2026-10-15T12:00:00Z');

// A minimal ESPN-shaped scoreboard: one live game SF@SEA. `leagues` carries the
// scoreboard-level label the tile shows above the matchup.
function scoreboard(events, leagues = [{ abbreviation: 'NFL' }]) {
  return { events, leagues };
}

function event({
  id = '1',
  date = '2026-10-15T20:00Z',
  away = { abbr: 'SF', score: '14' },
  home = { abbr: 'SEA', score: '10' },
  state = 'in',
  shortDetail = 'Q2 7:30',
  // ESPN does not guarantee a competitor order; `order` lets a test put the
  // away competitor first in the array to prove parse keys off homeAway, not
  // position. Default 'home-first' matches ESPN's common ordering.
  order = 'home-first',
}) {
  const logo = (t) => (t.logo === undefined ? `https://a.espncdn.com/${t.abbr}.png` : t.logo);
  const homeC = { homeAway: 'home', team: { abbreviation: home.abbr, logo: logo(home) }, score: home.score };
  const awayC = { homeAway: 'away', team: { abbreviation: away.abbr, logo: logo(away) }, score: away.score };
  return {
    id,
    date,
    status: { type: { state, shortDetail } },
    competitions: [
      { competitors: order === 'away-first' ? [awayC, homeC] : [homeC, awayC] },
    ],
  };
}

describe('parseScoreboard', () => {
  it('keeps games the target team is in, flattened to the tile shape', () => {
    const games = parseScoreboard(scoreboard([event({})]), 'SF', NOW);
    expect(games).toHaveLength(1);
    expect(games[0]).toMatchObject({
      id: '1',
      away: { abbr: 'SF', score: 14 },
      home: { abbr: 'SEA', score: 10 },
      state: 'in',
      detail: 'Q2 7:30',
    });
  });

  it('matches the team regardless of abbreviation case', () => {
    expect(parseScoreboard(scoreboard([event({})]), 'sf', NOW)).toHaveLength(1);
  });

  it('keys away/home off the homeAway flag, NOT competitor array order', () => {
    // Same game, two array orders. Away (SF) is first in one, second in the
    // other; the parsed shape must be identical — away-is-SF, home-is-SEA — so
    // the tile always renders away-left/home-right. Covers live + scheduled.
    for (const state of ['in', 'pre', 'post']) {
      const homeFirst = parseScoreboard(scoreboard([event({ state, order: 'home-first' })]), 'SF', NOW)[0];
      const awayFirst = parseScoreboard(scoreboard([event({ state, order: 'away-first' })]), 'SF', NOW)[0];
      expect(awayFirst.away.abbr).toBe('SF'); // away-first in the array, still the away side
      expect(awayFirst.home.abbr).toBe('SEA');
      expect(awayFirst.away.score).toBe(14);
      expect(awayFirst.home.score).toBe(10);
      // Array order must not change a single field of the parsed game.
      expect(awayFirst).toEqual(homeFirst);
    }
  });

  it('drops games the team is not in', () => {
    expect(parseScoreboard(scoreboard([event({})]), 'LAR', NOW)).toHaveLength(0);
  });

  it('nulls a missing/empty pre-game score', () => {
    const g = parseScoreboard(
      scoreboard([event({ state: 'pre', shortDetail: 'Sat 7:30 PM', away: { abbr: 'SF', score: '' }, home: { abbr: 'SEA', score: undefined } })]),
      'SF',
      NOW,
    );
    expect(g[0].away.score).toBeNull();
    expect(g[0].home.score).toBeNull();
  });

  it('excludes games outside the ~14-day window', () => {
    const far = event({ id: '2', date: '2026-12-25T20:00Z' });
    expect(parseScoreboard(scoreboard([far]), 'SF', NOW)).toHaveLength(0);
  });

  it('tolerates malformed events without throwing', () => {
    const junk = scoreboard([{}, { competitions: [{}] }, { competitions: [{ competitors: [] }] }]);
    expect(parseScoreboard(junk, 'SF', NOW)).toEqual([]);
  });

  it('returns [] when the payload has no events array', () => {
    expect(parseScoreboard({}, 'SF', NOW)).toEqual([]);
  });

  it('exposes a CSP-safe local logo path keyed by the remote URL, plus the source URL', () => {
    const g = parseScoreboard(scoreboard([event({})]), 'SF', NOW)[0];
    const url = 'https://a.espncdn.com/SF.png';
    expect(g.away.logo).toBe(`api/sports/logo/${logoKey(url)}`);
    expect(g.away.logoUrl).toBe(url);
    // The local path is same-origin (no scheme/host) so the kiosk CSP allows it.
    expect(g.away.logo).not.toMatch(/^https?:/);
  });

  it('nulls the logo when the team has none', () => {
    const g = parseScoreboard(
      scoreboard([event({ away: { abbr: 'SF', score: '1', logo: null } })]),
      'SF',
      NOW,
    )[0];
    expect(g.away.logo).toBeNull();
    expect(g.away.logoUrl).toBeNull();
  });

  it('carries the scoreboard league label on each game', () => {
    const g = parseScoreboard(scoreboard([event({})], [{ abbreviation: 'WNBA' }]), 'SF', NOW)[0];
    expect(g.league).toBe('WNBA');
  });

  it('falls back to the league name, else null', () => {
    expect(parseScoreboard(scoreboard([event({})], [{ name: 'FIFA World Cup 2026' }]), 'SF', NOW)[0].league).toBe(
      'FIFA World Cup 2026',
    );
    expect(parseScoreboard(scoreboard([event({})], []), 'SF', NOW)[0].league).toBeNull();
  });
});

describe('logoKey', () => {
  it('is stable and distinct per URL (sha1 hex, route-id-safe)', () => {
    const a = logoKey('https://a.espncdn.com/SF.png');
    expect(a).toMatch(/^[0-9a-f]{40}$/);
    expect(logoKey('https://a.espncdn.com/SF.png')).toBe(a);
    expect(logoKey('https://a.espncdn.com/SEA.png')).not.toBe(a);
  });
});

describe('cacheLogos', () => {
  async function tmpDir() {
    return mkdtemp(join(tmpdir(), 'sports-logos-'));
  }
  const pngRes = (bytes = [0x89, 0x50, 0x4e, 0x47]) => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => Uint8Array.from(bytes).buffer,
    headers: { get: () => 'image/png' },
  });

  it('downloads each referenced logo into logosDir under its key, with a type sidecar', async () => {
    const logosDir = await tmpDir();
    const games = parseScoreboard(scoreboard([event({})]), 'SF', NOW);
    const fetchImpl = vi.fn(async () => pngRes());
    await cacheLogos(games, { logosDir, fetchImpl });

    const awayKey = logoKey('https://a.espncdn.com/SF.png');
    expect(Buffer.from(await readFile(join(logosDir, awayKey)))).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(await readFile(join(logosDir, `${awayKey}.type`), 'utf8')).toBe('image/png');
    // Both teams' logos fetched; none twice.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('skips a logo already cached on disk (no refetch)', async () => {
    const logosDir = await tmpDir();
    const games = parseScoreboard(scoreboard([event({})]), 'SF', NOW);
    await mkdir(logosDir, { recursive: true });
    // Pre-seed both logos so the cacher finds them present.
    for (const side of [games[0].away, games[0].home]) {
      await writeFile(join(logosDir, logoKey(side.logoUrl)), 'cached');
    }
    const fetchImpl = vi.fn(async () => pngRes());
    await cacheLogos(games, { logosDir, fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('skips a failed download without throwing (tile falls back to the abbr)', async () => {
    const logosDir = await tmpDir();
    const games = parseScoreboard(scoreboard([event({})]), 'SF', NOW);
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 503 }));
    await expect(cacheLogos(games, { logosDir, fetchImpl })).resolves.toBeUndefined();
  });

  it('is a no-op with no logosDir', async () => {
    const fetchImpl = vi.fn();
    await cacheLogos(parseScoreboard(scoreboard([event({})]), 'SF', NOW), { fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('writes atomically — no leftover .tmp, only the final files', async () => {
    const logosDir = await tmpDir();
    const games = parseScoreboard(scoreboard([event({})]), 'SF', NOW);
    await cacheLogos(games, { logosDir, fetchImpl: vi.fn(async () => pngRes()) });
    const files = await readdir(logosDir);
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false);
    // Two logos + their two .type sidecars, nothing half-written.
    expect(files.filter((f) => !f.endsWith('.type')).length).toBe(2);
    expect(files.filter((f) => f.endsWith('.type')).length).toBe(2);
  });

  it('refuses a non-ESPN logo URL (SSRF guard) but still caches the ESPN one', async () => {
    const logosDir = await tmpDir();
    const games = parseScoreboard(
      scoreboard([
        event({ away: { abbr: 'SF', score: '1', logo: 'http://169.254.169.254/latest/meta-data' } }),
      ]),
      'SF',
      NOW,
    );
    const fetchImpl = vi.fn(async () => pngRes());
    await cacheLogos(games, { logosDir, fetchImpl });
    // Only the home side's ESPN URL is fetched; the metadata-service URL is refused.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith('https://a.espncdn.com/SEA.png', expect.anything());
  });
});

describe('fetchSports', () => {
  it('returns [] for an empty followed-teams list (no fetch)', async () => {
    const fetchImpl = vi.fn();
    expect(await fetchSports([], { now: NOW, fetchImpl })).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('aggregates games across feeds and caps at the limit, sorted by date', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes('/nfl/')) {
        return json(scoreboard([
          event({ id: 'a', date: '2026-10-16T20:00Z' }),
          event({ id: 'b', date: '2026-10-15T20:00Z' }),
        ]));
      }
      return json(scoreboard([event({ id: 'c', date: '2026-10-17T20:00Z', away: { abbr: 'GS', score: '0' }, home: { abbr: 'LAL', score: '0' } })]));
    });
    const games = await fetchSports(
      [
        { abbr: 'SF', sport: 'football', league: 'nfl' },
        { abbr: 'GS', sport: 'basketball', league: 'nba' },
      ],
      { now: NOW, limit: 3, fetchImpl },
    );
    expect(games.map((g) => g.id)).toEqual(['b', 'a', 'c']);
  });

  it('skips one bad feed without failing the others', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes('/nfl/')) return { ok: false, status: 503 };
      return json(scoreboard([event({ id: 'c', away: { abbr: 'GS', score: '1' }, home: { abbr: 'LAL', score: '2' } })]));
    });
    const games = await fetchSports(
      [
        { abbr: 'SF', sport: 'football', league: 'nfl' },
        { abbr: 'GS', sport: 'basketball', league: 'nba' },
      ],
      { now: NOW, fetchImpl },
    );
    expect(games.map((g) => g.id)).toEqual(['c']);
  });

  it('collapses a duplicate game two followed teams share', async () => {
    const shared = event({ id: 'dup', away: { abbr: 'SF', score: '3' }, home: { abbr: 'GS', score: '4' } });
    const fetchImpl = vi.fn(async () => json(scoreboard([shared])));
    const games = await fetchSports(
      [
        { abbr: 'SF', sport: 'a', league: 'x' },
        { abbr: 'GS', sport: 'b', league: 'y' },
      ],
      { now: NOW, fetchImpl },
    );
    expect(games).toHaveLength(1);
  });
});

describe('createSportsFetcher', () => {
  it('primes an empty list to [] (not null) so the tile can say "No upcoming games"', async () => {
    const store = createSportsFetcher({
      teams: [],
      fetchImpl: vi.fn(),
      setIntervalImpl: () => ({ unref() {} }),
    });
    expect(store.get()).toBeNull();
    await store.ready();
    expect(store.get()).toEqual([]);
  });

  it('serves fetched games from get() after priming', async () => {
    const fetchImpl = vi.fn(async () => json(scoreboard([event({ id: 'a' })])));
    const store = createSportsFetcher({
      teams: [{ abbr: 'SF', sport: 'football', league: 'nfl' }],
      fetchImpl,
      setIntervalImpl: () => ({ unref() {} }),
    });
    await store.ready();
    expect(store.get()).toHaveLength(1);
  });

  it('strips the server-only logoUrl from the served snapshot, keeping the local logo path', async () => {
    const fetchImpl = vi.fn(async () => json(scoreboard([event({ id: 'a' })])));
    const store = createSportsFetcher({
      teams: [{ abbr: 'SF', sport: 'football', league: 'nfl' }],
      fetchImpl,
      setIntervalImpl: () => ({ unref() {} }),
    });
    await store.ready();
    const g = store.get()[0];
    expect(g.away).not.toHaveProperty('logoUrl');
    expect(g.home).not.toHaveProperty('logoUrl');
    expect(g.away.logo).toMatch(/^api\/sports\/logo\//);
  });
});

function json(body) {
  return { ok: true, status: 200, json: async () => body };
}

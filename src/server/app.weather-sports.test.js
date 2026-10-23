import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app.js';

// Route-level coverage for the two self-fetching data tiles. The upstream
// fetch + parse are tested in weather.test.js / sports.test.js; here we only
// assert the /api/weather + /api/sports wiring: a store snapshot is served,
// null snapshots 503, and an unconfigured (null) store leaves the route
// unmounted (so the loopback SPA catch-all behavior, not a JSON body).

function appWith(opts = {}) {
  return createApp({
    fetchUpstream: vi.fn(),
    listBanners: vi.fn(async () => []),
    getRemote: () => '127.0.0.1',
    ...opts,
  });
}

function storeOf(value) {
  return { get: () => value };
}

const weather = { temp: 72, unit: 'F', hi: 74, lo: 58, condition: 'Sunny', location: 'Mountain View' };

describe('GET /api/weather', () => {
  it('serves the cached snapshot', async () => {
    const res = await appWith({ weatherStore: storeOf(weather) }).fetch(
      new Request('http://localhost/api/weather'),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(weather);
  });

  it('503s before the first snapshot lands', async () => {
    const res = await appWith({ weatherStore: storeOf(null) }).fetch(
      new Request('http://localhost/api/weather'),
    );
    expect(res.status).toBe(503);
  });

  it('is not mounted when unconfigured (no JSON body)', async () => {
    const res = await appWith({}).fetch(new Request('http://localhost/api/weather'));
    // No route + no SPA catch-all in this bare app → 404.
    expect(res.status).toBe(404);
  });
});

describe('GET /api/sports', () => {
  it('serves the cached games under a games key', async () => {
    const games = [
      {
        id: '1',
        date: '2026-10-15T20:00Z',
        league: 'NFL',
        away: { abbr: 'SF', score: 14, logo: 'api/sports/logo/aaa' },
        home: { abbr: 'SEA', score: 10, logo: 'api/sports/logo/bbb' },
        state: 'in',
        detail: 'Q2 7:30',
      },
    ];
    const res = await appWith({ sportsStore: storeOf(games) }).fetch(
      new Request('http://localhost/api/sports'),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ games });
  });

  it('serves an empty list as { games: [] }', async () => {
    const res = await appWith({ sportsStore: storeOf([]) }).fetch(
      new Request('http://localhost/api/sports'),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ games: [] });
  });

  it('503s before the first snapshot lands', async () => {
    const res = await appWith({ sportsStore: storeOf(null) }).fetch(
      new Request('http://localhost/api/sports'),
    );
    expect(res.status).toBe(503);
  });
});

describe('GET /api/sports/logo/:id', () => {
  async function appWithLogos(seed) {
    const logosDir = await mkdtemp(join(tmpdir(), 'app-logos-'));
    for (const [name, body] of Object.entries(seed ?? {})) {
      await writeFile(join(logosDir, name), body);
    }
    const sportsStore = { get: () => [], logosDir };
    return { app: appWith({ sportsStore }), logosDir };
  }

  it('serves cached logo bytes from a self path with nosniff + an image type', async () => {
    const { app } = await appWithLogos({ abc123: Buffer.from([0x89, 0x50, 0x4e, 0x47]) });
    const res = await app.fetch(new Request('http://localhost/api/sports/logo/abc123'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  it('honors a whitelisted type sidecar', async () => {
    const { app } = await appWithLogos({ wk: Buffer.from('x'), 'wk.type': 'image/webp' });
    const res = await app.fetch(new Request('http://localhost/api/sports/logo/wk'));
    expect(res.headers.get('content-type')).toBe('image/webp');
  });

  it('rejects an id that could escape the logos dir', async () => {
    const { app } = await appWithLogos({});
    const res = await app.fetch(new Request('http://localhost/api/sports/logo/..%2Fsecret'));
    expect(res.status).toBe(400);
  });

  it('404s a logo not yet cached', async () => {
    const { app } = await appWithLogos({});
    const res = await app.fetch(new Request('http://localhost/api/sports/logo/missing'));
    expect(res.status).toBe(404);
  });

  it('is not mounted when the store has no logosDir', async () => {
    const res = await appWith({ sportsStore: storeOf([]) }).fetch(
      new Request('http://localhost/api/sports/logo/anything'),
    );
    expect(res.status).toBe(404);
  });
});

describe('GET /api/affirmation', () => {
  async function affirmFile(contents) {
    const dir = await mkdtemp(join(tmpdir(), 'app-affirm-'));
    const path = join(dir, 'affirmation.json');
    if (contents !== undefined) await writeFile(path, contents);
    return path;
  }

  it('serves the file live as { message } (card-2 affirmation shape)', async () => {
    const affirmationFile = await affirmFile(JSON.stringify({ text: 'A soft week.', date: 'Oct 22' }));
    const res = await appWith({ affirmationFile }).fetch(new Request('http://localhost/api/affirmation'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      message: { card: '2', type: 'affirmation', text: 'A soft week.', date: 'Oct 22' },
    });
  });

  it('serves { message: null } when no line has been delivered yet (absent file)', async () => {
    const affirmationFile = await affirmFile(undefined);
    const res = await appWith({ affirmationFile }).fetch(new Request('http://localhost/api/affirmation'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: null });
  });

  it('is read LIVE per request (a fresh drop shows without a restart)', async () => {
    const affirmationFile = await affirmFile(JSON.stringify({ text: 'first', date: 'Oct 22' }));
    const app = appWith({ affirmationFile });
    const first = await (await app.fetch(new Request('http://localhost/api/affirmation'))).json();
    expect(first.message.text).toBe('first');
    await writeFile(affirmationFile, JSON.stringify({ text: 'second', date: 'Oct 23' }));
    const second = await (await app.fetch(new Request('http://localhost/api/affirmation'))).json();
    expect(second.message.text).toBe('second');
  });

  it('is not mounted when unconfigured (no affirmationFile)', async () => {
    const res = await appWith({}).fetch(new Request('http://localhost/api/affirmation'));
    expect(res.status).toBe(404);
  });
});

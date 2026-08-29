import os from 'node:os';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createApp } from './app.js';
import { createCardPoller } from './remote.js';
import { memStore } from '../../test/fixtures';

function appWith(fetcher, opts = {}) {
  return createApp({
    fetchUpstream: fetcher,
    listBanners: vi.fn(async () => []),
    getRemote: () => '127.0.0.1',
    ...opts,
  });
}

const validFeed = {
  generated_at: '2026-08-29T04:00:00Z',
  window_days: 7,
  events: [
    {
      uid: 'event-1',
      title: 'Dinner',
      start: '2026-08-29T18:00:00-07:00',
      end: '2026-08-29T19:00:00-07:00',
      isAllDay: false,
      location: null,
      calendar: null,
    },
  ],
};

function documentStore(initial = null) {
  let document = initial;
  return {
    get: async () => document,
    replace: async (next) => {
      document = next;
    },
  };
}

function calendarApp({
  store = documentStore(),
  token = 'tok',
  remote = '127.0.0.1',
  readOnly = false,
} = {}) {
  return appWith(vi.fn(), {
    calendarStore: store,
    messageToken: token,
    messageReadOnly: readOnly,
    getRemote: () => remote,
  });
}

describe('/api/calendar routes', () => {
  it('accepts a valid feed and GET returns the replacement document', async () => {
    const app = calendarApp();
    const post = await app.fetch(
      new Request('http://localhost/api/calendar', {
        method: 'POST',
        headers: auth(),
        body: JSON.stringify(validFeed),
      }),
    );
    expect(post.status).toBe(200);

    const get = await app.fetch(new Request('http://localhost/api/calendar'));
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual(validFeed);
  });

  it('accepts date-only all-day events and a calendar identifier', async () => {
    const body = {
      ...validFeed,
      events: [
        {
          ...validFeed.events[0],
          start: '2026-08-30',
          end: '2026-08-31',
          isAllDay: true,
          calendar: 'family@example.com',
        },
      ],
    };
    const res = await calendarApp().fetch(
      new Request('http://localhost/api/calendar', {
        method: 'POST',
        headers: auth(),
        body: JSON.stringify(body),
      }),
    );
    expect(res.status).toBe(200);
  });

  it.each([
    null,
    {},
    { ...validFeed, generated_at: 'yesterday' },
    { ...validFeed, generated_at: '2026-02-31T04:00:00Z' },
    { ...validFeed, window_days: 0 },
    { ...validFeed, events: [{ ...validFeed.events[0], start: 'not-a-time' }] },
    { ...validFeed, events: [{ ...validFeed.events[0], location: 42 }] },
    { ...validFeed, events: [{ ...validFeed.events[0], attendee: 'private' }] },
    'not json',
  ])('rejects invalid feed %j with 422', async (body) => {
    const res = await calendarApp().fetch(
      new Request('http://localhost/api/calendar', {
        method: 'POST',
        headers: auth(),
        body: body === 'not json' ? body : JSON.stringify(body),
      }),
    );
    expect(res.status).toBe(422);
  });

  it('requires the bearer for POST', async () => {
    const res = await calendarApp().fetch(
      new Request('http://localhost/api/calendar', {
        method: 'POST',
        body: JSON.stringify(validFeed),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('returns 404 before a feed has been pushed', async () => {
    const res = await calendarApp().fetch(new Request('http://localhost/api/calendar'));
    expect(res.status).toBe(404);
  });

  it('does not mount without the dashboard token', async () => {
    const res = await calendarApp({ token: '' }).fetch(
      new Request('http://localhost/api/calendar', {
        method: 'POST',
        body: JSON.stringify(validFeed),
      }),
    );
    expect(res.status).toBe(404);
  });

  it('does not mount GET in paired mode', async () => {
    const res = await calendarApp({ store: documentStore(validFeed), readOnly: true }).fetch(
      new Request('http://localhost/api/calendar'),
    );
    expect(res.status).toBe(404);
  });

  it.each(['PUT', 'PATCH', 'DELETE'])('%s returns 405', async (method) => {
    const res = await calendarApp().fetch(
      new Request('http://localhost/api/calendar', { method, headers: auth() }),
    );
    expect(res.status).toBe(405);
  });

  it('allows a remote POST with the bearer but keeps GET loopback-only', async () => {
    const app = calendarApp({ remote: '192.168.1.50' });
    const post = await app.fetch(
      new Request('http://pi-host/api/calendar', {
        method: 'POST',
        headers: auth(),
        body: JSON.stringify(validFeed),
      }),
    );
    expect(post.status).toBe(200);

    const get = await app.fetch(new Request('http://pi-host/api/calendar', { headers: auth() }));
    expect(get.status).toBe(403);
  });
});

describe('createApp', () => {
  it('healthz returns 200 ok', async () => {
    const app = appWith(vi.fn());
    const res = await app.fetch(new Request('http://localhost/healthz'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  describe('/api/ical cache lifecycle', () => {
    const url = 'http://localhost/api/ical';

    it('fetches upstream on first call and sets content-type', async () => {
      const fetcher = vi.fn().mockResolvedValue('FRESH');
      const app = appWith(fetcher);
      const res = await app.fetch(new Request(url));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/calendar');
      expect(await res.text()).toBe('FRESH');
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('serves cached body within ttl', async () => {
      const fetcher = vi.fn().mockResolvedValue('CACHED');
      let t = 1_000_000;
      const app = appWith(fetcher, { ttlMs: 60_000, now: () => t });
      await app.fetch(new Request(url));
      t += 30_000;
      const res = await app.fetch(new Request(url));
      expect(await res.text()).toBe('CACHED');
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('refetches after ttl expires', async () => {
      const fetcher = vi.fn().mockResolvedValueOnce('FIRST').mockResolvedValueOnce('SECOND');
      let t = 1_000_000;
      const app = appWith(fetcher, { ttlMs: 60_000, now: () => t });
      await app.fetch(new Request(url));
      t += 90_000;
      const res = await app.fetch(new Request(url));
      expect(await res.text()).toBe('SECOND');
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('serves stale cache when upstream fails after ttl', async () => {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce('GOOD')
        .mockRejectedValueOnce(new Error('network down'));
      let t = 1_000_000;
      const app = appWith(fetcher, { ttlMs: 60_000, now: () => t });
      await app.fetch(new Request(url));
      t += 90_000;
      const res = await app.fetch(new Request(url));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('GOOD');
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('rejects non-loopback Host header', async () => {
      const fetcher = vi.fn().mockResolvedValue('SECRET');
      const app = appWith(fetcher);
      const res = await app.fetch(new Request('http://evil.example/api/ical'));
      expect(res.status).toBe(403);
      expect(fetcher).not.toHaveBeenCalled();
    });
  });

  // Route-specific miss-behavior (the two routes diverge on what to do when
  // upstream fails AND the cache is empty).
  it('/api/ical returns 502 when upstream fails with no cache', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('network down'));
    const app = appWith(fetcher);
    const res = await app.fetch(new Request('http://localhost/api/ical'));
    expect(res.status).toBe(502);
  });

  describe('/api/banners', () => {
    it('returns the list returned by listBanners', async () => {
      const listBanners = vi.fn().mockResolvedValue(['a.png', 'b.png']);
      const app = createApp({ fetchUpstream: vi.fn(), listBanners, getRemote: () => '127.0.0.1' });
      const res = await app.fetch(new Request('http://localhost/api/banners'));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ banners: ['a.png', 'b.png'] });
    });

    it('passes through an empty list (no-banners deploy)', async () => {
      const listBanners = vi.fn().mockResolvedValue([]);
      const app = createApp({ fetchUpstream: vi.fn(), listBanners, getRemote: () => '127.0.0.1' });
      const res = await app.fetch(new Request('http://localhost/api/banners'));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ banners: [] });
    });
  });

  describe('/api/version', () => {
    it('serves /api/version from the injected stamp', async () => {
      const app = appWith(vi.fn(), {
        version: { sha: 'abc123', deployedAt: '2026-08-28T00:00:00Z' },
      });
      const res = await app.fetch(new Request('http://localhost/api/version'));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ sha: 'abc123', deployedAt: '2026-08-28T00:00:00Z' });
    });

    it('serves nulls when no stamp exists (dev)', async () => {
      const app = appWith(vi.fn());
      const res = await app.fetch(new Request('http://localhost/api/version'));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ sha: null, deployedAt: null });
    });
  });

  describe('host guard on /banners/*', () => {
    // The static file mount lives in server.js (outside createApp), but the
    // whole-surface guard covers every path so it runs before serveStatic
    // even reaches the request. This test confirms the guard blocks rebound
    // hosts at the same /banners/* path that server.js will mount.
    it('rejects non-loopback Host header at /banners/*', async () => {
      const app = createApp({ fetchUpstream: vi.fn(), getRemote: () => '127.0.0.1' });
      const res = await app.fetch(new Request('http://evil.example/banners/banner_1.png'));
      expect(res.status).toBe(403);
    });
  });

  describe("host guard allows this machine's own hostname", () => {
    // The allowed non-loopback host is derived from os.hostname(), so a kiosk
    // reaches its own /api and /banners with no per-host edit. An FQDN that is
    // not this machine's bare hostname is rejected.
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('routes the derived self hostname to /api/* instead of 403', async () => {
      vi.spyOn(os, 'hostname').mockReturnValue('rpi5mary');
      const fetcher = vi.fn().mockResolvedValue('FRESH');
      const app = appWith(fetcher);
      const res = await app.fetch(new Request('http://rpi5mary/api/ical'));
      expect(res.status).toBe(200);
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('does not reject the derived self hostname at /banners/*', async () => {
      vi.spyOn(os, 'hostname').mockReturnValue('rpi5mary');
      const app = appWith(vi.fn());
      const res = await app.fetch(new Request('http://rpi5mary/banners/banner_1.png'));
      // Static mount lives in server.js, so a passed guard falls through to
      // 404 here — the point is it is not 403'd by the host guard.
      expect(res.status).not.toBe(403);
    });

    it("rejects an FQDN that is not this machine's bare hostname", async () => {
      vi.spyOn(os, 'hostname').mockReturnValue('rpi5mary');
      const app = appWith(vi.fn());
      const res = await app.fetch(new Request('http://rpi5mary.tailnet.ts.net/api/ical'));
      expect(res.status).toBe(403);
    });
  });
});

const auth = (t = 'tok') => ({ Authorization: `Bearer ${t}` });
const NO_TOKEN = Symbol('no-token');
function msgApp({
  store = memStore(),
  token = 'tok',
  remote = '127.0.0.1',
  pinch,
  readOnly = false,
} = {}) {
  return createApp({
    fetchUpstream: vi.fn(),
    listBanners: vi.fn(async () => []),
    messageStore: store,
    messageReadOnly: readOnly,
    ...(token !== NO_TOKEN && { messageToken: token }),
    getRemote: () => remote,
    pinch,
  });
}

describe('/api/message routes', () => {
  it('GET from loopback needs no auth and returns the stored message', async () => {
    const app = msgApp({ store: memStore({ 1: { card: '1', type: 'alert', text: 'a' } }) });
    const res = await app.fetch(new Request('http://localhost/api/message?card=1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: { card: '1', type: 'alert', text: 'a' } });
  });

  it('GET without card returns null message', async () => {
    const res = await msgApp().fetch(new Request('http://localhost/api/message'));
    expect(await res.json()).toEqual({ message: null });
  });

  it('POST with valid bearer stores and echoes trimmed message', async () => {
    const store = memStore();
    const res = await msgApp({ store }).fetch(
      new Request('http://localhost/api/message', {
        method: 'POST',
        headers: auth(),
        body: JSON.stringify({ card: '2', type: 'message', text: ' hi ' }),
      }),
    );
    expect(res.status).toBe(200);
    expect(store._peek()['2']).toEqual({ card: '2', type: 'message', text: 'hi' });
  });

  it('stores an optional empty title (to hide the eyebrow)', async () => {
    // Absence-omits-title is already covered by the trimmed-message test above.
    const store = memStore();
    await msgApp({ store }).fetch(
      new Request('http://localhost/api/message', {
        method: 'POST',
        headers: auth(),
        body: JSON.stringify({ card: '2', type: 'affirmation', text: 'x', title: '' }),
      }),
    );
    expect(store._peek()['2']).toEqual({ card: '2', type: 'affirmation', text: 'x', title: '' });
  });

  it('POST with an inert probe card (e.g. __verify__) stores and GETs back by card', async () => {
    const store = memStore();
    const app = msgApp({ store });
    await app.fetch(
      new Request('http://localhost/api/message', {
        method: 'POST',
        headers: auth(),
        body: JSON.stringify({ card: '__verify__', type: 'plain', text: 'probe' }),
      }),
    );
    const res = await app.fetch(new Request('http://localhost/api/message?card=__verify__'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      message: { card: '__verify__', type: 'plain', text: 'probe' },
    });
  });

  it.each([
    [{ type: 'alert', text: 'no card' }],
    [{ card: '  ', type: 'alert', text: 'x' }],
    [{ card: '1', text: 'no type' }],
    [{ card: '1', type: '  ', text: 'x' }],
    [{ card: '1', type: 'alert' }],
    ['not json'],
  ])('POST rejects invalid body %j with 400', async (body) => {
    const res = await msgApp().fetch(
      new Request('http://localhost/api/message', {
        method: 'POST',
        headers: auth(),
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('POST rejects bad/missing bearer with 401 even from loopback', async () => {
    const res = await msgApp().fetch(
      new Request('http://localhost/api/message', {
        method: 'POST',
        headers: auth('wrong'),
        body: JSON.stringify({ card: '1', type: 'alert', text: 'x' }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('DELETE is 405', async () => {
    const res = await msgApp().fetch(
      new Request('http://localhost/api/message', { method: 'DELETE', headers: auth() }),
    );
    expect(res.status).toBe(405);
  });

  it('routes absent without messageToken', async () => {
    const app = msgApp({ token: NO_TOKEN });
    const res = await app.fetch(new Request('http://localhost/api/message'));
    expect(res.status).toBe(404);
  });
});

describe('remote store mode (KIOSK_REMOTE_URL)', () => {
  // The poller IS the message store in this mode; POST has nowhere to write.
  const remoteApp = (fetchCards) =>
    msgApp({ store: createCardPoller({ fetchCards, store: memStore() }), readOnly: true });

  it('POST is 405 even with the bearer — the store is upstream', async () => {
    const res = await remoteApp(async () => ({})).fetch(
      new Request('http://localhost/api/message', {
        method: 'POST',
        headers: auth(),
        body: JSON.stringify({ card: '1', type: 'alert', text: 'x' }),
      }),
    );
    expect(res.status).toBe(405);
  });

  it('GET serves a card through the poller, not just the underlying store', async () => {
    const fetchCards = vi.fn(async () => ({
      1: { card: '1', type: 'alert', text: 'polled' },
    }));
    const res = await remoteApp(fetchCards).fetch(
      new Request('http://localhost/api/message?card=1'),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: { card: '1', type: 'alert', text: 'polled' } });
    expect(fetchCards).toHaveBeenCalledTimes(1);
  });
});

describe('bearer check rejects empty/missing token config', () => {
  // When messageToken is falsy the bearerOk helper must return false regardless
  // of what the client sends — prevents an empty-token install accepting every request.
  it('POST with Authorization header is 401 when messageToken is empty string', async () => {
    const app = createApp({
      fetchUpstream: vi.fn(),
      listBanners: vi.fn(async () => []),
      messageStore: memStore(),
      messageToken: '',
      getRemote: () => '192.168.1.50',
    });
    const res = await app.fetch(
      new Request('http://pi-host/api/message', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' },
        body: JSON.stringify({ card: '1', type: 'alert', text: 'x' }),
      }),
    );
    // remoteGuard runs before routing and an empty token never authenticates.
    expect(res.status).toBe(401);
  });
});

describe('remote (non-loopback) access', () => {
  it('allows POST /api/message with bearer', async () => {
    const store = memStore();
    const res = await msgApp({ store, remote: '192.168.1.50' }).fetch(
      new Request('http://pi-host/api/message', {
        method: 'POST',
        headers: auth(),
        body: JSON.stringify({ card: '1', type: 'alert', text: 'remote' }),
      }),
    );
    expect(res.status).toBe(200);
  });

  it('rejects GET /api/message even with bearer — the remote surface is write-only', async () => {
    const res = await msgApp({ remote: '100.64.0.7' }).fetch(
      new Request('http://pi-host/api/message?card=1', { headers: auth() }),
    );
    expect(res.status).toBe(403);
  });

  it('allows GET /api/version with bearer — the deploy-verification read', async () => {
    const res = await msgApp({ remote: '100.64.0.7' }).fetch(
      new Request('http://pi-host/api/version', { headers: auth() }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sha: null, deployedAt: null });
  });

  it('rejects GET /api/version without bearer with 401', async () => {
    const res = await msgApp({ remote: '100.64.0.7' }).fetch(
      new Request('http://pi-host/api/version'),
    );
    expect(res.status).toBe(401);
  });

  it('sets the tile-containment CSP on every response, guard rejections included', async () => {
    const ok = await msgApp({}).fetch(new Request('http://localhost/api/version'));
    const csp = ok.headers.get('content-security-policy');
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    const denied = await msgApp({ remote: '100.64.0.7' }).fetch(
      new Request('http://pi-host/api/ical'),
    );
    expect(denied.status).toBe(403);
    expect(denied.headers.get('content-security-policy')).toBe(csp);
  });

  it('rejects POST without bearer with 401', async () => {
    const res = await msgApp({ remote: '192.168.1.50' }).fetch(
      new Request('http://pi-host/api/message', {
        method: 'POST',
        body: JSON.stringify({ card: '1', type: 'alert', text: 'x' }),
      }),
    );
    expect(res.status).toBe(401);
  });

  // Two deliberate choices here. Pinch is MOUNTED rather than listed as a bare
  // path — the wildcard guard 403s an unrouted path anyway, so an unmounted row
  // would pass without proving the recipe routes are covered. And the Host is an
  // ALLOWED one: `pi-host` is not in allowedHosts, so a future change routing
  // remote callers through the Host guard would make every row pass for the
  // wrong reason. An allowed Host removes that dependency and leaves
  // remoteGuard's private-path rejection as the only possible source of the 403.
  const PINCH = { store: { read: () => ({ recipes: [] }) }, photosDir: '/p' };

  it.each([
    '/api/ical',
    '/api/banners',
    '/api/pinch/collection',
    '/banners/x.png',
    '/',
    '/index.html',
  ])('rejects private path %s with 403 even with bearer', async (path) => {
    const res = await msgApp({ remote: '192.168.1.50', pinch: PINCH }).fetch(
      new Request(`http://localhost${path}`, { headers: auth() }),
    );
    expect(res.status).toBe(403);
  });

  it('allows /healthz from a remote address (unguarded liveness probe)', async () => {
    const res = await msgApp({ remote: '192.168.1.50' }).fetch(
      new Request('http://pi-host/healthz'),
    );
    expect(res.status).toBe(200);
  });
});

function bannerStoreMock() {
  return {
    save: vi.fn(async () => ({ stored: 'up_1700000000_x.jpg', upCount: 1 })),
    clear: vi.fn(async () => ({ removed: 2, upCount: 0 })),
  };
}
function banApp({ store = bannerStoreMock(), token = 'tok', remote = '127.0.0.1' } = {}) {
  return createApp({
    fetchUpstream: vi.fn(),
    listBanners: vi.fn(async () => []),
    bannerStore: store,
    ...(token !== NO_TOKEN && { messageToken: token }),
    getRemote: () => remote,
  });
}
const imgBody = (data = Buffer.from('img').toString('base64'), filename = 'p.jpg') =>
  JSON.stringify({ filename, data });

describe('/api/banners CRUD (texted-photo) routes', () => {
  it('POST with bearer validates+saves and echoes {stored, upCount}', async () => {
    const store = bannerStoreMock();
    const res = await banApp({ store }).fetch(
      new Request('http://localhost/api/banners', {
        method: 'POST',
        headers: auth(),
        body: imgBody(),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stored: 'up_1700000000_x.jpg', upCount: 1 });
    expect(store.save).toHaveBeenCalledTimes(1);
  });

  // Every mutation re-checks the bearer (the loopback path only runs the Host
  // guard, so the route is the sole auth there) — bad/missing/remote, no store call.
  it.each([
    {
      name: 'loopback POST, bad bearer',
      method: 'POST',
      headers: auth('wrong'),
      remote: '127.0.0.1',
      fn: 'save',
    },
    {
      name: 'loopback POST, no bearer',
      method: 'POST',
      headers: {},
      remote: '127.0.0.1',
      fn: 'save',
    },
    {
      name: 'loopback DELETE, no bearer',
      method: 'DELETE',
      headers: {},
      remote: '127.0.0.1',
      fn: 'clear',
    },
    {
      name: 'remote POST, no bearer',
      method: 'POST',
      headers: {},
      remote: '100.64.0.7',
      fn: 'save',
    },
  ])('mutation rejected — $name → 401, no store call', async ({ method, headers, remote, fn }) => {
    const store = bannerStoreMock();
    const res = await banApp({ store, remote }).fetch(
      new Request('http://localhost/api/banners', {
        method,
        headers,
        body: method === 'POST' ? imgBody() : undefined,
      }),
    );
    expect(res.status).toBe(401);
    expect(store[fn]).not.toHaveBeenCalled();
  });

  it('POST rejects a body with no image data (400)', async () => {
    const res = await banApp().fetch(
      new Request('http://localhost/api/banners', {
        method: 'POST',
        headers: auth(),
        body: JSON.stringify({ filename: 'p.jpg' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('POST rejects an oversized upload (413, before decode/save)', async () => {
    const store = bannerStoreMock();
    const huge = 'A'.repeat(21 * 1024 * 1024); // > the ~20MB base64/request ceiling
    const res = await banApp({ store }).fetch(
      new Request('http://localhost/api/banners', {
        method: 'POST',
        headers: auth(),
        body: imgBody(huge),
      }),
    );
    expect(res.status).toBe(413);
    expect(store.save).not.toHaveBeenCalled();
  });

  it('POST rejects an oversized streamed body with NO Content-Length (413, ceiling not CL)', async () => {
    const store = bannerStoreMock();
    const chunk = new Uint8Array(1024 * 1024); // 1 MB
    const body = new ReadableStream({
      start(ctrl) {
        for (let i = 0; i < 21; i++) ctrl.enqueue(chunk); // 21 MB, no Content-Length
        ctrl.close();
      },
    });
    const res = await banApp({ store }).fetch(
      new Request('http://localhost/api/banners', {
        method: 'POST',
        headers: auth(),
        body,
        duplex: 'half',
      }),
    );
    expect(res.status).toBe(413);
    expect(store.save).not.toHaveBeenCalled(); // never buffered/parsed the whole body
  });

  it('POST surfaces a 400 from the store (e.g. undecodable / HEIC)', async () => {
    const store = bannerStoreMock();
    store.save.mockRejectedValueOnce(
      Object.assign(new Error('not a decodable image'), { status: 400 }),
    );
    const res = await banApp({ store }).fetch(
      new Request('http://localhost/api/banners', {
        method: 'POST',
        headers: auth(),
        body: imgBody(),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('DELETE (clear) with bearer calls store.clear', async () => {
    const store = bannerStoreMock();
    const res = await banApp({ store }).fetch(
      new Request('http://localhost/api/banners', { method: 'DELETE', headers: auth() }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: 2, upCount: 0 });
    expect(store.clear).toHaveBeenCalledTimes(1);
  });

  it('a non-loopback PRODUCER may POST /api/banners with the bearer', async () => {
    const store = bannerStoreMock();
    const res = await banApp({ store, remote: '100.64.0.7' }).fetch(
      new Request('http://pi-host/api/banners', {
        method: 'POST',
        headers: auth(),
        body: imgBody(),
      }),
    );
    expect(res.status).toBe(200);
    expect(store.save).toHaveBeenCalledTimes(1);
  });
});

describe('/api/pinch mounting', () => {
  const pinch = {
    store: { read: () => ({ recipes: [{ id: 'a', title: 'Soup' }] }) },
    photosDir: '/p',
  };
  const url = 'http://localhost/api/pinch/collection';

  it('mounts the collection route when a recipe store is configured', async () => {
    const res = await appWith(vi.fn(), { pinch }).fetch(new Request(url));
    expect(res.status).toBe(200);
    expect((await res.json()).recipes).toEqual([{ id: 'a', title: 'Soup' }]);
  });

  // NB: this 404 is the BARE app's. In a real deploy server.js registers the
  // SPA catch-all after createApp returns, so an unconfigured install answers
  // this path with 200 text/html instead — the client must not treat "tile
  // disabled" as a status code.
  it('does not mount pinch routes when unconfigured', async () => {
    const res = await appWith(vi.fn()).fetch(new Request(url));
    expect(res.status).toBe(404);
  });

  // Registration ORDER is the property here, not the guard itself: pinch routes
  // are registered after the wildcard middleware, and registering them before it
  // would leave them unguarded. That is this repo's code, not the framework's,
  // so it keeps a test — the remote-access case folded into the private-path
  // table above, which covers the wildcard contract once for every path.
  it('applies the Host guard to pinch routes', async () => {
    const res = await appWith(vi.fn(), { pinch }).fetch(
      new Request('http://evil.example/api/pinch/collection'),
    );
    expect(res.status).toBe(403);
  });
});

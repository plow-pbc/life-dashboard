import os from 'node:os';
import { createHash, timingSafeEqual } from 'node:crypto';
import { getConnInfo } from '@hono/node-server/conninfo';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { registerPinchRoutes } from './pinch/routes.js';

const defaultGetRemote = (c) => getConnInfo(c).remote.address;
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

// Upload size ceiling for POST /api/banners. The image arrives base64-encoded
// in a JSON envelope; hono's bodyLimit caps the whole request (a missing/lying
// Content-Length can't force unbounded buffering — it counts bytes as it reads)
// so the decoded buffer can never exceed MAX_IMAGE_BYTES.
const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // 15 MB decoded
const MAX_B64_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 1024; // ~4/3 + slack
const MAX_REQUEST_BYTES = MAX_B64_CHARS + 4096; // + the small JSON envelope

export function createApp({
  fetchUpstream,
  listBanners,
  bannerStore,
  messageStore,
  messageToken,
  getRemote = defaultGetRemote,
  ttlMs = 60_000,
  now = Date.now,
  // Recipe tile backing store: { store, photosDir }, or null when no recipe
  // snapshot is configured — then /api/pinch/* never mounts and the install
  // behaves exactly as it did before the tile existed. A non-null pinch missing
  // either key is fatal at wiring time, not a quiet disable.
  pinch = null,
  // Deploy stamp written by the updater at flip time ({ sha, deployedAt }), or
  // null in a dev tree — the route then serves nulls rather than 404 so the
  // agent's verify loop can always distinguish "unstamped" from "unreachable".
  version = null,
}) {
  const app = new Hono();

  // Deliberately unguarded: /healthz is a liveness probe open to all callers.
  app.get('/healthz', (c) => c.text('ok'));

  // DNS-rebinding guard: even with the loopback bind, a browser tab on this
  // box loading an attacker site that rebinds DNS to 127.0.0.1 would reach us
  // with a non-loopback Host header. Reject those before any route runs —
  // banner images can be private (family photos), so the whole surface gets
  // the same protection. (Use the URL hostname, not the raw Host header —
  // Node's Request doesn't auto-populate Host in tests, but @hono/node-server
  // synthesizes the URL from the Host header on the wire, so this reads the
  // same source either way.)
  //
  // Allowed hosts are loopback plus this machine's own hostname (derived from
  // os.hostname()), so a kiosk reaches its own /api and /banners with no
  // per-host edit.
  const sha256 = (s) => createHash('sha256').update(s ?? '').digest();
  // Constant-time over digests: length-independent and no early-exit on prefix match.
  const bearerOk = (c) =>
    Boolean(messageToken) &&
    timingSafeEqual(sha256(c.req.header('authorization')), sha256(`Bearer ${messageToken}`));

  const selfHost = os.hostname().toLowerCase();
  const allowedHosts = new Set(['localhost', '127.0.0.1', selfHost]);
  const hostGuard = async (c, next) => {
    const host = new URL(c.req.url).hostname;
    if (!allowedHosts.has(host)) return c.text('forbidden', 403);
    await next();
  };

  // Non-loopback clients exist only to PRODUCE: with the household bearer they
  // may POST /api/message and POST/DELETE /api/banners (the texted-photo CRUD),
  // plus hit the earlier-registered /healthz liveness probe — and nothing else.
  // Reads, private data (calendar proxy, banner LISTING/serving), and the SPA
  // never leave loopback. Loopback callers go through the DNS-rebinding Host
  // guard for the whole surface, including the SPA mounts server.js adds later.
  const isProducerWrite = (c) =>
    (c.req.path === '/api/message' && c.req.method === 'POST') ||
    (c.req.path === '/api/banners' && (c.req.method === 'POST' || c.req.method === 'DELETE'));
  const remoteGuard = async (c, next) => {
    if (LOOPBACK.has(getRemote(c))) return hostGuard(c, next);
    if (!isProducerWrite(c)) return c.text('forbidden', 403);
    if (!bearerOk(c)) return c.text('unauthorized', 401);
    await next();
  };
  // Single wildcard covers every path including /banners/* and the SPA mounts
  // server.js registers on this app instance after createApp returns.
  app.use('*', remoteGuard);

  // /api/version: the agent's deploy-verification surface.
  app.get('/api/version', (c) =>
    c.json({ sha: version?.sha ?? null, deployedAt: version?.deployedAt ?? null }),
  );

  // /api/ical: proxies the upstream ICS with a single-slot 60s cache (stale-on-error).
  let cached = null;
  app.get('/api/ical', async (c) => {
    const t = now();
    if (cached && t - cached.fetchedAt < ttlMs) {
      return c.body(cached.body, 200, { 'content-type': 'text/calendar; charset=utf-8' });
    }
    try {
      const body = await fetchUpstream();
      cached = { body, fetchedAt: t };
      return c.body(body, 200, { 'content-type': 'text/calendar; charset=utf-8' });
    } catch {
      if (cached) return c.body(cached.body, 200, { 'content-type': 'text/calendar; charset=utf-8' });
      return c.text('Upstream unreachable', 502);
    }
  });

  // /api/banners: lists image filenames in the banner folder. Cheap fs read,
  // no upstream cache needed. The "no banners configured" case (missing
  // folder) is handled at the boundary in server.js by returning [] — so a
  // throw here is a genuine error and is allowed to surface as a 500 rather
  // than be masked as "no banners".
  app.get('/api/banners', async (c) => c.json({ banners: await listBanners() }));

  // /api/pinch/*: the Cook Tonight recipe tile's reads. Registered after the
  // wildcard guard above, so these inherit the loopback + Host restrictions
  // like every other read — a recipe library is household data.
  if (pinch) registerPinchRoutes(app, pinch);

  // The message store is local now (file-backed, injected) — no upstream, no
  // cache. GET is unauthenticated for loopback (the kiosk browser); the
  // remoteGuard above already gates non-loopback callers behind the bearer.
  if (messageToken && messageStore) {
    app.get('/api/message', async (c) => {
      const card = c.req.query('card');
      const message = card ? await messageStore.get(card) : null;
      return c.json({ message });
    });
    app.post('/api/message', async (c) => {
      if (!bearerOk(c)) return c.text('unauthorized', 401);
      const body = await c.req.json().catch(() => null);
      const card = typeof body?.card === 'string' ? body.card.trim() : '';
      if (!card) return c.text('card required', 400);
      const type = typeof body?.type === 'string' ? body.type.trim() : '';
      if (!type) return c.text('type required', 400);
      const text = typeof body?.text === 'string' ? body.text.trim() : '';
      if (!text) return c.text('text required', 400);
      // Optional producer-controlled eyebrow: a string (incl. '') is stored as
      // `title` so the producer can override or hide the card's title; absent
      // leaves it off the message and the viewer falls back to the type label.
      const message = typeof body?.title === 'string'
        ? { card, type, text, title: body.title.trim() }
        : { card, type, text };
      await messageStore.put(message);
      return c.json({ message });
    });
    app.on(['PUT', 'DELETE', 'PATCH'], '/api/message', (c) => c.text('method not allowed', 405));
  }

  // Texted-photo CRUD. GET /api/banners (the kiosk's loopback list) stays
  // above, unauthenticated for loopback. The MUTATIONS are bearer-gated (the
  // route re-checks even on the loopback path, where remoteGuard only ran the
  // Host guard) and act ONLY on the agent-uploaded `up_*` set — never the
  // curated `s2_*` family photos. Image processing lives in bannerStore.
  if (messageToken && bannerStore) {
    const tooBig = (c) => c.text('image too large', 413);
    app.post('/api/banners', bodyLimit({ maxSize: MAX_REQUEST_BYTES, onError: tooBig }), async (c) => {
      if (!bearerOk(c)) return c.text('unauthorized', 401);
      const body = await c.req.json().catch(() => null);
      const filename = typeof body?.filename === 'string' ? body.filename : '';
      const data = typeof body?.data === 'string' ? body.data : '';
      if (!data) return c.text('data (base64 image) required', 400);
      // bodyLimit already capped the request, so the decoded buffer is bounded.
      const buffer = Buffer.from(data, 'base64');
      try {
        return c.json(await bannerStore.save({ filename, buffer }));
      } catch (e) {
        return c.text(e.message || 'error', e.status || 500);
      }
    });
    app.delete('/api/banners', async (c) => {
      if (!bearerOk(c)) return c.text('unauthorized', 401);
      return c.json(await bannerStore.clear());
    });
  }

  return app;
}

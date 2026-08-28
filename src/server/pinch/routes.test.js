import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { describe, it, expect } from 'vitest';
import { registerPinchRoutes } from './routes.js';

const RECIPES = [{ id: 'a', title: 'Soup' }];

const fakeStore = () => ({ read: () => ({ recipes: RECIPES }) });

// `dirs` plants directory entries where a file is expected — the cheapest
// portable way to provoke a non-ENOENT read failure (EISDIR).
function appWith({ photos = {}, dirs = [], store = fakeStore() } = {}) {
  const photosDir = join(mkdtempSync(join(tmpdir(), 'pinch-routes-')), 'photos');
  mkdirSync(photosDir, { recursive: true });
  for (const [name, body] of Object.entries(photos)) {
    writeFileSync(join(photosDir, name), body);
  }
  for (const d of dirs) mkdirSync(join(photosDir, d), { recursive: true });
  return registerPinchRoutes(new Hono(), { store, photosDir });
}

const get = (app, path) => app.fetch(new Request(`http://localhost${path}`));

describe('pinch routes', () => {
  it('collection returns the library', async () => {
    const res = await get(appWith(), '/api/pinch/collection');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ recipes: RECIPES });
  });

  it('serves photo bytes with the sidecar content-type', async () => {
    const app = appWith({ photos: { abc: 'BYTES', 'abc.type': 'image/png' } });
    const res = await get(app, '/api/pinch/photos/abc');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    // Without this the allowlist above is only half enforced.
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    // A cached photo would outlive the recipe whose id it is keyed by.
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toBe('BYTES');
  });

  // Fails loud rather than flattening an operational fault into "not found":
  // the throw surfaces as a 500, which is distinguishable from the 404 a
  // genuinely absent photo gets.
  it.each([
    ['the photo itself', { dirs: ['adir'] }, 'adir'],
    ['its .type sidecar', { photos: { abc: 'B' }, dirs: ['abc.type'] }, 'abc'],
  ])('500s when %s is unreadable for a reason other than absence', async (_l, opts, id) => {
    const res = await get(appWith(opts), `/api/pinch/photos/${id}`);
    expect(res.status).toBe(500);
  });

  it.each([
    ['no sidecar', { abc: 'B' }],
    ['an unknown type', { abc: 'B', 'abc.type': 'application/x-evil' }],
    ['svg, which is not allowed', { abc: 'B', 'abc.type': 'image/svg+xml' }],
  ])('falls back to jpeg on %s', async (_label, photos) => {
    const res = await get(appWith({ photos }), '/api/pinch/photos/abc');
    expect(res.headers.get('content-type')).toBe('image/jpeg');
  });

  // 400 vs 404 is the discriminator: a rejected id never reaches the
  // filesystem, so an over-long one that got through would surface as the
  // handler's 404 (ENAMETOOLONG) instead.
  it.each([
    ['a traversal attempt', '..%2F..%2Fetc%2Fpasswd', 400],
    ['a dotted id', 'a.b', 400],
    ['an over-long id', 'a'.repeat(300), 400],
    ['a missing photo', 'nosuch', 404],
  ])('rejects %s', async (_label, id, status) => {
    const res = await get(appWith(), `/api/pinch/photos/${id}`);
    expect(res.status).toBe(status);
  });
});

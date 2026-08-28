import { mkdtemp, readdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { createBannerStore } from './banners.js';

// Each test gets a unique tmp dir; the OS reaps tmp, so no afterEach cleanup.
const freshDir = () => mkdtemp(join(tmpdir(), 'banners-'));

const listing = async (d) => (await readdir(d)).sort();
const ups = async (d) => (await listing(d)).filter((n) => n.startsWith('up_'));
const s2s = async (d) => (await listing(d)).filter((n) => n.startsWith('s2_'));

// a real, decodable image bigger than the 1600px cap on its long side
const bigImage = (w = 2400, h = 1600) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 10, g: 120, b: 200 } } })
    .png()
    .toBuffer();

describe('createBannerStore', () => {
  // resize contract: clamp the long side to 1600px, never upscale; always JPEG up_*.jpg.
  it.each([
    { name: 'clamps the long side to ≤1600px', w: 2400, h: 1600, filename: 'Beach Day.HEIC', width: 1600, stored: /^up_\d+_[0-9a-f]+_beach-day\.jpg$/ },
    { name: 'never upscales a small image', w: 800, h: 500, filename: 'tiny.png', width: 800, stored: /^up_.+\.jpg$/ },
  ])('save: $name → JPEG up_*.jpg', async ({ w, h, filename, width, stored }) => {
    const dir = await freshDir();
    const store = createBannerStore(dir);
    const r = await store.save({ filename, buffer: await bigImage(w, h) });
    expect(r.stored).toMatch(stored);
    const meta = await sharp(await readFile(join(dir, r.stored))).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(width);
  });

  it('save: two same-ms same-name uploads get distinct names (no overwrite)', async () => {
    const dir = await freshDir();
    const store = createBannerStore(dir);
    // Pin the clock so the ms component is identical for both saves — only the
    // random suffix keeps them distinct, which is exactly what this regresses.
    const spy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    try {
      const a = await store.save({ filename: 'photo.jpg', buffer: await bigImage(900, 600) });
      const b = await store.save({ filename: 'photo.jpg', buffer: await bigImage(900, 600) });
      expect(a.stored).not.toBe(b.stored);
      expect(await ups(dir)).toHaveLength(2);
    } finally {
      spy.mockRestore();
    }
  });

  it('save: rejects junk / non-image with a 400', async () => {
    const dir = await freshDir();
    const store = createBannerStore(dir);
    await expect(store.save({ filename: 'x.jpg', buffer: Buffer.from('not an image at all') }))
      .rejects.toMatchObject({ status: 400 });
    await expect(store.save({ filename: 'x.jpg', buffer: Buffer.alloc(0) }))
      .rejects.toMatchObject({ status: 400 });
    expect(await ups(dir)).toHaveLength(0); // nothing written on rejection
  });

  it('save: caps the texted set to the newest 10 up_*, leaving s2_* untouched', async () => {
    const dir = await freshDir();
    const store = createBannerStore(dir);
    // 11 pre-existing texted photos (older epochs) + 2 curated family photos
    for (let i = 1; i <= 11; i++) await writeFile(join(dir, `up_${1_000_000 + i}_old.jpg`), 'x');
    await writeFile(join(dir, 's2_01_family.jpg'), 'curated');
    await writeFile(join(dir, 's2_02_family.jpg'), 'curated');

    const r = await store.save({ filename: 'new.png', buffer: await bigImage() });
    expect(r.upCount).toBe(10); // 11 old + 1 new = 12 → capped to 10
    expect(await ups(dir)).toHaveLength(10);
    expect(await s2s(dir)).toHaveLength(2); // curated set NEVER touched by the cap
    expect((await ups(dir)).includes(r.stored)).toBe(true); // the newest survives
  });

  it('clear: removes only up_*, leaves s2_* present', async () => {
    const dir = await freshDir();
    const store = createBannerStore(dir);
    await writeFile(join(dir, 'up_1700000000_a.jpg'), 'x');
    await writeFile(join(dir, 'up_1700000001_b.jpg'), 'x');
    await writeFile(join(dir, 's2_01_family.jpg'), 'curated');

    const r = await store.clear();
    expect(r.removed).toBe(2);
    expect(await ups(dir)).toHaveLength(0);
    expect(await s2s(dir)).toEqual(['s2_01_family.jpg']); // curated survives clear
  });
});

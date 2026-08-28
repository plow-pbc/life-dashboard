import { randomBytes } from 'node:crypto';
import { mkdir, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import sharp from 'sharp';

// Agent-uploaded ("texted") banners are namespaced with the `up_` prefix so
// they sort after the curated `s2_*` family set and can be capped/cleared in
// isolation. Every mutation here is SCOPED to this pattern — the curated set
// (and any other non-`up_` file) is never touched.
// Matches exactly what save() produces (always lowercase up_…jpg), which is the
// lowercase `up_` namespace the docs reserve — case-sensitive so a curated
// `UP_*.jpg` is never mistaken for an upload.
const UP_RE = /^up_[a-z0-9._-]+\.jpg$/;
const MAX_SIDE = 1600; // longest side, px (never upscales)
const QUALITY = 82; // JPEG quality
const CAP = 10; // keep at most this many texted photos (newest win)
// Decode ceiling: a small compressed buffer can still decode to an enormous
// raster (decompression bomb). 64MP covers any phone camera while blocking the
// pathological case sharp's ~268MP default would let through. We resize to
// 1600px anyway, so nothing legitimate needs more.
const MAX_INPUT_PIXELS = 64_000_000;

function badRequest(msg) {
  const e = new Error(msg);
  e.status = 400;
  return e;
}

// Accept only the documented raster formats by magic bytes before sharp decodes
// — bounds the libvips decoder surface (no SVG/TIFF/AVIF/…) to the
// JPEG/PNG/WebP/GIF contract, even though the producer is bearer-gated.
function isAllowedImage(b) {
  if (b.length < 12) return false;
  return (
    (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) || // JPEG
    (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) || // PNG
    (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) || // GIF
    (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') // WebP
  );
}

function slugify(filename) {
  const base = basename(String(filename || ''))
    .replace(/\.[a-z0-9]+$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return base || 'photo';
}

// up_<epoch>_<slug>.jpg → epoch as a number for newest-first ordering.
function epochOf(name) {
  const m = /^up_(\d+)_/.exec(name);
  return m ? Number(m[1]) : 0;
}

async function listUp(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return entries.filter((e) => e.isFile() && UP_RE.test(e.name)).map((e) => e.name);
}

// Keep the newest CAP up_*.jpg; delete the rest. Returns the remaining count.
// SCOPED to up_* — s2_* (and anything else) is invisible to this.
async function capUp(dir) {
  const ups = (await listUp(dir)).sort((a, b) => epochOf(b) - epochOf(a) || (a < b ? 1 : -1));
  for (const name of ups.slice(CAP)) {
    await unlink(join(dir, name));
  }
  return Math.min(ups.length, CAP);
}

export function createBannerStore(dir) {
  return {
    // Validate + resize/convert + save one uploaded image. Throws a 400-tagged
    // error if the buffer isn't a decodable image (HEIC is NOT decodable by the
    // prebuilt libvips in `sharp` — the skill normalizes HEIC→JPEG first).
    async save({ filename, buffer }) {
      if (!buffer || !buffer.length) throw badRequest('empty image');
      if (!isAllowedImage(buffer)) throw badRequest('unsupported image type (JPEG/PNG/WebP/GIF only)');
      // One decode does both jobs: an undecodable buffer (incl. HEIC, which the
      // prebuilt libvips can't read — the skill normalizes HEIC→JPEG first) or a
      // dimensionless input throws here and surfaces as a 400. sharp drops
      // metadata by default → strips EXIF/GPS (privacy + size).
      let jpeg;
      try {
        jpeg = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
          .rotate() // bake in EXIF orientation before we strip metadata
          .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: QUALITY })
          .toBuffer();
      } catch {
        throw badRequest('not a decodable image (note: HEIC is not supported server-side)');
      }

      // ms timestamp + a short random suffix so two uploads in the same second
      // (even with the same original name) never collide/overwrite. Still
      // matches UP_RE, and epochOf parses the leading ms → newest-first cap.
      const name = `up_${Date.now()}_${randomBytes(3).toString('hex')}_${slugify(filename)}.jpg`;
      await mkdir(dir, { recursive: true });
      // Publish atomically (write a .tmp the listing can't match, then rename)
      // so a crash/disk-full mid-write never leaves a partial JPEG for the kiosk
      // to render — the same durability pattern store.js uses for messages.json.
      const tmp = join(dir, `${name}.tmp`);
      await writeFile(tmp, jpeg);
      await rename(tmp, join(dir, name));
      const upCount = await capUp(dir);
      return { stored: name, upCount };
    },

    // Clear mode: remove ALL up_* photos. s2_* (and other non-up_) untouched.
    async clear() {
      const ups = await listUp(dir);
      for (const name of ups) await unlink(join(dir, name));
      return { removed: ups.length, upCount: 0 };
    },
  };
}

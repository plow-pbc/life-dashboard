import { readFileSync } from 'node:fs';

// Read-only view of the recipe snapshot. The out-of-process Paprika sync (see
// SEED.md) owns every file here and rewrites the library atomically; this
// process only ever reads, so there is no write chain and no lock.
//
// ENOENT reads as empty: that is the ordinary state before the first sync, and
// a kiosk showing no recipe yet is correct. Every other failure — a permissions
// fault, a directory where a file belongs, a malformed file — throws, per
// REVIEW.md's operating point ("prefer loud failures to fallbacks").
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  read() {
    const lib = readJson(this.filePath) ?? {};
    return { recipes: Array.isArray(lib.recipes) ? lib.recipes : [] };
  }
}

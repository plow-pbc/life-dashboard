import { readFileSync } from 'node:fs';

// The daily affirmation reaches the wall the SAME way the Cook Tonight pin does:
// the agent drops a small JSON file on the Pi over its wall SSH connection (an
// atomic stage→scp→mv), and this reads it LIVE on every /api/affirmation
// request — so a fresh morning line shows without a viewer restart, exactly like
// /api/pinch/collection reads collection.json live.
//
// Shape the agent writes: {"text": "<one line>", "date": "Oct 22"}.
//
// Missing file (no line delivered yet) reads as null — the tile shows its quiet
// invitation, the ordinary pre-first-run state. A malformed or unreadable file
// is warned and ALSO treated as null (not thrown): a half-written drop or a bad
// file must never break the tile. Matches readTonightPin's graceful live-read
// posture (vs JsonStore's fail-loud, which is for the once-at-startup read).
export function readAffirmation(filePath) {
  let obj;
  try {
    obj = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`Ignoring affirmation.json (${filePath}): ${err.message}`);
    }
    return null;
  }
  const text = obj && typeof obj.text === 'string' ? obj.text.trim() : '';
  if (!text) return null;
  const date = typeof obj?.date === 'string' && obj.date.trim() ? obj.date.trim() : undefined;
  // Message-shaped so the tile renders it exactly as the posted card did: card 2,
  // type affirmation, the line, and the optional date stamp.
  return date === undefined
    ? { card: '2', type: 'affirmation', text }
    : { card: '2', type: 'affirmation', text, date };
}

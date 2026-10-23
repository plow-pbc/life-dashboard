import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readAffirmation } from './affirmation.js';

async function withFile(contents) {
  const dir = await mkdtemp(join(tmpdir(), 'affirm-'));
  const path = join(dir, 'affirmation.json');
  if (contents !== undefined) await writeFile(path, contents);
  return path;
}

describe('readAffirmation', () => {
  it('reads {text, date} as a card-2 affirmation message', async () => {
    const path = await withFile(JSON.stringify({ text: 'Slow start, soft week.', date: 'Oct 22' }));
    expect(readAffirmation(path)).toEqual({
      card: '2',
      type: 'affirmation',
      text: 'Slow start, soft week.',
      date: 'Oct 22',
    });
  });

  it('omits date when absent (not a null/empty stamp)', async () => {
    const path = await withFile(JSON.stringify({ text: 'Already here, this morning.' }));
    const msg = readAffirmation(path);
    expect(msg).toEqual({ card: '2', type: 'affirmation', text: 'Already here, this morning.' });
    expect('date' in msg).toBe(false);
  });

  it('trims the line and drops a blank-text file', async () => {
    expect(readAffirmation(await withFile(JSON.stringify({ text: '  hi  ', date: 'Oct 22' }))).text).toBe('hi');
    expect(readAffirmation(await withFile(JSON.stringify({ text: '   ' })))).toBeNull();
    expect(readAffirmation(await withFile(JSON.stringify({ date: 'Oct 22' })))).toBeNull();
  });

  it('returns null for a missing file (nothing delivered yet) — no throw', async () => {
    const path = await withFile(undefined); // file never written
    expect(readAffirmation(path)).toBeNull();
  });

  it('returns null (not a throw) for a malformed/half-written file', async () => {
    expect(readAffirmation(await withFile('{not json'))).toBeNull();
    expect(readAffirmation(await withFile('[]'))).toBeNull();
  });
});

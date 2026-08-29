import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { createFileStore } from './store.js';

async function freshPath() {
  return join(await mkdtemp(join(tmpdir(), 'store-')), 'data', 'messages.json');
}

describe('createFileStore', () => {
  it('returns null for a card never stored', async () => {
    const store = await createFileStore(await freshPath());
    expect(await store.get('4')).toBeNull();
  });

  it('stores and returns the latest message per card', async () => {
    const store = await createFileStore(await freshPath());
    await store.put({ card: '1', type: 'alert', text: 'first' });
    await store.put({ card: '1', type: 'alert', text: 'second' });
    await store.put({ card: '4', type: 'digest', text: 'weekly' });
    expect(await store.get('1')).toEqual({ card: '1', type: 'alert', text: 'second' });
    expect(await store.get('4')).toEqual({ card: '4', type: 'digest', text: 'weekly' });
  });

  it('persists across reopen (survives restart)', async () => {
    const path = await freshPath();
    const a = await createFileStore(path);
    await a.put({ card: '2', type: 'message', text: 'hello' });
    const b = await createFileStore(path);
    expect(await b.get('2')).toEqual({ card: '2', type: 'message', text: 'hello' });
  });

  it('concurrent puts both resolve and both messages are readable', async () => {
    const path = await freshPath();
    const store = await createFileStore(path);
    const a = { card: '1', type: 'alert', text: 'A' };
    const b = { card: '4', type: 'digest', text: 'B' };
    await Promise.all([store.put(a), store.put(b)]);
    expect(await store.get('1')).toEqual(a);
    expect(await store.get('4')).toEqual(b);
  });

  it('persisted file is not world-readable', async () => {
    const path = await freshPath();
    const store = await createFileStore(path);
    await store.put({ card: '1', type: 'alert', text: 'x' });
    const { stat } = await import('node:fs/promises');
    expect((await stat(path)).mode & 0o077).toBe(0);
  });

  it('write chain recovers after a failed persist', async () => {
    const path = await freshPath();
    const dir = dirname(path);
    const store = await createFileStore(path);
    // Deterministic failure injection that works even as root (where a
    // read-only chmod would be bypassed by CAP_DAC_OVERRIDE): replace the
    // data dir with a regular file so the tmp-file write fails with ENOTDIR.
    await rm(dir, { recursive: true });
    await writeFile(dir, '');
    await expect(store.put({ card: '1', type: 'alert', text: 'poisoned' })).rejects.toThrow(
      /ENOTDIR/,
    );
    // The rejected message must NOT be visible — get must return null.
    expect(await store.get('1')).toBeNull();
    await rm(dir);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    // The chain must be healthy again: the next put resolves and persists.
    await store.put({ card: '1', type: 'alert', text: 'recovered' });
    expect(await store.get('1')).toEqual({ card: '1', type: 'alert', text: 'recovered' });
  });

  it('replace() drops keys absent from the snapshot', async () => {
    const store = await createFileStore(await freshPath());
    await store.put({ card: '1', type: 'alert', text: 'first' });
    await store.put({ card: '4', type: 'digest', text: 'weekly' });
    await store.replace({ 1: { card: '1', type: 'alert', text: 'refreshed' } });
    expect(await store.get('1')).toEqual({ card: '1', type: 'alert', text: 'refreshed' });
    expect(await store.get('4')).toBeNull();
  });

  it('get("constructor") returns null on a fresh store', async () => {
    const store = await createFileStore(await freshPath());
    expect(await store.get('constructor')).toBeNull();
  });

  it('get("__proto__") returns null on a fresh store', async () => {
    const store = await createFileStore(await freshPath());
    expect(await store.get('__proto__')).toBeNull();
  });

  it('put({card:"__proto__"}) stores and retrieves the message without corrupting other keys', async () => {
    const store = await createFileStore(await freshPath());
    await store.put({ card: '__proto__', type: 'plain', text: 'x' });
    expect(await store.get('__proto__')).toEqual({ card: '__proto__', type: 'plain', text: 'x' });
    expect(await store.get('toString')).toBeNull();
  });

  it('prototype-polluted key persists and reloads cleanly', async () => {
    const path = await freshPath();
    const a = await createFileStore(path);
    await a.put({ card: '__proto__', type: 'plain', text: 'safe' });
    const b = await createFileStore(path);
    expect(await b.get('__proto__')).toEqual({ card: '__proto__', type: 'plain', text: 'safe' });
    expect(await b.get('toString')).toBeNull();
  });
});

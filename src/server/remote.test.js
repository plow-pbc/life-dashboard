import { describe, it, expect, vi } from 'vitest';
import { createCardPoller } from './remote.js';

// In-memory stand-in for createFileStore: same get/put contract.
function memStore(initial = {}) {
  const byCard = { ...initial };
  return {
    get: async (card) => byCard[card] ?? null,
    put: async (m) => {
      byCard[m.card] = m;
    },
  };
}

const upstream = {
  1: { type: 'alert', text: 'polled', title: '', posted_at: '2026-08-28T00:00:00Z' },
  3: { type: 'weather', text: '<div>72°</div>', title: null, posted_at: '2026-08-28T00:00:00Z' },
};

describe('createCardPoller', () => {
  it('serves upstream cards in the viewer message shape (posted_at dropped, null title omitted)', async () => {
    const poller = createCardPoller({ fetchCards: vi.fn(async () => upstream), store: memStore() });
    expect(await poller.get('1')).toEqual({ card: '1', type: 'alert', text: 'polled', title: '' });
    expect(await poller.get('3')).toEqual({ card: '3', type: 'weather', text: '<div>72°</div>' });
    expect(await poller.get('5')).toBeNull();
  });

  it('coalesces concurrent reads into one upstream fetch (the kiosk asks for 5 cards at once)', async () => {
    let release;
    const fetchCards = vi.fn(() => new Promise((r) => (release = () => r(upstream))));
    const poller = createCardPoller({ fetchCards, store: memStore() });
    const reads = Promise.all(['1', '2', '3', '4', '5'].map((c) => poller.get(c)));
    release();
    const [one] = await reads;
    expect(one.text).toBe('polled');
    expect(fetchCards).toHaveBeenCalledTimes(1);
  });

  it('refetches only after ttl (a busy wall never storms upstream)', async () => {
    let t = 1_000_000;
    const fetchCards = vi
      .fn()
      .mockResolvedValueOnce({ 1: { type: 'alert', text: 'first' } })
      .mockResolvedValueOnce({ 1: { type: 'alert', text: 'second' } });
    const poller = createCardPoller({ fetchCards, store: memStore(), ttlMs: 60_000, now: () => t });
    await poller.get('1');
    t += 30_000;
    expect((await poller.get('1')).text).toBe('first');
    t += 31_000;
    expect((await poller.get('1')).text).toBe('second');
  });

  it('serves last-good from the store when upstream fails, and null when it never succeeded', async () => {
    let t = 1_000_000;
    const fetchCards = vi
      .fn()
      .mockRejectedValueOnce(new Error('remote store HTTP 503'))
      .mockResolvedValueOnce({ 1: { type: 'alert', text: 'good' } })
      .mockRejectedValueOnce(new Error('remote store HTTP 502'));
    const log = vi.fn();
    const poller = createCardPoller({
      fetchCards,
      store: memStore(),
      ttlMs: 60_000,
      now: () => t,
      log,
    });
    expect(await poller.get('1')).toBeNull();
    t += 61_000;
    expect((await poller.get('1')).text).toBe('good');
    t += 61_000;
    expect((await poller.get('1')).text).toBe('good');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('HTTP 502'));
  });

  it('last-good is the on-disk store: a fresh poller over the same store serves it before any fetch succeeds', async () => {
    const store = memStore();
    await createCardPoller({ fetchCards: async () => upstream, store }).get('1');
    const cold = createCardPoller({
      fetchCards: async () => {
        throw new Error('down');
      },
      store,
      log: () => {},
    });
    expect((await cold.get('1')).text).toBe('polled');
  });
});

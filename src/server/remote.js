// Remote store mode (KIOSK_REMOTE_URL): last-good on-disk view of the
// upstream Plow kiosk store, refreshed at most once per ttl.
export const DEFAULT_TTL_MS = 60_000;

export function createCardPoller({
  fetchCards,
  store,
  ttlMs = DEFAULT_TTL_MS,
  now = Date.now,
  log = (m) => console.error(m),
}) {
  let fetchedAt = -Infinity;
  let inflight = null;

  const refresh = () => {
    if (inflight) return inflight;
    if (now() - fetchedAt < ttlMs) return Promise.resolve();
    inflight = (async () => {
      try {
        const cards = await fetchCards();
        const snapshot = Object.create(null);
        for (const [card, { type, text, title }] of Object.entries(cards)) {
          // The viewer's wire shape: title absent = type label, '' = hidden.
          snapshot[card] =
            typeof title === 'string' ? { card, type, text, title } : { card, type, text };
        }
        // One atomic commit of the complete snapshot: a card absent from a
        // successful upstream fetch is dropped, never left stale — no mixed
        // snapshot (some cards updated, some stale) is ever observable.
        await store.replace(snapshot);
      } catch (err) {
        log(`remote cards: ${err.message} — serving last-good`);
      } finally {
        fetchedAt = now();
        inflight = null;
      }
    })();
    return inflight;
  };

  return {
    async get(card) {
      await refresh();
      return store.get(card);
    },
    refresh,
  };
}

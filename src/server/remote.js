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
        for (const [card, { type, text, title }] of Object.entries(cards)) {
          // The viewer's wire shape: title absent = type label, '' = hidden.
          const message =
            typeof title === 'string' ? { card, type, text, title } : { card, type, text };
          // Skip unchanged cards: every put is an atomic rewrite on an SD card.
          if (JSON.stringify(message) !== JSON.stringify(await store.get(card))) {
            await store.put(message);
          }
        }
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

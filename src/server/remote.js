// Remote store mode (KIOSK_REMOTE_URL): the message store is upstream in the
// Plow kiosk store, and this poller is the viewer's read-only view of it. It
// wraps the on-disk store so last-good survives a Plow outage or a reboot,
// and it fetches at most once per ttl — on demand, coalesced across the five
// concurrent card reads a page load makes — so a busy wall never storms
// upstream. A failed fetch counts against the ttl too (no retry storm).
export function createCardPoller({
  fetchCards,
  store,
  ttlMs = 60_000,
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

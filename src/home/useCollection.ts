import { useEffect, useState } from 'react';
import type { Collection } from '../pinch';

/** The synced Pinch library, fetched once per page load, and whether that
 *  fetch has finished (configured or not).
 *
 *  A failure is never thrown: when the snapshot is unconfigured, /api/pinch/* is
 *  never mounted and server.js's SPA catch-all answers with 200 text/html, so
 *  res.json() rejects and the library stays null. The calendar loads
 *  regardless. */
export function useCollection(): { collection: Collection | null; settled: boolean } {
  const [collection, setCollection] = useState<Collection | null>(null);
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('api/pinch/collection');
        if (!res.ok) return;
        const body = (await res.json()) as Collection;
        if (!cancelled) setCollection(body);
      } catch {
        // Unconfigured: the recipe tile shows its invite placeholder.
      } finally {
        if (!cancelled) setSettled(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return { collection, settled };
}

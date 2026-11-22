import type { Tab } from './nav';

// The viewer reloads itself every REFRESH_MS to pick up fresh calendar,
// weather and sports data. A reload while the Meals tab is showing would
// reload the Pinch embed too: Pinch reopens the recipe, but at the top, so
// someone cooking from halfway down loses their place. The embed is
// cross-origin, so its scroll can't be read or restored from here. Instead the
// reload waits: when it falls due on Meals it is held, and it runs as soon as
// the wall leaves Meals. Meals shows none of the data the reload refreshes, so
// holding it there costs nothing on screen.
export type ReloadGate = {
  /** Tell the gate which tab is showing now. */
  setTab: (tab: Tab) => void;
  /** Cancel the pending timer. */
  stop: () => void;
};

export function createReloadGate(
  initialTab: Tab,
  delayMs: number,
  reload: () => void,
  timers: Pick<typeof globalThis, 'setTimeout' | 'clearTimeout'> = globalThis,
): ReloadGate {
  let tab = initialTab;
  let due = false;
  const runIfAllowed = () => {
    if (due && tab !== 'meals') reload();
  };
  const timer = timers.setTimeout(() => {
    due = true;
    runIfAllowed();
  }, delayMs);
  return {
    setTab(next) {
      tab = next;
      runIfAllowed();
    },
    stop() {
      timers.clearTimeout(timer);
    },
  };
}

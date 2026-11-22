// The viewer reloads itself every REFRESH_MS to pick up fresh calendar,
// weather and sports data. A reload while the Pinch embed is showing reloads
// the embed too: Pinch reopens the recipe, but at the top, so someone cooking
// from halfway down loses their place. The embed is cross-origin, so its
// scroll can't be read or restored from here. Instead the reload waits: when it
// falls due while the embed is showing it is held, and it runs as soon as the
// embed goes away (another tab, or the Meals pane showing anything else). The
// embed shows none of the data the reload refreshes, so holding it costs
// nothing on screen; anything else on the Meals pane, such as the placeholder
// after a failed config load, still reloads on time and so gets retried.
export type ReloadGate = {
  /** Whether the reload must wait right now (the Pinch embed is showing). */
  setHeld: (held: boolean) => void;
  /** Cancel the pending timer. */
  stop: () => void;
};

export function createReloadGate(
  delayMs: number,
  reload: () => void,
  timers: Pick<typeof globalThis, 'setTimeout' | 'clearTimeout'> = globalThis,
): ReloadGate {
  let held = false;
  let due = false;
  const runIfAllowed = () => {
    if (due && !held) reload();
  };
  const timer = timers.setTimeout(() => {
    due = true;
    runIfAllowed();
  }, delayMs);
  return {
    setHeld(next) {
      held = next;
      runIfAllowed();
    },
    stop() {
      timers.clearTimeout(timer);
    },
  };
}

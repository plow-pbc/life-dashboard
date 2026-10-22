// Hash-based tab routing for the dashboard shell. No router dependency: the
// active tab IS the URL hash, which gives three properties for free —
//   (a) no new dependency for three tabs;
//   (b) it survives the viewer's ~5-min location.reload() (the hash persists, so
//       the wall stays on the current tab);
//   (c) the Pi's hourly kiosk recycle relaunches the BARE localhost:5174 (no
//       hash) → tabFromHash('') → Home, so the wall rests to Home each hour with
//       no timer of our own.

export const TABS = ['home', 'calendar', 'meals'] as const;
export type Tab = (typeof TABS)[number];

export const DEFAULT_TAB: Tab = 'home';

/** The tab for a `location.hash` value. Keyed on the FIRST path segment, so any
 *  trailing hash detail still resolves to its tab. Anything unknown/empty/bare → Home. */
export function tabFromHash(hash: string): Tab {
  const name = hash.replace(/^#/, '').trim().toLowerCase().split('/')[0];
  return (TABS as readonly string[]).includes(name) ? (name as Tab) : DEFAULT_TAB;
}

/** The hash to write for a tab. Always explicit (even Home), so a reload while on
 *  a tab stays on that tab rather than falling back through the bare-URL path. */
export function hashForTab(tab: Tab): string {
  return `#${tab}`;
}

/** Display labels for the nav. */
export const TAB_LABELS: Record<Tab, string> = {
  home: 'Home',
  calendar: 'Calendar',
  meals: 'Meals',
};

/** Clock face parts: 12-hour time without AM/PM (the lock-screen convention),
 *  plus the weekday and month/day lines beside it. */
export function clockParts(now: Date) {
  const time = now
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    .replace(/\s?[AP]M$/i, '');
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
  const monthDay = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  return { time, weekday, monthDay };
}

/** Minutes to shift the app clock by, from a `?at=` URL parameter: `HH:MM`
 *  for that time today, or `YYYY-MM-DDTHH:MM` for a moment on another day.
 *  Lets a moment be shown on the panel on demand; without the parameter the
 *  clock is real time. */
export function clockOffsetMs(search: string, real: Date): number {
  const at = new URLSearchParams(search).get('at');
  if (!at) return 0;
  const hm = /^(\d{1,2}):(\d{2})$/.exec(at);
  const forced = hm
    ? new Date(real.getFullYear(), real.getMonth(), real.getDate(), +hm[1], +hm[2])
    : new Date(at);
  return Number.isNaN(forced.getTime()) ? 0 : forced.getTime() - real.getTime();
}

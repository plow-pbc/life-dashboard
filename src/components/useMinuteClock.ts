import { useEffect, useState } from 'react';
import { clockOffsetMs } from '../clock';

// Read once per page load: the kiosk reloads every few minutes and relaunches
// on the bare URL, so a forced clock never outlives the page that asked for it.
const offsetMs = clockOffsetMs(location.search, new Date());

const appNow = () => new Date(Date.now() + offsetMs);

/** The app's current time (real, or shifted by `?at=`), re-rendered on each
 *  minute boundary. */
export function useMinuteClock() {
  const [now, setNow] = useState(appNow);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const d = appNow();
      timer = setTimeout(
        () => {
          setNow(appNow());
          schedule();
        },
        60_000 - (d.getSeconds() * 1000 + d.getMilliseconds()),
      );
    };
    schedule();
    return () => clearTimeout(timer);
  }, []);
  return now;
}

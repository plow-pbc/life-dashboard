import ICAL from 'ical.js';
import type { Event } from './types';

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export function parseICS(text: string, now: Date, n: number): Event[] {
  const jcal = ICAL.parse(text);
  const vcalendar = new ICAL.Component(jcal);
  const vevents = vcalendar.getAllSubcomponents('vevent');
  const horizon = ICAL.Time.fromJSDate(new Date(now.getTime() + ONE_YEAR_MS), true);

  // Separate recurrence overrides (e.g. one occurrence of a weekly meeting moved
  // to a new time) from their masters, then register them so the iterator returns
  // the override at the right slot instead of double-rendering. Drop cancelled
  // standalones immediately; cancelled exceptions still need to be related so the
  // master skips them at the right slot (handled in the iteration below).
  const masters: ICAL.Event[] = [];
  const exceptions: ICAL.Event[] = [];
  for (const vevent of vevents) {
    const event = new ICAL.Event(vevent);
    if (event.isRecurrenceException()) exceptions.push(event);
    else if (!isCancelled(event)) masters.push(event);
  }
  for (const ex of exceptions) {
    const master = masters.find((m) => m.uid === ex.uid);
    if (master) master.relateException(ex.component);
  }

  const events: Event[] = [];

  for (const event of masters) {
    if (event.isRecurring()) {
      const iterator = event.iterator();
      let next: ICAL.Time | null;
      while ((next = iterator.next())) {
        if (next.compare(horizon) > 0) break;
        const occ = event.getOccurrenceDetails(next);
        if (occ.endDate.toJSDate() <= now) continue;
        if (isCancelled(occ.item)) continue;
        // occ.item is the override if one is registered for this slot, else the master.
        events.push(toEvent(occ.item, occ.startDate, occ.endDate, true));
      }
    } else {
      events.push(toEvent(event, event.startDate, event.endDate, false));
    }
  }

  return events
    .filter((e) => e.end > now)
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .slice(0, n);
}

function isCancelled(event: ICAL.Event): boolean {
  return event.component.getFirstPropertyValue('status') === 'CANCELLED';
}

function toEvent(
  icalEvent: ICAL.Event,
  start: ICAL.Time,
  end: ICAL.Time,
  isOccurrence: boolean,
): Event {
  const startJs = start.toJSDate();
  const baseUid = icalEvent.uid;
  return {
    uid: isOccurrence ? `${baseUid}@${startJs.toISOString()}` : baseUid,
    title: icalEvent.summary,
    start: startJs,
    end: end.toJSDate(),
    isAllDay: start.isDate,
    location: icalEvent.location || null,
  };
}

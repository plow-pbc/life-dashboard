import { useState } from 'react';
import { buildUpNext, sameDay, type UpNextItem } from '../calendarLayout';
import { eventsOn, monthDays, wordTitle } from '../home/widgetData';
import type { Event } from '../types';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const monthFmt = new Intl.DateTimeFormat('en-US', { month: 'long' });
const dayFmt = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'short',
  day: 'numeric',
});

type Props = {
  events: Event[];
  upNext: UpNextItem[];
  now: Date;
  staleGeneratedAt: Date | null;
};

// Home's calendar: this month with a dot per event in that event's colour, then
// the list of what's next, which scrolls. Tapping a day (today or later) narrows the list
// to that day; tapping it again goes back to everything.
export function CalendarMini({ events, upNext, now, staleGeneratedAt }: Props) {
  const [picked, setPicked] = useState<Date | null>(null);
  const { blanks, days } = monthDays(events, now);

  const list = picked ? buildUpNext(eventsOn(events, picked), now, Infinity) : upNext;
  // A picked day already names the date, so its rows only need the time
  // (a multi-day event keeps its range).
  const meta = (ev: UpNextItem) =>
    picked
      ? ev.timeLabel === 'All week'
        ? ev.dateLabel
        : ev.timeLabel
      : `${ev.dateLabel} · ${ev.timeLabel}`;

  return (
    <section className="cm" aria-label="Calendar">
      <div className="cm-head">
        <span className="cm-month">{monthFmt.format(now)}</span>
        <span className="cm-year">{now.getFullYear()}</span>
      </div>
      <div className="cm-grid">
        {WEEKDAYS.map((d, i) => (
          <span className="cm-dow" key={`dow${i}`} aria-hidden="true">
            {d}
          </span>
        ))}
        {Array.from({ length: blanks }, (_, i) => (
          <span key={`blank${i}`} />
        ))}
        {days.map((d) => {
          const isPicked = picked !== null && sameDay(picked, d.date);
          return (
            <button
              type="button"
              key={d.day}
              className={
                'cm-day' +
                (d.isPast ? ' is-past' : '') +
                (d.isToday ? ' is-today' : '') +
                (d.isWeekend ? ' is-weekend' : '') +
                (isPicked ? ' is-picked' : '')
              }
              disabled={d.isPast}
              aria-pressed={isPicked}
              aria-label={dayFmt.format(d.date)}
              onClick={() => setPicked(isPicked ? null : d.date)}
            >
              <span className="cm-n">{d.day}</span>
              <span className="cm-dots">
                {d.dots.map((accent, i) => (
                  <i key={i} className={accent} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      {picked && <div className="cm-picked">{dayFmt.format(picked)}</div>}
      <div className="cm-list">
        {list.map((ev) => (
          <div className="cm-ev" key={ev.key}>
            <i className={`cm-bar ${ev.accent}`} />
            <div className="cm-text">
              <div className="cm-title">{wordTitle(ev.title)}</div>
              <div className="cm-meta">{meta(ev)}</div>
            </div>
          </div>
        ))}
        {list.length === 0 && (
          <span className="cm-empty">{picked ? 'Nothing that day.' : 'Nothing coming up.'}</span>
        )}
        {staleGeneratedAt && (
          <span className="cm-empty">
            As of {staleGeneratedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </span>
        )}
      </div>
    </section>
  );
}

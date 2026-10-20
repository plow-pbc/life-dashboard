import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CATEGORY_CLASS,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  DAYS_PER_WEEK,
  type MonthLayout,
} from '../calendarLayout';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Legend derived from the real category→color mapping, so the swatches are
// honest: each label names the category its color is actually assigned to.
const LEGEND = CATEGORY_ORDER.map((c) => ({
  cat: CATEGORY_CLASS[c],
  label: CATEGORY_LABELS[c],
}));

const fullMonth = new Intl.DateTimeFormat('en-US', { month: 'long' });
const shortMonth = new Intl.DateTimeFormat('en-US', { month: 'short' });

/**
 * The header label for the currently-visible span [start, end] (both inclusive):
 *  - one month in view        → "October 2026"
 *  - two months, same year    → "Oct – Nov 2026"
 *  - crossing a year boundary → "Dec 2026 – Jan 2027"
 */
function viewportLabel(start: Date, end: Date): string {
  const sM = start.getMonth();
  const sY = start.getFullYear();
  const eM = end.getMonth();
  const eY = end.getFullYear();
  if (sY === eY && sM === eM) return `${fullMonth.format(start)} ${sY}`;
  if (sY === eY) return `${shortMonth.format(start)} – ${shortMonth.format(end)} ${sY}`;
  return `${shortMonth.format(start)} ${sY} – ${shortMonth.format(end)} ${eY}`;
}

type Props = { layout: MonthLayout };

// The rolling ~3-month month grid: a weekday header and a scrollable stack of
// content-sized week rows. Each week has a day-number row, a bar band for
// multi-day spanning events, and per-day single-chip stacks (each day packs its
// own events top-to-bottom, so same-day chips never show a gap). The header is
// scroll-aware: it reflects the month/range currently in view. All layout math
// is in buildMonthLayout (calendarLayout.ts); this component paints the shapes.
export function CalendarMonth({ layout }: Props) {
  const weeksRef = useRef<HTMLDivElement>(null);
  const weekRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [rangeLabel, setRangeLabel] = useState(layout.rangeLabel);

  // Derive the header from whichever week rows intersect the scroll viewport.
  const recomputeLabel = useCallback(() => {
    const container = weeksRef.current;
    if (!container) return;
    const view = container.getBoundingClientRect();
    let firstIdx = -1;
    let lastIdx = -1;
    for (let i = 0; i < layout.weeks.length; i++) {
      const el = weekRefs.current[i];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      // Count a week as visible if it overlaps the viewport (1px tolerance so a
      // row flush with an edge doesn't flicker in and out).
      if (r.bottom > view.top + 1 && r.top < view.bottom - 1) {
        if (firstIdx === -1) firstIdx = i;
        lastIdx = i;
      }
    }
    if (firstIdx === -1) return;
    const start = layout.weeks[firstIdx].weekStart;
    const end = new Date(layout.weeks[lastIdx].weekStart);
    end.setDate(end.getDate() + DAYS_PER_WEEK - 1);
    setRangeLabel(viewportLabel(start, end));
  }, [layout]);

  useEffect(() => {
    const container = weeksRef.current;
    if (!container) return;
    let raf = 0;
    // Throttle to one recompute per frame — smooth on the kiosk's touch scroll.
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        recomputeLabel();
      });
    };
    recomputeLabel(); // at-rest label for the initial viewport
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [recomputeLabel]);

  return (
    <section className="card month" aria-label="Calendar">
      <div className="m-head">
        <span className="m-range">{rangeLabel}</span>
        <div className="legend">
          {LEGEND.map((l) => (
            <span className="leg" key={l.cat}>
              <span className={`sw ${l.cat}`} />
              {l.label}
            </span>
          ))}
        </div>
      </div>

      <div className="weekdays">
        {WEEKDAYS.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>

      <div className="weeks" ref={weeksRef}>
        {layout.weeks.map((week, wi) => (
          <div
            className="week"
            key={week.weekStart.toISOString()}
            ref={(el) => {
              weekRefs.current[wi] = el;
            }}
          >
            <div className="wk-days">
              {week.days.map((day, i) => (
                <span
                  key={day.date.toISOString()}
                  className={
                    'dnum' + (day.isToday ? ' today' : '') + (day.isPast ? ' past' : '')
                  }
                  style={{ gridColumn: i + 1 }}
                >
                  {day.dayNumber}
                </span>
              ))}
            </div>

            {week.bars.length > 0 && (
              <div className="wk-bars">
                {week.bars.map((bar) => (
                  <span
                    key={bar.key}
                    className={
                      `chip bar ${bar.cat}` +
                      (bar.continuesLeft ? ' cont-l' : '') +
                      (bar.continuesRight ? ' cont-r' : '') +
                      (bar.isPast ? ' past' : '')
                    }
                    style={{ gridColumn: `${bar.col} / span ${bar.span}`, gridRow: bar.row }}
                  >
                    {bar.title}
                  </span>
                ))}
              </div>
            )}

            {week.stacks.length > 0 && (
              <div className="wk-stacks">
                {week.stacks.map((stack) => (
                  <div className="day-stack" key={stack.col} style={{ gridColumn: stack.col }}>
                    {stack.chips.map((chip) => (
                      <span
                        key={chip.key}
                        className={`chip ${chip.cat}${chip.isPast ? ' past' : ''}`}
                      >
                        {chip.time && <span className="t">{chip.time}</span>}
                        {chip.title}
                      </span>
                    ))}
                    {stack.more > 0 && <span className="chip more">+{stack.more} more</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

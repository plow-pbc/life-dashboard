import type { Event } from './types';

// ---------------------------------------------------------------------------
// Pure layout helpers for the rolling multi-week month grid + "Up next" rail.
//
// These are deliberately free of React/DOM so the week/day math can be
// unit-tested directly (see calendarLayout.test.ts). The CalendarMonth and
// UpNext components consume the shapes produced here and only do rendering.
//
// A rolling ~3-month grid (WEEKS week rows) starting on the Sunday of the
// current week (so "today" is always in the first row), today highlighted, past
// days dimmed, timed/all-day day chips, and multi-day events as spanning bars
// per week row. Every event shows its full text in taller, auto-sized cells; the
// tall week stack overflows its pane and scrolls (see .weeks in index.css).
// ---------------------------------------------------------------------------

export const CAT_CLASSES = [
  'cat-cornflower',
  'cat-apricot',
  'cat-lavender',
  'cat-clay',
  'cat-seaglass',
] as const;
export type CatClass = (typeof CAT_CLASSES)[number];

// The matching accent class for the Up next rail's left tick.
export const ACCENT_BY_CAT: Record<CatClass, string> = {
  'cat-cornflower': 'acc-cornflower',
  'cat-apricot': 'acc-apricot',
  'cat-lavender': 'acc-lavender',
  'cat-clay': 'acc-clay',
  'cat-seaglass': 'acc-seaglass',
};

// ---------------------------------------------------------------------------
// Event categories — a real, deterministic keyword heuristic (not a hash).
//
// Five general categories, each bound to one chip/accent color. categoryFor()
// classifies an event by matching keywords in its title; an unmatched title
// falls to a sensible NEUTRAL default (never a random color). The legend labels
// (CalendarMonth) are derived from CATEGORY_LABELS so they stay honest.
//
// The ruleset is OVERRIDABLE: a future Lifey-pushed config can call
// setCategoryRules() to replace or extend DEFAULT_CATEGORY_RULES; the built-in
// rules are the fallback.
// ---------------------------------------------------------------------------

export type Category = 'work' | 'family' | 'social' | 'travel' | 'reminder';

/** The single source of truth binding each category to its chip color. */
export const CATEGORY_CLASS: Record<Category, CatClass> = {
  work: 'cat-cornflower',
  family: 'cat-apricot',
  social: 'cat-lavender',
  travel: 'cat-clay',
  reminder: 'cat-seaglass',
};

/** Human labels + display order for the legend (kept honest = real mapping). */
export const CATEGORY_LABELS: Record<Category, string> = {
  work: 'Work',
  family: 'Family',
  social: 'Social',
  travel: 'Travel',
  reminder: 'Reminder',
};
export const CATEGORY_ORDER: Category[] = ['work', 'family', 'social', 'travel', 'reminder'];

/** Neutral catch-all for a title that matches no rule — seaglass is the quietest
 *  of the five, so an unclassified "something to note" reads as a reminder. */
export const DEFAULT_CATEGORY: Category = 'reminder';

export type CategoryRule = { category: Category; keywords: string[] };

// Built-in rules in PRIORITY ORDER — the first category with a keyword hit wins.
// Order resolves overlaps deliberately: Family before Work so "Call Mom" is
// family (mom) not work (call); Family before Reminder so "Pickup kids" is family
// (kids) not an errand. Keywords match as whole words/phrases (see titleMatches).
export const DEFAULT_CATEGORY_RULES: CategoryRule[] = [
  {
    category: 'travel',
    keywords: [
      'flight', 'flights', 'trip', 'vacation', 'hotel', 'airport', 'cruise',
      'getaway', 'road trip', 'layover', 'check-in', 'boarding',
    ],
  },
  {
    category: 'family',
    keywords: [
      'birthday', 'anniversary', 'wedding', 'shower', 'family', 'mom', 'mum',
      'mother', 'dad', 'father', 'grandma', 'grandpa', 'grandparents', 'kids',
      'kid', 'soccer', 'practice', 'recital', 'rehearsal', 'lesson', 'dinner at',
      'thanksgiving', 'christmas', 'easter', 'hanukkah',
    ],
  },
  {
    category: 'work',
    keywords: [
      'meeting', 'standup', 'stand-up', 'call', 'sync', '1:1', 'one-on-one',
      'interview', 'review', 'deadline', 'conference', 'manager', 'client',
      'project', 'presentation', 'planning', 'offsite', 'retro',
    ],
  },
  {
    category: 'social',
    keywords: [
      'party', 'drinks', 'coffee', 'concert', 'book club', 'bookclub',
      'date night', 'trivia', 'game night', 'lunch', 'brunch', 'dinner', 'gym',
      'yoga', 'movie', 'potluck', 'happy hour',
    ],
  },
  {
    category: 'reminder',
    keywords: [
      'reminder', 'pay', 'renew', 'bill', 'dentist', 'doctor', 'appt',
      'appointment', 'haircut', 'grocery', 'groceries', 'errand', 'prescription',
      'refill', 'flu', 'shot', 'vaccine', 'checkup', 'oil change', 'pick up',
      'pickup', 'drop off', 'dropoff', 'return',
    ],
  },
];

let categoryRules: CategoryRule[] = DEFAULT_CATEGORY_RULES;

/**
 * Replace/extend the active category rules (e.g. from a Lifey-pushed config).
 * Rules are tried in order; the first keyword match wins. Pass null or an empty
 * array to reset to the built-in DEFAULT_CATEGORY_RULES.
 */
export function setCategoryRules(rules: CategoryRule[] | null | undefined): void {
  categoryRules = rules && rules.length ? rules : DEFAULT_CATEGORY_RULES;
}

/**
 * Normalize a title for matching: lowercase, drop [bracketed] tags like [test]/
 * [hold], fold smart quotes, strip emoji/punctuation (keeping ':' and '-' so
 * "1:1" and "stand-up" survive), and collapse whitespace.
 */
function normalizeTitle(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[^a-z0-9:'\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whole-word / whole-phrase containment on an already-normalized title. */
function titleMatches(normalizedTitle: string, keyword: string): boolean {
  return ` ${normalizedTitle} `.includes(` ${keyword} `);
}

/** The semantic category for an event, by keyword heuristic (deterministic). */
export function categoryOf(event: Event): Category {
  const title = normalizeTitle(event.title || event.uid || '');
  if (title) {
    for (const rule of categoryRules) {
      for (const keyword of rule.keywords) {
        if (titleMatches(title, keyword)) return rule.category;
      }
    }
  }
  return DEFAULT_CATEGORY;
}

// Rolling window length: 13 week rows ≈ 3 months forward from the current week.
// Today's week stays pinned at the top; the stack is intentionally taller than
// the pane so the calendar overflows and is touch-scrollable on the kiosk.
export const WEEKS = 13;
export const DAYS_PER_WEEK = 7;
// Per-day chip capacity. Each shown chip renders its FULL title (no clamp), and
// the fixed-height week has room for this many; a day with more shows the first
// (CHIP_ROWS-1) in full plus a "+N more" marker rather than truncating any chip.
// This is a PER-DAY affordance only — the grid still plots every in-window day's
// events (no global cap; see buildUpNext for the separate rail cap).
export const CHIP_ROWS = 4;

/** Local midnight for a date (strips the time-of-day). */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** The Sunday (local) on or before `d`, at local midnight. */
export function startOfWeek(d: Date): Date {
  const s = startOfDay(d);
  s.setDate(s.getDate() - s.getDay());
  return s;
}

/** Whole-day difference a→b (b - a) using local calendar days, DST-safe. */
export function dayDiff(a: Date, b: Date): number {
  const ma = startOfDay(a).getTime();
  const mb = startOfDay(b).getTime();
  return Math.round((mb - ma) / 86_400_000);
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * The last visible calendar day of an event. For all-day events the ICS DTEND
 * is exclusive, so the last painted day is end - 1 day; for timed events the
 * end date itself is the last day it touches.
 */
export function lastVisibleDay(event: Event): Date {
  if (event.isAllDay) {
    const last = startOfDay(event.end);
    last.setDate(last.getDate() - 1);
    // Guard a zero-length / malformed all-day event: never precede the start.
    return last.getTime() < startOfDay(event.start).getTime()
      ? startOfDay(event.start)
      : last;
  }
  return startOfDay(event.end);
}

/** True when the event covers more than one calendar day (a spanning bar). */
export function isMultiDay(event: Event): boolean {
  return dayDiff(event.start, lastVisibleDay(event)) >= 1;
}

/**
 * The chip/accent color class for an event. Deterministic and MEANINGFUL: the
 * event is classified into one of the five categories by keyword (categoryOf),
 * then mapped to that category's color. Signature kept stable for the existing
 * call sites (chips, bars) and ACCENT_BY_CAT (the Up next rail).
 */
export function categoryFor(event: Event): CatClass {
  return CATEGORY_CLASS[categoryOf(event)];
}

export type DayCell = {
  date: Date;
  dayNumber: number;
  isToday: boolean;
  isPast: boolean; // strictly before today
  inWindow: boolean; // always true here; kept for clarity of the grid
};

/**
 * A multi-day spanning bar segment for one week row. Bars live in their own band
 * above the per-day single chips and are placed by CSS grid column span, stacked
 * into `row` (1-based within the bar band) so overlapping bars don't collide.
 */
export type BarChip = {
  key: string;
  title: string;
  cat: CatClass;
  col: number; // 1..7 (CSS grid column, 1-based) — the segment's start column
  span: number; // columns the segment covers in this week
  row: number; // >=1, the bar-band row (stacks overlapping bars)
  isPast: boolean;
  continuesLeft: boolean; // bar started in a previous week
  continuesRight: boolean; // bar continues into a later week
};

/** A single-day chip. Its vertical position is NOT a week-wide grid row — it is
 *  an ordered member of its day's stack, so same-day chips pack contiguously. */
export type DayChip = {
  key: string;
  title: string;
  time: string | null; // null for all-day single-day chips
  cat: CatClass;
  isPast: boolean;
};

/**
 * One day column's single-day events, as an independent top-to-bottom stack.
 * Because each day owns its own stack (rendered as a flex column), a short chip
 * in one day never inflates a neighbouring day's chips — the old week-wide-row
 * gaps are gone.
 */
export type DayStack = {
  col: number; // 1..7
  chips: DayChip[]; // in display order, stacked flush top→bottom
  more: number; // overflow count for a "+N more" marker (0 = none)
};

export type WeekRow = {
  weekStart: Date;
  days: DayCell[];
  bars: BarChip[];
  stacks: DayStack[]; // one per day that has single-day events
  barRows: number; // number of bar-band rows used (0 if no bars this week)
};

export type MonthLayout = {
  windowStart: Date;
  windowEnd: Date; // last visible day (inclusive)
  weeks: WeekRow[];
  rangeLabel: string;
};

const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
const monthDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

function chipTime(event: Event): string | null {
  if (event.isAllDay) return null;
  // Full "7:00 PM" form, matching the mockup's chip time labels.
  return timeFmt.format(event.start);
}

/**
 * Build the rolling WEEKS-row grid (~3 months). The window always starts on the
 * Sunday of the current week so today sits in the first row; past days dim, today
 * highlights.
 *
 * Layout rule per week row:
 *  - Multi-day events are laid first as spanning *bars* in a bar band, packed
 *    top-down into the lowest free bar row so they don't overlap within a week.
 *  - Single-day chips then stack *per day*, top-to-bottom, as an independent
 *    column stack (see DayStack). Each day packs its own events flush with no
 *    gaps — a short chip in one day no longer inflates a neighbour's row, which
 *    was the old week-wide-row gap. A day with more events than fit (CHIP_ROWS)
 *    shows the first few in full plus a "+N more" marker — the only overflow
 *    affordance, for a rarely-busy day in this light calendar.
 */
export function buildMonthLayout(events: Event[], now: Date): MonthLayout {
  const windowStart = startOfWeek(now);
  const windowEnd = startOfDay(windowStart);
  windowEnd.setDate(windowEnd.getDate() + WEEKS * DAYS_PER_WEEK - 1);
  const today = startOfDay(now);

  const weeks: WeekRow[] = [];
  for (let w = 0; w < WEEKS; w++) {
    const weekStart = new Date(windowStart);
    weekStart.setDate(weekStart.getDate() + w * DAYS_PER_WEEK);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + DAYS_PER_WEEK - 1);

    const days: DayCell[] = [];
    for (let i = 0; i < DAYS_PER_WEEK; i++) {
      const date = new Date(weekStart);
      date.setDate(date.getDate() + i);
      days.push({
        date,
        dayNumber: date.getDate(),
        isToday: sameDay(date, today),
        isPast: startOfDay(date).getTime() < today.getTime(),
        inWindow: true,
      });
    }

    // Partition this week's visible events into spanning bars vs single-day.
    const bars: { event: Event; startCol: number; span: number; left: boolean; right: boolean }[] =
      [];
    const singles: { event: Event; col: number }[] = [];

    for (const event of events) {
      const start = startOfDay(event.start);
      const last = lastVisibleDay(event);
      // Overlap with this week's [weekStart, weekEnd]?
      if (last.getTime() < weekStart.getTime() || start.getTime() > weekEnd.getTime()) {
        continue;
      }
      if (isMultiDay(event)) {
        const segStart = start.getTime() < weekStart.getTime() ? weekStart : start;
        const segEnd = last.getTime() > weekEnd.getTime() ? weekEnd : last;
        const startCol = dayDiff(weekStart, segStart) + 1; // 1..7
        const span = dayDiff(segStart, segEnd) + 1;
        bars.push({
          event,
          startCol,
          span,
          left: start.getTime() < weekStart.getTime(),
          right: last.getTime() > weekEnd.getTime(),
        });
      } else {
        singles.push({ event, col: dayDiff(weekStart, start) + 1 });
      }
    }

    // Longest bars first so wide multi-day events claim the top bar rows.
    bars.sort((a, b) => b.span - a.span || a.startCol - b.startCol);

    // --- Bar band: pack spanning bars into their own rows (1-based), so two
    // overlapping multi-day events never collide. Bars are decoupled from the
    // single-day chip stacks below them. ---
    const barChips: BarChip[] = [];
    const barOccupied = new Set<string>(); // `${col}:${row}` within the bar band
    let barRows = 0;
    for (const bar of bars) {
      let row = 1;
      for (;;) {
        let ok = true;
        for (let c = bar.startCol; c < bar.startCol + bar.span; c++) {
          if (barOccupied.has(`${c}:${row}`)) {
            ok = false;
            break;
          }
        }
        if (ok) break;
        row++;
      }
      for (let c = bar.startCol; c < bar.startCol + bar.span; c++) {
        barOccupied.add(`${c}:${row}`);
      }
      if (row > barRows) barRows = row;
      barChips.push({
        key: `${bar.event.uid}:${w}`,
        title: bar.event.title,
        cat: categoryFor(bar.event),
        col: bar.startCol,
        span: bar.span,
        row,
        isPast: lastVisibleDay(bar.event).getTime() < today.getTime(),
        continuesLeft: bar.left,
        continuesRight: bar.right,
      });
    }

    // --- Per-day single-chip stacks: each day column packs its own events
    // top-to-bottom, independent of every other day. Capped at CHIP_ROWS with a
    // "+N more" marker so one busy day can't blow the week height out. ---
    const byCol = new Map<number, Event[]>();
    for (const { event, col } of singles) {
      if (!byCol.has(col)) byCol.set(col, []);
      byCol.get(col)!.push(event);
    }
    const stacks: DayStack[] = [];
    for (const [col, dayEvents] of byCol) {
      dayEvents.sort((a, b) => {
        if (a.isAllDay !== b.isAllDay) return a.isAllDay ? -1 : 1;
        return a.start.getTime() - b.start.getTime();
      });
      const willOverflow = dayEvents.length > CHIP_ROWS;
      // Reserve the last slot for the "+N more" marker when overflowing, so every
      // SHOWN chip keeps its full text.
      const chipCapacity = willOverflow ? CHIP_ROWS - 1 : CHIP_ROWS;
      const shown = dayEvents.slice(0, chipCapacity);
      stacks.push({
        col,
        chips: shown.map((event) => ({
          key: `${event.uid}:${w}`,
          title: event.title,
          time: chipTime(event),
          cat: categoryFor(event),
          isPast: startOfDay(event.start).getTime() < today.getTime(),
        })),
        more: willOverflow ? dayEvents.length - shown.length : 0,
      });
    }
    stacks.sort((a, b) => a.col - b.col);

    weeks.push({ weekStart, days, bars: barChips, stacks, barRows });
  }

  return {
    windowStart,
    windowEnd,
    weeks,
    rangeLabel: `${monthDay.format(windowStart)} – ${monthDay.format(windowEnd)}`,
  };
}

// ---------------------------------------------------------------------------
// "Up next" rail
// ---------------------------------------------------------------------------

export type UpNextItem = {
  key: string;
  dateLabel: string; // "Today", "Thu Oct 16", or "Oct 12-15" for ranges
  timeLabel: string; // "7:00 PM", "All day", "All week"
  title: string;
  location: string | null;
  isToday: boolean;
  accent: string; // acc-* class
};

const weekdayMonthDay = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

/**
 * The upcoming agenda list: events whose last visible day is today or later,
 * sorted by start, capped to `limit`. Date/time labels mirror the mockup —
 * "Today" for same-day, a compact inclusive range for multi-day, weekday+date
 * otherwise.
 */
export function buildUpNext(events: Event[], now: Date, limit: number): UpNextItem[] {
  const today = startOfDay(now);
  return events
    .filter((e) => lastVisibleDay(e).getTime() >= today.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .slice(0, limit)
    .map((event) => {
      const isToday = sameDay(event.start, now);
      const last = lastVisibleDay(event);
      const multi = isMultiDay(event);

      let dateLabel: string;
      let timeLabel: string;
      if (multi) {
        const sameMonth =
          event.start.getFullYear() === last.getFullYear() &&
          event.start.getMonth() === last.getMonth();
        dateLabel = sameMonth
          ? `${monthDay.format(event.start)}-${last.getDate()}`
          : `${monthDay.format(event.start)}-${monthDay.format(last)}`;
        timeLabel = 'All week';
      } else if (event.isAllDay) {
        dateLabel = isToday ? 'Today' : weekdayMonthDay.format(event.start);
        timeLabel = 'All day';
      } else {
        dateLabel = isToday ? 'Today' : weekdayMonthDay.format(event.start);
        timeLabel = timeFmt.format(event.start);
      }

      return {
        key: event.uid,
        dateLabel,
        timeLabel,
        title: event.title,
        location: event.location,
        isToday,
        accent: ACCENT_BY_CAT[categoryFor(event)],
      };
    });
}

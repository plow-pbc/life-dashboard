import { afterEach, describe, expect, it } from 'vitest';
import type { Event } from './types';
import {
  buildMonthLayout,
  buildUpNext,
  categoryFor,
  categoryOf,
  setCategoryRules,
  CATEGORY_CLASS,
  dayDiff,
  isMultiDay,
  lastVisibleDay,
  startOfWeek,
  CHIP_ROWS,
} from './calendarLayout';

// A fixed "now": Thursday 2026-10-15, 09:00 local (TZ pinned to LA in config).
const now = new Date(2026, 9, 15, 9, 0);

function timed(
  uid: string,
  title: string,
  start: [number, number, number, number, number],
  end: [number, number, number, number, number],
  location: string | null = null,
): Event {
  return {
    uid,
    title,
    start: new Date(start[0], start[1], start[2], start[3], start[4]),
    end: new Date(end[0], end[1], end[2], end[3], end[4]),
    isAllDay: false,
    location,
  };
}

function allDay(uid: string, title: string, start: [number, number, number], endExclusive: [number, number, number]): Event {
  return {
    uid,
    title,
    start: new Date(start[0], start[1], start[2]),
    end: new Date(endExclusive[0], endExclusive[1], endExclusive[2]),
    isAllDay: true,
    location: null,
  };
}

/** Every single-day chip across the whole layout (all weeks, all day stacks). */
function allChips(layout: ReturnType<typeof buildMonthLayout>) {
  return layout.weeks.flatMap((w) => w.stacks.flatMap((s) => s.chips));
}

describe('date helpers', () => {
  it('startOfWeek returns the Sunday on/before the date', () => {
    const sun = startOfWeek(now); // 2026-10-15 is Thursday → Sunday 2026-10-11
    expect(sun.getFullYear()).toBe(2026);
    expect(sun.getMonth()).toBe(9);
    expect(sun.getDate()).toBe(11);
    expect(sun.getDay()).toBe(0);
    expect(sun.getHours()).toBe(0);
  });

  it('dayDiff counts whole calendar days DST-safe', () => {
    expect(dayDiff(new Date(2026, 9, 11), new Date(2026, 9, 15))).toBe(4);
    // Across the US fall-back (2026-11-01) still a clean 2 days.
    expect(dayDiff(new Date(2026, 9, 31), new Date(2026, 10, 2))).toBe(2);
  });

  it('lastVisibleDay treats all-day DTEND as exclusive', () => {
    const e = allDay('a', 'Trip', [2026, 9, 12], [2026, 9, 15]); // 12,13,14
    expect(lastVisibleDay(e).getDate()).toBe(14);
  });

  it('lastVisibleDay keeps timed end date inclusive', () => {
    const e = timed('t', 'Mtg', [2026, 9, 15, 10, 0], [2026, 9, 15, 11, 0]);
    expect(lastVisibleDay(e).getDate()).toBe(15);
  });

  it('isMultiDay distinguishes spans from single days', () => {
    expect(isMultiDay(allDay('a', 'Trip', [2026, 9, 12], [2026, 9, 15]))).toBe(true);
    expect(isMultiDay(allDay('b', 'One', [2026, 9, 12], [2026, 9, 13]))).toBe(false);
    expect(isMultiDay(timed('t', 'Mtg', [2026, 9, 15, 10, 0], [2026, 9, 15, 11, 0]))).toBe(false);
  });

  it('categoryFor is stable and in-range for a given title', () => {
    const e = timed('x', 'Dentist', [2026, 9, 16, 9, 0], [2026, 9, 16, 10, 0]);
    expect(categoryFor(e)).toBe(categoryFor({ ...e, uid: 'different-uid' }));
    expect([
      'cat-cornflower',
      'cat-apricot',
      'cat-lavender',
      'cat-clay',
      'cat-seaglass',
    ]).toContain(categoryFor(e));
  });
});

describe('categoryOf (deterministic keyword heuristic)', () => {
  afterEach(() => setCategoryRules(null)); // reset any override

  const cat = (title: string) =>
    categoryOf(timed('u', title, [2026, 9, 16, 9, 0], [2026, 9, 16, 10, 0]));

  it('classifies real titles by keyword, not a hash', () => {
    expect(cat('Standup')).toBe('work');
    expect(cat('1:1 with manager')).toBe('work');
    expect(cat('Quarterly planning review meeting')).toBe('work');
    expect(cat('Fall break trip')).toBe('travel');
    expect(cat('Flight to Denver')).toBe('travel');
    expect(cat('Soccer practice at the north field')).toBe('family');
    expect(cat("Mom's birthday")).toBe('family');
    expect(cat('Thanksgiving')).toBe('family');
    expect(cat('Book club — chapter 7')).toBe('social');
    expect(cat('Date night at the Italian place')).toBe('social');
    expect(cat('Dentist')).toBe('reminder');
    expect(cat('Flu shot')).toBe('reminder');
    expect(cat('Grocery run')).toBe('reminder');
  });

  it('resolves overlaps by priority: family beats work/reminder', () => {
    // "call" is a Work keyword, but "mom" (Family) is checked first.
    expect(cat('Call Mom')).toBe('family');
    // "pick up" is a Reminder keyword, but "kids" (Family) wins.
    expect(cat('Pickup kids')).toBe('family');
  });

  it('falls back to the neutral default (reminder) for an unmatched title', () => {
    expect(cat('Zxqw')).toBe('reminder');
    expect(cat('')).toBe('reminder');
  });

  it('is tolerant of smart quotes, [brackets], emoji, and case', () => {
    expect(cat('[TENTATIVE] DENTIST 🦷')).toBe('reminder');
    expect(cat('Mom’s Birthday 🎂')).toBe('family'); // smart apostrophe
    expect(cat('[hold] Standup')).toBe('work');
  });

  it('matches whole words, not accidental substrings', () => {
    // "call" must not match inside "recall"; no other keyword hits → default.
    expect(cat('Recall notice')).toBe('reminder');
  });

  it('categoryFor maps the category to its color class', () => {
    expect(categoryFor(timed('u', 'Standup', [2026, 9, 16, 9, 0], [2026, 9, 16, 10, 0]))).toBe(
      CATEGORY_CLASS.work,
    );
    expect(categoryFor(timed('u', 'Fall break trip', [2026, 9, 16, 9, 0], [2026, 9, 16, 10, 0]))).toBe(
      CATEGORY_CLASS.travel,
    );
  });

  it('is config-overridable and resets to the built-in defaults', () => {
    setCategoryRules([{ category: 'social', keywords: ['standup'] }]);
    // Override wins: "Standup" is now social; built-in rules are replaced.
    expect(cat('Standup')).toBe('social');
    // A title the override does not mention falls to the neutral default.
    expect(cat('Dentist')).toBe('reminder');
    setCategoryRules(null); // reset
    expect(cat('Standup')).toBe('work');
  });
});

describe('buildMonthLayout', () => {
  it('builds a 13-week rolling window starting on the current Sunday', () => {
    const layout = buildMonthLayout([], now);
    expect(layout.weeks).toHaveLength(13);
    expect(layout.windowStart.getMonth()).toBe(9); // October
    expect(layout.windowStart.getDate()).toBe(11); // Sun Oct 11
    // 13 weeks = 91 days; last visible day is Oct 11 + 90 days = Sat Jan 9 2027.
    expect(layout.windowEnd.getFullYear()).toBe(2027);
    expect(layout.windowEnd.getMonth()).toBe(0); // January
    expect(layout.windowEnd.getDate()).toBe(9);
    expect(layout.weeks[0].days).toHaveLength(7);
    expect(layout.weeks[0].days[0].dayNumber).toBe(11);
    expect(layout.weeks[12].days[6].dayNumber).toBe(9); // Sat Jan 9 2027
  });

  it('marks today and dims past days', () => {
    const layout = buildMonthLayout([], now);
    const week0 = layout.weeks[0];
    const today = week0.days.find((d) => d.dayNumber === 15)!;
    expect(today.isToday).toBe(true);
    expect(today.isPast).toBe(false);
    // Sun–Wed (11–14) are before today.
    expect(week0.days.filter((d) => d.isPast).map((d) => d.dayNumber)).toEqual([11, 12, 13, 14]);
    // Future day not past/today.
    const fri = week0.days.find((d) => d.dayNumber === 16)!;
    expect(fri.isPast).toBe(false);
    expect(fri.isToday).toBe(false);
  });

  it('places a single timed event as a chip in its day column', () => {
    const e = timed('m', 'Standup', [2026, 9, 16, 10, 0], [2026, 9, 16, 10, 30]);
    const layout = buildMonthLayout([e], now);
    const stack = layout.weeks[0].stacks.find((s) => s.col === 6)!; // Fri → col 6 (Sun=1)
    expect(stack).toBeTruthy();
    expect(stack.more).toBe(0);
    expect(stack.chips).toHaveLength(1);
    expect(stack.chips[0].title).toBe('Standup');
    expect(stack.chips[0].time).toBe('10:00 AM');
  });

  it('stacks same-day single events contiguously, in order, with no gaps', () => {
    // Two events on the SAME day (Fri Oct 16) must land in ONE day stack, in
    // start order — the day owns its own top-to-bottom stack so there are no
    // week-wide "rows" to leave a gap between them.
    const a = timed('a', 'Gym', [2026, 9, 16, 17, 0], [2026, 9, 16, 18, 0]);
    const b = timed('b', 'Call Mom', [2026, 9, 16, 19, 0], [2026, 9, 16, 19, 30]);
    // A tall-titled event on a NEIGHBOURING day must not perturb the pair.
    const c = timed('c', 'Neighbourhood block party and potluck dinner', [2026, 9, 17, 16, 0], [2026, 9, 17, 20, 0]);
    const layout = buildMonthLayout([a, b, c], now);
    const fri = layout.weeks[0].stacks.find((s) => s.col === 6)!;
    expect(fri.chips.map((ch) => ch.title)).toEqual(['Gym', 'Call Mom']);
    expect(fri.more).toBe(0);
    // The neighbour's stack is wholly separate.
    const sat = layout.weeks[0].stacks.find((s) => s.col === 7)!;
    expect(sat.chips.map((ch) => ch.title)).toEqual([
      'Neighbourhood block party and potluck dinner',
    ]);
  });

  it('lays a multi-day event as a spanning bar within the week', () => {
    const trip = allDay('trip', 'Grandparents', [2026, 9, 12], [2026, 9, 15]); // 12–14
    const layout = buildMonthLayout([trip], now);
    const bar = layout.weeks[0].bars.find((b) => b.title === 'Grandparents')!;
    expect(bar).toBeTruthy();
    expect(bar.col).toBe(2); // Mon Oct 12 → col 2
    expect(bar.span).toBe(3); // 12,13,14
    expect(bar.row).toBe(1); // first bar-band row
    expect(bar.continuesLeft).toBe(false);
    expect(bar.continuesRight).toBe(false);
    // A multi-day event is never also a single-day stack chip.
    expect(layout.weeks[0].stacks).toHaveLength(0);
  });

  it('splits a bar that crosses a week boundary into two segments', () => {
    // Sat Oct 17 → Tue Oct 20 (all-day end exclusive 21) spans week0 and week1.
    const trip = allDay('v', 'Vacation', [2026, 9, 17], [2026, 9, 21]); // 17,18,19,20
    const layout = buildMonthLayout([trip], now);
    const seg0 = layout.weeks[0].bars.find((b) => b.title === 'Vacation')!;
    const seg1 = layout.weeks[1].bars.find((b) => b.title === 'Vacation')!;
    // week0: only Sat (col 7), continues right.
    expect(seg0.col).toBe(7);
    expect(seg0.span).toBe(1);
    expect(seg0.continuesRight).toBe(true);
    expect(seg0.continuesLeft).toBe(false);
    // week1: Sun–Tue (cols 1–3), continues left.
    expect(seg1.col).toBe(1);
    expect(seg1.span).toBe(3);
    expect(seg1.continuesLeft).toBe(true);
    expect(seg1.continuesRight).toBe(false);
  });

  it('stacks two overlapping multi-day bars into distinct bar-band rows', () => {
    const a = allDay('a', 'Trip A', [2026, 9, 12], [2026, 9, 15]); // Mon–Wed
    const b = allDay('b', 'Trip B', [2026, 9, 13], [2026, 9, 16]); // Tue–Thu (overlaps)
    const layout = buildMonthLayout([a, b], now);
    const rows = layout.weeks[0].bars.map((bar) => bar.row).sort();
    expect(rows).toEqual([1, 2]);
    expect(layout.weeks[0].barRows).toBe(2);
  });

  it('caps a rarely-overloaded day with a "+N more" marker (each shown chip full-text)', () => {
    const count = 7; // more than CHIP_ROWS fit on one day
    const many: Event[] = [];
    for (let i = 0; i < count; i++) {
      many.push(timed(`e${i}`, `Event ${i}`, [2026, 9, 16, 8 + i, 0], [2026, 9, 16, 9 + i, 0]));
    }
    const layout = buildMonthLayout(many, now);
    const col6 = layout.weeks[0].stacks.find((s) => s.col === 6)!;
    expect(col6).toBeTruthy();
    // CHIP_ROWS slots, one reserved for the marker → CHIP_ROWS-1 chips shown.
    expect(col6.chips).toHaveLength(CHIP_ROWS - 1);
    expect(col6.more).toBe(count - (CHIP_ROWS - 1));
  });

  it('ignores events outside the 13-week window', () => {
    // Feb 15 2027 is past the window end (Jan 9 2027); a past event is before it.
    const far = timed('far', 'Far future', [2027, 1, 15, 10, 0], [2027, 1, 15, 11, 0]);
    const old = timed('old', 'Long past', [2026, 8, 1, 10, 0], [2026, 8, 1, 11, 0]); // Sep 1 2026
    const layout = buildMonthLayout([far, old], now);
    expect(allChips(layout)).toHaveLength(0);
    expect(layout.weeks.flatMap((w) => w.bars)).toHaveLength(0);
  });

  it('plots EVERY in-window event in the grid (decoupled from the Up Next cap)', () => {
    // 20 single-day events on distinct future days inside the window (Oct 16 →
    // Nov 4 2026; JS Date normalizes day>31). The grid must show all of them.
    const many: Event[] = [];
    for (let i = 0; i < 20; i++) {
      many.push(timed(`g${i}`, `Grid event ${i}`, [2026, 9, 16 + i, 9, 0], [2026, 9, 16 + i, 10, 0]));
    }
    const layout = buildMonthLayout(many, now);
    // Month grid: no NEXT_N-style cap — all 20 appear.
    expect(allChips(layout)).toHaveLength(20);
    // The rail still re-caps to its own limit (NEXT_N = 15 in the build).
    expect(buildUpNext(many, now, 15)).toHaveLength(15);
  });
});

describe('buildUpNext', () => {
  const events: Event[] = [
    timed('a', 'Standup', [2026, 9, 15, 10, 0], [2026, 9, 15, 10, 30], 'Zoom'),
    timed('b', 'Date night', [2026, 9, 17, 18, 0], [2026, 9, 17, 20, 0]),
    allDay('c', 'Vacation', [2026, 9, 20], [2026, 9, 24]), // 20–23
    timed('past', 'Done', [2026, 9, 10, 9, 0], [2026, 9, 10, 10, 0]),
  ];

  it('drops past events, sorts by start, caps to limit', () => {
    const list = buildUpNext(events, now, 10);
    expect(list.map((i) => i.title)).toEqual(['Standup', 'Date night', 'Vacation']);
  });

  it('labels today, timed, all-day ranges correctly', () => {
    const list = buildUpNext(events, now, 10);
    const [standup, date, vacation] = list;
    expect(standup.dateLabel).toBe('Today');
    expect(standup.timeLabel).toBe('10:00 AM');
    expect(standup.location).toBe('Zoom');
    expect(standup.isToday).toBe(true);
    expect(date.dateLabel).toMatch(/Sat/);
    expect(vacation.timeLabel).toBe('All week');
    expect(vacation.dateLabel).toBe('Oct 20-23');
  });

  it('respects the limit', () => {
    expect(buildUpNext(events, now, 2)).toHaveLength(2);
  });
});

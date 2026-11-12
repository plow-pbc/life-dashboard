import { describe, it, expect } from 'vitest';
import type { Event } from '../types';
import {
  eventKind,
  eventsOn,
  formatDuration,
  hourLabel,
  monthDays,
  parseMinutes,
  upcomingHours,
  wordTitle,
  wxKind,
} from './widgetData';

describe('parseMinutes', () => {
  it.each([
    ['10 mins', 10],
    ['5 minutes', 5],
    ['1 hr', 60],
    ['1 hr 20 min', 80],
    ['1 hour 5 minutes', 65],
    ['45', 45],
    ['0 hours', null],
    ['', null],
    [null, null],
    ['overnight', null],
  ])('%s → %s', (text, min) => {
    expect(parseMinutes(text)).toEqual(min === null ? null : { lo: min, hi: min });
  });

  it.each([
    ['4-7hrs', 240, 420],
    ['5-10 minutes', 5, 10],
    ['8–10 hrs', 480, 600],
    ['2 to 3 hours', 120, 180],
  ])('reads the range %s as %i–%i min, not a sum', (text, lo, hi) => {
    expect(parseMinutes(text)).toEqual({ lo, hi });
  });
});

describe('formatDuration', () => {
  const one = (m: number) => formatDuration({ lo: m, hi: m });
  it('uses minutes under an hour, h:mm above', () => {
    expect(one(20)).toEqual({ value: '20', unit: 'min' });
    expect(one(80)).toEqual({ value: '1:20', unit: 'hr' });
    expect(one(120)).toEqual({ value: '2', unit: 'hr' });
  });

  it('shows a range in one unit', () => {
    expect(formatDuration({ lo: 5, hi: 10 })).toEqual({ value: '5–10', unit: 'min' });
    expect(formatDuration({ lo: 240, hi: 420 })).toEqual({ value: '4–7', unit: 'hr' });
    expect(formatDuration({ lo: 90, hi: 120 })).toEqual({ value: '1:30–2', unit: 'hr' });
  });
});

describe('month calendar', () => {
  // Wednesday 2026-11-11, 1pm. Nov 1 2026 is a Sunday.
  const now = new Date(2026, 10, 11, 13, 0);
  const ev = (uid: string, title: string, start: Date, end: Date, isAllDay = false): Event => ({
    uid,
    title,
    start,
    end,
    isAllDay,
    location: null,
  });
  const trash = ev('t', 'Trash', new Date(2026, 10, 12), new Date(2026, 10, 13), true);
  const dinner = ev('d', 'Family dinner', new Date(2026, 10, 13, 18), new Date(2026, 10, 13, 20));
  const trip = ev('v', 'Flight to Chicago', new Date(2026, 10, 25), new Date(2026, 10, 28), true);
  const old = ev('o', 'Dentist', new Date(2026, 10, 3, 9), new Date(2026, 10, 3, 10));
  const events = [dinner, trash, trip, old];

  it('lays out the whole month after the right number of blanks', () => {
    const { blanks, days } = monthDays(events, now);
    expect(blanks).toBe(0);
    expect(days).toHaveLength(30);
    expect(days[10]).toMatchObject({ day: 11, isToday: true, isPast: false, isWeekend: false });
    expect(days[9].isPast).toBe(true);
    expect(days[13].isWeekend).toBe(true); // Sat 14
    expect(monthDays([], new Date(2026, 11, 2)).blanks).toBe(2); // Dec 1 is a Tuesday
  });

  it('dots every day an event is on, today on, and none in the past', () => {
    const { days } = monthDays(events, now);
    expect(days[11].dots).toEqual(['trash']); // all day, not on the 13th
    expect(days[12].dots).toEqual(['dinner']);
    expect([24, 25, 26].map((i) => days[i].dots.length)).toEqual([1, 1, 1]); // 25–27
    expect(days[27].dots).toEqual([]); // exclusive all-day end
    expect(days[2].dots).toEqual([]); // past dentist
  });

  it('caps a busy day at three dots', () => {
    const busy = Array.from({ length: 5 }, (_, i) =>
      ev(`b${i}`, 'Thing', new Date(2026, 10, 20, 9 + i), new Date(2026, 10, 20, 10 + i)),
    );
    expect(monthDays(busy, now).days[19].dots).toHaveLength(3);
  });

  it("lists a day's events soonest first, multi-day ones included", () => {
    const lunch = ev('l', 'Lunch', new Date(2026, 10, 26, 12), new Date(2026, 10, 26, 13));
    expect(eventsOn([lunch, ...events], new Date(2026, 10, 26)).map((e) => e.uid)).toEqual([
      'v',
      'l',
    ]);
    expect(eventsOn(events, new Date(2026, 10, 14))).toEqual([]);
  });
});

describe('event colours', () => {
  // Invented titles, each in the colour the mockup gives its kind.
  it.each([
    ['Trash', 'trash'],
    ['\u{1F5D1}\uFE0F', 'trash'],
    ['Birthday Dinner for Alex', 'dinner'],
    ['Pat Turns 40!', 'bday'],
    ['Groomer · Rex', 'groom'],
    ['Z | Groomers', 'groom'],
    ['Trash & Recycling', 'recycle'],
    ['\u{1F5D1}\uFE0F \u267B\uFE0F', 'recycle'],
    ['Z | Book Club', 'club'],
    ['Family Dinner', 'dinner'],
    ['Flight to Chicago', 'travel'],
    ['Thanksgiving @ The Smiths', 'holiday'],
    ['Trash (holiday pickup)', 'trash'],
    ["Jordan's Birthday \u{1F389}", 'bday'],
  ])('%s is %s', (title, kind) => {
    expect(eventKind(title)).toBe(kind);
  });

  it('gives an unknown title the same colour every time', () => {
    expect(eventKind('Plumber')).toBe(eventKind('Plumber'));
  });
});

describe('wordTitle', () => {
  it.each([
    ['\u{1F5D1}\uFE0F', 'Trash'],
    ['\u{1F5D1}\uFE0F \u267B\uFE0F', 'Trash & Recycling'],
    ["Jordan's Birthday \u{1F389}", "Jordan's Birthday"],
    ['\u2708\uFE0F BOS to DEN (XY 123)', 'BOS to DEN (XY 123)'],
    ['Pat Turns 40!', 'Pat Turns 40!'],
    ['Z | book club', 'Z | book club'],
  ])('%s reads %s', (title, words) => {
    expect(wordTitle(title)).toBe(words);
  });
});

describe('weather hours', () => {
  const at = (h: number) => new Date(2026, 10, 11, h).toISOString();
  const hours = [7, 8, 9, 12, 13].map((h) => ({
    time: at(h),
    temp: 50 + h,
    condition: 'Sunny',
    isDaytime: true,
    precip: null,
  }));

  it('drops hours already over', () => {
    expect(upcomingHours(hours, new Date(2026, 10, 11, 8, 30), 3).map((h) => h.temp)).toEqual([
      58, 59, 62,
    ]);
  });

  it('labels Now, then the first hour and noon with AM/PM', () => {
    expect(hours.map((h, i) => hourLabel(h.time, i))).toEqual(['Now', '8 AM', '9', '12 PM', '1']);
  });

  it('maps NWS conditions to a glyph', () => {
    expect(wxKind('Mostly Sunny', true)).toBe('partly');
    expect(wxKind('Chance Rain Showers', false)).toBe('rain');
    expect(wxKind('Clear', false)).toBe('moon');
    expect(wxKind('Patchy Fog', true)).toBe('fog');
  });
});

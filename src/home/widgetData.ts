import { lastVisibleDay, sameDay, startOfDay } from '../calendarLayout';
import type { Event } from '../types';

// ---- recipe times ----------------------------------------------------------

export type Minutes = { lo: number; hi: number };

const UNIT = String.raw`(h(?:ou)?rs?|h\b|m(?:in(?:ute)?s?)?\b)`;
const toMin = (n: number, unit: string | undefined) => (unit?.startsWith('h') ? n * 60 : n);

/** Minutes in a free-text recipe time ("10 mins", "1 hr 20 min", "4-7hrs").
 *  A range ("5-10 minutes", "2 to 3 hours") keeps both ends, in the unit after
 *  the second number. Null when there's no number or it comes to zero. */
export function parseMinutes(text: string | null | undefined): Minutes | null {
  if (!text) return null;
  const t = text.toLowerCase();
  const range = new RegExp(
    String.raw`(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*${UNIT}?`,
  ).exec(t);
  if (range) {
    const lo = Math.round(toMin(Number(range[1]), range[3]));
    const hi = Math.round(toMin(Number(range[2]), range[3]));
    return hi > 0 ? { lo, hi } : null;
  }
  let total = 0;
  let found = false;
  for (const m of t.matchAll(new RegExp(String.raw`(\d+(?:\.\d+)?)\s*${UNIT}?`, 'g'))) {
    total += toMin(Number(m[1]), m[2]);
    found = true;
  }
  return found && total > 0 ? { lo: Math.round(total), hi: Math.round(total) } : null;
}

const hours = (min: number) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}:${String(m).padStart(2, '0')}` : String(h);
};

/** A duration for the big recipe numbers: "20" min, "1:20" hr, or a range in
 *  one unit ("5–10" min, "4–7" hr). */
export function formatDuration({ lo, hi }: Minutes): { value: string; unit: string } {
  if (hi < 60) return { value: lo === hi ? String(hi) : `${lo}–${hi}`, unit: 'min' };
  return { value: lo === hi ? hours(hi) : `${hours(lo)}–${hours(hi)}`, unit: 'hr' };
}

// ---- month calendar --------------------------------------------------------

export type MonthDay = {
  date: Date;
  day: number;
  isPast: boolean;
  isToday: boolean;
  isWeekend: boolean;
  /** The kinds of the day's events, one per event, at most MAX_DOTS. */
  dots: EventKind[];
};

const MAX_DOTS = 3;

// Each event gets its own colour by what it is, so the dots on a day tell its
// events apart. Checked in order: a birthday dinner is a dinner, and a pickup
// with recycling is recycling.
export type EventKind =
  | 'recycle'
  | 'trash'
  | 'dinner'
  | 'bday'
  | 'club'
  | 'groom'
  | 'travel'
  | 'holiday';
const KIND_RULES: [EventKind, RegExp][] = [
  ['recycle', /\u267B|recycl/i],
  ['trash', /\u{1F5D1}|trash|garbage/iu],
  ['dinner', /dinner|supper/i],
  ['bday', /birthday|anniversary|turns \d|\u{1F389}/iu],
  ['club', /club/i],
  ['groom', /groom/i],
  ['travel', /\u2708|flight|airport|trip/iu],
  ['holiday', /thanksgiving|christmas|hanukkah|easter|new year|holiday/i],
];
const KINDS = KIND_RULES.map(([k]) => k);

/** What an event is, for its colour. A title no rule knows still gets a
 *  steady colour of its own, picked from its text. */
export function eventKind(title: string): EventKind {
  for (const [kind, re] of KIND_RULES) if (re.test(title)) return kind;
  let h = 0;
  for (const ch of title) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return KINDS[h % KINDS.length];
}

// Titles on the wall are words: an emoji that IS the title becomes its word,
// any other emoji is dropped.
const EMOJI_WORDS: [RegExp, string][] = [
  [/\u{1F5D1}/u, 'Trash'],
  [/\u267B/, 'Recycling'],
];
const EMOJI = /[\p{Extended_Pictographic}\uFE0F\u200D]/gu;

/** The title in words: "\u{1F5D1}\uFE0F \u267B\uFE0F" reads "Trash & Recycling",
 *  "Jordan's Birthday \u{1F389}" reads "Jordan's Birthday". */
export function wordTitle(title: string): string {
  const bare = title.replace(EMOJI, '').trim();
  if (bare) return bare.replace(/\s{2,}/g, ' ');
  const words: string[] = [];
  for (const [re, word] of EMOJI_WORDS) if (re.test(title)) words.push(word);
  return words.join(' & ') || title.trim();
}

/** Whether an event is on a given day (multi-day events count on every day). */
function isOn(event: Event, day: Date): boolean {
  const d = startOfDay(day).getTime();
  return startOfDay(event.start).getTime() <= d && d <= lastVisibleDay(event).getTime();
}

/** The events on one day, soonest first. */
export function eventsOn(events: Event[], day: Date): Event[] {
  return events.filter((e) => isOn(e, day)).sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** The calendar month containing `now`: how many blank cells lead the first
 *  week (weeks start Sunday), then every day. Only today and later get dots. */
export function monthDays(events: Event[], now: Date): { blanks: number; days: MonthDay[] } {
  const today = startOfDay(now);
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const count = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const days: MonthDay[] = [];
  for (let n = 1; n <= count; n++) {
    const date = new Date(now.getFullYear(), now.getMonth(), n);
    const isPast = date.getTime() < today.getTime();
    days.push({
      date,
      day: n,
      isPast,
      isToday: sameDay(date, today),
      isWeekend: date.getDay() === 0 || date.getDay() === 6,
      dots: isPast
        ? []
        : eventsOn(events, date)
            .slice(0, MAX_DOTS)
            .map((e) => eventKind(e.title)),
    });
  }
  return { blanks: first.getDay(), days };
}

// ---- weather hours ---------------------------------------------------------

export type Hour = {
  time: string;
  temp: number;
  condition: string;
  isDaytime: boolean;
  precip: number | null;
};

const HOUR_MS = 60 * 60_000;

/** The hours from the current one onward (the snapshot can be up to a refresh old). */
export function upcomingHours(hours: readonly Hour[], now: Date, count: number): Hour[] {
  return hours.filter((h) => Date.parse(h.time) + HOUR_MS > now.getTime()).slice(0, count);
}

/** Strip labels: "Now", then the hour, with AM/PM on the first and at noon/midnight. */
export function hourLabel(iso: string, index: number): string {
  if (index === 0) return 'Now';
  const d = new Date(iso);
  const h = d.getHours();
  const h12 = h % 12 || 12;
  return index === 1 || h % 12 === 0 ? `${h12} ${h < 12 ? 'AM' : 'PM'}` : String(h12);
}

export type WxKind =
  | 'sun'
  | 'moon'
  | 'partly'
  | 'partly-night'
  | 'cloud'
  | 'rain'
  | 'storm'
  | 'snow'
  | 'fog';

/** A glyph for an NWS short forecast ("Mostly Sunny", "Chance Rain Showers"). */
export function wxKind(condition: string, isDaytime: boolean): WxKind {
  const c = condition.toLowerCase();
  if (/thunder|storm/.test(c)) return 'storm';
  if (/snow|sleet|flurr|ice/.test(c)) return 'snow';
  if (/rain|shower|drizzle/.test(c)) return 'rain';
  if (/fog|haze|smoke|mist/.test(c)) return 'fog';
  if (/partly|mostly sunny|mostly clear/.test(c)) return isDaytime ? 'partly' : 'partly-night';
  if (/cloud|overcast/.test(c)) return 'cloud';
  return isDaytime ? 'sun' : 'moon';
}

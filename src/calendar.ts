import { parseICS } from './ical';
import type { Event } from './types';

type Fetcher = (input: string) => Promise<Response>;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

type FeedEvent = {
  uid: string;
  title: string;
  start: string;
  end: string;
  isAllDay: boolean;
  location: string | null;
  calendar: string | null;
};

type CalendarFeed = {
  generated_at: string;
  window_days: number;
  events: FeedEvent[];
};

export type CalendarResult =
  | { kind: 'ready'; events: Event[]; staleGeneratedAt: Date | null }
  | { kind: 'error' };

export async function loadCalendarEvents(
  fetcher: Fetcher,
  now: Date,
  n: number,
  maxAgeMs: number,
): Promise<CalendarResult> {
  const feed = await fetchFeed(fetcher);
  if (feed && now.getTime() - Date.parse(feed.generated_at) < maxAgeMs) {
    return { kind: 'ready', events: feedEvents(feed, now, n), staleGeneratedAt: null };
  }

  try {
    const response = await fetcher('api/ical');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const events = parseICS(await response.text(), now, n);
    return { kind: 'ready', events, staleGeneratedAt: null };
  } catch {
    if (feed) {
      return {
        kind: 'ready',
        events: feedEvents(feed, now, n),
        staleGeneratedAt: new Date(feed.generated_at),
      };
    }
    return { kind: 'error' };
  }
}

async function fetchFeed(fetcher: Fetcher): Promise<CalendarFeed | null> {
  try {
    const response = await fetcher('api/calendar');
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return isCalendarFeed(body) ? body : null;
  } catch {
    return null;
  }
}

function feedEvents(feed: CalendarFeed, now: Date, n: number): Event[] {
  return feed.events
    .map((event) => ({
      ...event,
      start: new Date(event.start),
      end: new Date(event.end),
    }))
    .filter((event) => event.end >= now)
    .slice(0, n);
}

function isCalendarFeed(value: unknown): value is CalendarFeed {
  if (!isObject(value)) return false;
  if (!isDateTime(value.generated_at)) return false;
  if (
    typeof value.window_days !== 'number' ||
    !Number.isInteger(value.window_days) ||
    value.window_days <= 0
  ) {
    return false;
  }
  if (!Array.isArray(value.events)) return false;
  return value.events.every(isFeedEvent);
}

function isFeedEvent(value: unknown): value is FeedEvent {
  if (!isObject(value)) return false;
  if (typeof value.isAllDay !== 'boolean') return false;
  const datesValid = value.isAllDay
    ? isDate(value.start) && isDate(value.end)
    : isDateTime(value.start) && isDateTime(value.end);
  return (
    typeof value.uid === 'string' &&
    typeof value.title === 'string' &&
    datesValid &&
    (value.location === null || typeof value.location === 'string') &&
    (value.calendar === null || typeof value.calendar === 'string')
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isDateTime(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    DATE_TIME.test(value) &&
    isDate(value.slice(0, 10)) &&
    !Number.isNaN(Date.parse(value))
  );
}

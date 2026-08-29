import { parseICS } from './ical';
import type { Event } from './types';

type Fetcher = (input: string) => Promise<Response>;

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
    return (await response.json()) as CalendarFeed;
  } catch {
    return null;
  }
}

function feedEvents(feed: CalendarFeed, now: Date, n: number): Event[] {
  return feed.events
    .map((event) => ({
      ...event,
      start: parseFeedDate(event.start),
      end: parseFeedDate(event.end),
    }))
    .filter((event) => event.end >= now)
    .slice(0, n);
}

function parseFeedDate(value: string): Date {
  if (value.includes('T')) return new Date(value);
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

import { describe, expect, it, vi } from 'vitest';
import { calendar, vevent } from '../test/fixtures';
import { loadCalendarEvents, type CalendarResult } from './calendar';

const now = new Date('2026-08-29T04:10:00Z');

const feed = {
  generated_at: '2026-08-29T04:00:00Z',
  window_days: 7,
  events: [
    {
      uid: 'feed-event',
      title: 'From pushed feed',
      start: '2026-08-29T10:00:00-07:00',
      end: '2026-08-29T11:00:00-07:00',
      isAllDay: false,
      location: 'Kitchen',
      calendar: null,
    },
  ],
};

const pushedEvent = {
  ...feed.events[0],
  start: new Date(feed.events[0].start),
  end: new Date(feed.events[0].end),
};

const staleFeed = {
  ...feed,
  generated_at: '2026-08-29T03:00:00Z',
  events: [
    {
      ...feed.events[0],
      uid: 'ended',
      title: 'Already ended',
      start: '2026-08-28T19:00:00-07:00',
      end: '2026-08-28T20:00:00-07:00',
    },
    ...feed.events,
  ],
};

const ics = calendar(
  vevent({
    UID: 'ics-event',
    SUMMARY: 'From ICS fallback',
    DTSTART: '20260829T180000Z',
    DTEND: '20260829T190000Z',
  }),
);

type PriorityCase = {
  name: string;
  responses: () => Response[];
  expected: CalendarResult;
  urls: string[];
};

const priorityCases: PriorityCase[] = [
  {
    name: 'fresh feed wins without fetching ICS',
    responses: () => [new Response(JSON.stringify(feed))],
    expected: { kind: 'ready', events: [pushedEvent], staleGeneratedAt: null },
    urls: ['api/calendar'],
  },
  {
    name: 'ICS wins over a stale feed',
    responses: () => [new Response(JSON.stringify(staleFeed)), new Response(ics)],
    expected: {
      kind: 'ready',
      events: [
        {
          uid: 'ics-event',
          title: 'From ICS fallback',
          start: new Date('2026-08-29T18:00:00Z'),
          end: new Date('2026-08-29T19:00:00Z'),
          isAllDay: false,
          location: null,
        },
      ],
      staleGeneratedAt: null,
    },
    urls: ['api/calendar', 'api/ical'],
  },
  {
    name: 'stale feed wins when ICS fails',
    responses: () => [
      new Response(JSON.stringify(staleFeed)),
      new Response('Upstream unreachable', { status: 502 }),
    ],
    expected: {
      kind: 'ready',
      events: [pushedEvent],
      staleGeneratedAt: new Date(staleFeed.generated_at),
    },
    urls: ['api/calendar', 'api/ical'],
  },
  {
    name: 'failure is returned when neither source is available',
    responses: () => [
      new Response('not found', { status: 404 }),
      new Response('Upstream unreachable', { status: 502 }),
    ],
    expected: { kind: 'error' },
    urls: ['api/calendar', 'api/ical'],
  },
];

describe('loadCalendarEvents', () => {
  it.each(priorityCases)('$name', async ({ responses, expected, urls }) => {
    const fetcher = vi.fn();
    for (const response of responses()) fetcher.mockResolvedValueOnce(response);

    await expect(loadCalendarEvents(fetcher, now, 12, 30 * 60_000)).resolves.toEqual(expected);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(urls);
  });

  it('returns a ready empty result when ICS succeeds with no upcoming events', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))
      .mockResolvedValueOnce(new Response(calendar('')));

    await expect(loadCalendarEvents(fetcher, now, 12, 30 * 60_000)).resolves.toEqual({
      kind: 'ready',
      events: [],
      staleGeneratedAt: null,
    });
  });

  it('filters ended feed events before applying the display limit', async () => {
    const freshFeed = {
      ...feed,
      events: [
        {
          ...feed.events[0],
          uid: 'ended',
          title: 'Already ended',
          start: '2026-08-28T19:00:00-07:00',
          end: '2026-08-28T20:00:00-07:00',
        },
        feed.events[0],
        { ...feed.events[0], uid: 'later', title: 'Later event' },
      ],
    };
    const fetcher = vi.fn(async () => new Response(JSON.stringify(freshFeed)));

    const result = await loadCalendarEvents(fetcher, now, 1, 30 * 60_000);

    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') throw new Error('expected ready result');
    expect(result.events.map((event) => event.title)).toEqual(['From pushed feed']);
  });

  it('parses all-day date-only values as local calendar dates', async () => {
    const allDayFeed = {
      ...feed,
      events: [
        {
          ...feed.events[0],
          start: '2026-08-30',
          end: '2026-08-31',
          isAllDay: true,
        },
      ],
    };
    const fetcher = vi.fn(async () => new Response(JSON.stringify(allDayFeed)));

    const result = await loadCalendarEvents(fetcher, now, 12, 30 * 60_000);

    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') throw new Error('expected ready result');
    expect(result.events[0]?.start.toISOString()).toBe('2026-08-30T07:00:00.000Z');
    expect(result.events[0]?.start.getDate()).toBe(30);
    expect(result.events[0]?.end.getDate()).toBe(31);
  });
});

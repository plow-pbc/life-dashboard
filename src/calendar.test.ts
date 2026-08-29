import { describe, expect, it, vi } from 'vitest';
import { calendar, vevent } from '../test/fixtures';
import { loadCalendarEvents } from './calendar';

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

describe('loadCalendarEvents', () => {
  it('prefers a fresh pushed feed without fetching ICS', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(feed)));

    const result = await loadCalendarEvents(fetcher, now, 12, 30 * 60_000);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('api/calendar');
    expect(result).toEqual({
      kind: 'ready',
      events: [
        {
          uid: 'feed-event',
          title: 'From pushed feed',
          start: new Date('2026-08-29T10:00:00-07:00'),
          end: new Date('2026-08-29T11:00:00-07:00'),
          isAllDay: false,
          location: 'Kitchen',
          calendar: null,
        },
      ],
      staleGeneratedAt: null,
    });
  });

  it('falls back to the existing ICS path when the pushed feed is stale', async () => {
    const staleFeed = { ...feed, generated_at: '2026-08-29T03:00:00Z' };
    const ics = calendar(
      vevent({
        UID: 'ics-event',
        SUMMARY: 'From ICS fallback',
        DTSTART: '20260829T180000Z',
        DTEND: '20260829T190000Z',
      }),
    );
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(staleFeed)))
      .mockResolvedValueOnce(new Response(ics));

    const result = await loadCalendarEvents(fetcher, now, 12, 30 * 60_000);

    expect(fetcher.mock.calls).toEqual([['api/calendar'], ['api/ical']]);
    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') throw new Error('expected ready result');
    expect(result.events.map((event) => event.title)).toEqual(['From ICS fallback']);
    expect(result.staleGeneratedAt).toBeNull();
  });

  it('renders a stale feed with its generation time when ICS is unavailable', async () => {
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
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(staleFeed)))
      .mockResolvedValueOnce(new Response('Upstream unreachable', { status: 502 }));

    const result = await loadCalendarEvents(fetcher, now, 12, 30 * 60_000);

    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') throw new Error('expected ready result');
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.title).toBe('From pushed feed');
    expect(result.staleGeneratedAt).toEqual(new Date('2026-08-29T03:00:00Z'));
  });

  it('returns an error when neither a valid feed nor ICS is available', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"events":"not-an-array"}'))
      .mockResolvedValueOnce(new Response('Upstream unreachable', { status: 502 }));

    await expect(loadCalendarEvents(fetcher, now, 12, 30 * 60_000)).resolves.toEqual({
      kind: 'error',
    });
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
});

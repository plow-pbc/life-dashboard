import { describe, it, expect } from 'vitest';
import { parseICS } from './ical';
import { calendar, vevent } from '../test/fixtures';

const NOW = new Date('2026-05-18T12:00:00Z');

describe('parseICS', () => {
  it('returns empty array for a calendar with no events', () => {
    expect(parseICS(calendar(''), NOW, 12)).toEqual([]);
  });

  it('parses a single future timed event', () => {
    const ics = calendar(
      vevent({
        UID: 'test-1',
        SUMMARY: 'Test Event',
        DTSTART: '20260520T150000Z',
        DTEND: '20260520T160000Z',
        LOCATION: 'Test Room',
      }),
    );
    const result = parseICS(ics, NOW, 12);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      uid: 'test-1',
      title: 'Test Event',
      location: 'Test Room',
      isAllDay: false,
    });
    expect(result[0].start.toISOString()).toBe('2026-05-20T15:00:00.000Z');
    expect(result[0].end.toISOString()).toBe('2026-05-20T16:00:00.000Z');
  });

  it('parses an all-day event', () => {
    const ics = calendar(
      vevent({
        UID: 'allday-1',
        SUMMARY: 'Holiday',
        'DTSTART;VALUE=DATE': '20260525',
        'DTEND;VALUE=DATE': '20260526',
      }),
    );
    const result = parseICS(ics, NOW, 12);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      uid: 'allday-1',
      title: 'Holiday',
      isAllDay: true,
      location: null,
    });
  });

  it('filters out events that have already ended', () => {
    const ics = calendar(
      vevent({
        UID: 'past',
        SUMMARY: 'Past Event',
        DTSTART: '20260101T100000Z',
        DTEND: '20260101T110000Z',
      }) +
        '\r\n' +
        vevent({
          UID: 'future',
          SUMMARY: 'Future Event',
          DTSTART: '20260601T100000Z',
          DTEND: '20260601T110000Z',
        }),
    );
    const result = parseICS(ics, NOW, 12);
    expect(result).toHaveLength(1);
    expect(result[0].uid).toBe('future');
  });

  it('sorts events by start ascending', () => {
    const ics = calendar(
      vevent({
        UID: 'later',
        SUMMARY: 'Later',
        DTSTART: '20260601T100000Z',
        DTEND: '20260601T110000Z',
      }) +
        '\r\n' +
        vevent({
          UID: 'earlier',
          SUMMARY: 'Earlier',
          DTSTART: '20260520T100000Z',
          DTEND: '20260520T110000Z',
        }),
    );
    const result = parseICS(ics, NOW, 12);
    expect(result.map((e) => e.uid)).toEqual(['earlier', 'later']);
  });

  it('caps results at n', () => {
    const events = Array.from({ length: 5 }, (_, i) =>
      vevent({
        UID: `e-${i}`,
        SUMMARY: `Event ${i}`,
        DTSTART: `202606${String(i + 1).padStart(2, '0')}T100000Z`,
        DTEND: `202606${String(i + 1).padStart(2, '0')}T110000Z`,
      }),
    ).join('\r\n');
    const result = parseICS(calendar(events), NOW, 3);
    expect(result).toHaveLength(3);
    expect(result.map((e) => e.uid)).toEqual(['e-0', 'e-1', 'e-2']);
  });

  it('expands recurring events into multiple occurrences with unique uids', () => {
    const ics = calendar(
      vevent({
        UID: 'weekly',
        SUMMARY: 'Weekly Standup',
        DTSTART: '20260520T150000Z',
        DTEND: '20260520T153000Z',
        RRULE: 'FREQ=WEEKLY;COUNT=4',
      }),
    );
    const result = parseICS(ics, NOW, 12);
    expect(result).toHaveLength(4);
    expect(result.every((e) => e.title === 'Weekly Standup')).toBe(true);
    // Each occurrence must have a unique key for React rendering.
    const uids = new Set(result.map((e) => e.uid));
    expect(uids.size).toBe(4);
  });

  it('returns null location when LOCATION is absent', () => {
    const ics = calendar(
      vevent({
        UID: 'no-loc',
        SUMMARY: 'No Location',
        DTSTART: '20260520T150000Z',
        DTEND: '20260520T160000Z',
      }),
    );
    const result = parseICS(ics, NOW, 12);
    expect(result[0].location).toBeNull();
  });

  it('drops standalone events with STATUS:CANCELLED', () => {
    const ics = calendar(
      vevent({
        UID: 'live',
        SUMMARY: 'Live Event',
        DTSTART: '20260520T150000Z',
        DTEND: '20260520T160000Z',
      }) +
        '\r\n' +
        vevent({
          UID: 'cancelled',
          SUMMARY: 'Cancelled Event',
          DTSTART: '20260521T150000Z',
          DTEND: '20260521T160000Z',
          STATUS: 'CANCELLED',
        }),
    );
    const result = parseICS(ics, NOW, 12);
    expect(result).toHaveLength(1);
    expect(result[0].uid).toBe('live');
  });

  it('drops cancelled instances of a recurring event', () => {
    const ics = calendar(
      vevent({
        UID: 'weekly',
        SUMMARY: 'Weekly Standup',
        DTSTART: '20260520T150000Z',
        DTEND: '20260520T153000Z',
        RRULE: 'FREQ=WEEKLY;COUNT=4',
      }) +
        '\r\n' +
        vevent({
          UID: 'weekly',
          SUMMARY: 'Cancelled Standup',
          DTSTART: '20260603T150000Z',
          DTEND: '20260603T153000Z',
          'RECURRENCE-ID': '20260603T150000Z',
          STATUS: 'CANCELLED',
        }),
    );
    const result = parseICS(ics, NOW, 12);
    // 4 weekly slots, third (2026-06-03) cancelled → 3 events.
    expect(result).toHaveLength(3);
    const atCancelledSlot = result.find(
      (e) => e.start.toISOString() === '2026-06-03T15:00:00.000Z',
    );
    expect(atCancelledSlot).toBeUndefined();
  });

  it('applies recurring-event overrides instead of double-rendering them', () => {
    // Master: weekly meeting at 15:00Z for 4 weeks.
    // Override: 3rd occurrence (2026-06-03) moved to 17:00Z with a new title.
    const ics = calendar(
      vevent({
        UID: 'weekly',
        SUMMARY: 'Weekly Standup',
        DTSTART: '20260520T150000Z',
        DTEND: '20260520T153000Z',
        RRULE: 'FREQ=WEEKLY;COUNT=4',
      }) +
        '\r\n' +
        vevent({
          UID: 'weekly',
          SUMMARY: 'Moved Standup',
          DTSTART: '20260603T170000Z',
          DTEND: '20260603T173000Z',
          'RECURRENCE-ID': '20260603T150000Z',
        }),
    );
    const result = parseICS(ics, NOW, 12);
    // 4 weekly occurrences, not 5 (override replaces, doesn't add).
    expect(result).toHaveLength(4);
    // The override appears at its new time with its new title.
    const moved = result.find((e) => e.title === 'Moved Standup');
    expect(moved).toBeDefined();
    expect(moved!.start.toISOString()).toBe('2026-06-03T17:00:00.000Z');
    // The original 15:00 slot on 2026-06-03 must NOT appear.
    const originalAtMovedSlot = result.find(
      (e) =>
        e.title === 'Weekly Standup' && e.start.toISOString() === '2026-06-03T15:00:00.000Z',
    );
    expect(originalAtMovedSlot).toBeUndefined();
  });
});

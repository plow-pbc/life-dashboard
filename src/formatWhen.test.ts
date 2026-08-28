import { describe, it, expect } from 'vitest';
import { formatWhenParts } from './formatWhen';

describe('formatWhenParts', () => {
  it('formats a single-day all-day event with weekday, month, day, and "all day"', () => {
    // Local time, no Z — interpreted in the host timezone.
    const start = new Date(2026, 4, 23); // May 23 2026 (month is 0-indexed)
    const end = new Date(2026, 4, 24); // exclusive — same calendar day
    expect(formatWhenParts(start, end, true)).toEqual({ date: 'Sat, May 23', time: 'all day' });
  });

  it('formats a same-month multi-day all-day range compactly (no weekday/year)', () => {
    // "Family vacation Jun 1–7" — DTEND is exclusive (Jun 8), so last visible day is Jun 7.
    // Compact rail form ("Jun 1-7") so the date fits one line; weekday/year dropped.
    const start = new Date(2026, 5, 1); // Mon Jun 1 2026
    const end = new Date(2026, 5, 8); // exclusive — last day is Jun 7
    expect(formatWhenParts(start, end, true)).toEqual({ date: 'Jun 1-7', time: 'all day' });
  });

  it('formats a cross-month multi-day all-day range as "Jun 15-Jul 2" (no spaces)', () => {
    const start = new Date(2026, 5, 15); // Jun 15 2026
    const end = new Date(2026, 6, 3); // exclusive — last day is Jul 2
    expect(formatWhenParts(start, end, true)).toEqual({ date: 'Jun 15-Jul 2', time: 'all day' });
  });

  it('handles all-day ranges that cross a DST boundary (inclusive last day)', () => {
    // US spring-forward 2026 is Sun Mar 8 02:00 → 03:00. A trip Mar 7–8 has
    // DTSTART Mar 7, DTEND Mar 9 (exclusive). The last visible day must be Mar 8.
    // A naive end - 86_400_000 ms would land at Mar 7 23:00 EST and format as Mar 7.
    const start = new Date(2026, 2, 7); // Sat Mar 7 2026
    const end = new Date(2026, 2, 9); // exclusive — last day must be Mar 8 → "Mar 7-8"
    expect(formatWhenParts(start, end, true)).toEqual({ date: 'Mar 7-8', time: 'all day' });
  });

  it('formats a timed event with weekday/month/day date and a clock time', () => {
    const start = new Date(2026, 4, 23, 15, 0); // May 23 2026, 3:00 PM local
    const end = new Date(2026, 4, 23, 16, 0);
    // Time format depends on locale; assert structure not exact string.
    const { date, time } = formatWhenParts(start, end, false);
    expect(date).toBe('Sat, May 23');
    expect(time).toMatch(/^\d{1,2}:\d{2}\s?(AM|PM)$/);
  });

  it('uses two-digit minutes', () => {
    const start = new Date(2026, 4, 23, 9, 5); // 9:05 AM
    const end = new Date(2026, 4, 23, 10, 5);
    expect(formatWhenParts(start, end, false).time).toMatch(/9:05/);
  });
});

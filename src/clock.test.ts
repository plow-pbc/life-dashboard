import { describe, it, expect } from 'vitest';
import { clockOffsetMs, clockParts } from './clock';

describe('clockParts', () => {
  it('drops AM/PM and splits the date into weekday and month/day', () => {
    expect(clockParts(new Date(2026, 10, 11, 8, 2))).toEqual({
      time: '8:02',
      weekday: 'Wednesday',
      monthDay: 'November 11',
    });
  });

  it('shows midnight and afternoon in 12-hour form', () => {
    expect(clockParts(new Date(2026, 10, 11, 0, 5)).time).toBe('12:05');
    expect(clockParts(new Date(2026, 10, 11, 16, 12)).time).toBe('4:12');
  });
});

describe('clockOffsetMs', () => {
  const real = new Date(2026, 10, 11, 11, 30);
  it('is zero without ?at= or with a bad value', () => {
    expect(clockOffsetMs('', real)).toBe(0);
    expect(clockOffsetMs('?at=soon', real)).toBe(0);
  });
  it('shifts to HH:MM today', () => {
    expect(new Date(real.getTime() + clockOffsetMs('?at=08:00', real))).toEqual(
      new Date(2026, 10, 11, 8, 0),
    );
  });
  it('shifts to a full local date-time', () => {
    expect(new Date(real.getTime() + clockOffsetMs('?at=2026-11-12T18:45', real))).toEqual(
      new Date(2026, 10, 12, 18, 45),
    );
  });
});

import { describe, it, expect } from 'vitest';
import { sunTimes } from './sun.js';

const minutesOff = (a, iso) => Math.abs(a.getTime() - Date.parse(iso)) / 60_000;

describe('sunTimes', () => {
  // Published almanac times for San Francisco on the 2026 June solstice:
  // sunrise 5:48 AM PDT, sunset 8:35 PM PDT.
  it('matches the almanac within a few minutes', () => {
    const { sunrise, sunset } = sunTimes(new Date(2026, 5, 21, 12), 37.7749, -122.4194);
    expect(minutesOff(sunrise, '2026-06-21T12:48:00Z')).toBeLessThan(4);
    expect(minutesOff(sunset, '2026-06-22T03:35:00Z')).toBeLessThan(4);
  });

  it('returns nulls when the sun never sets', () => {
    expect(sunTimes(new Date(2026, 5, 21, 12), 78.2, 15.6)).toEqual({
      sunrise: null,
      sunset: null,
    });
  });
});

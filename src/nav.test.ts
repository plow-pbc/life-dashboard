import { describe, expect, it } from 'vitest';
import { DEFAULT_TAB, TABS, hashForTab, tabFromHash } from './nav';

describe('tabFromHash', () => {
  it('maps the known hashes to their tab', () => {
    expect(tabFromHash('#home')).toBe('home');
    expect(tabFromHash('#calendar')).toBe('calendar');
    expect(tabFromHash('#meals')).toBe('meals');
  });

  it('is case-insensitive and tolerates a missing leading #', () => {
    expect(tabFromHash('CALENDAR')).toBe('calendar');
    expect(tabFromHash('#Meals')).toBe('meals');
  });

  it('falls back to Home for a bare / empty / unknown hash (hourly recycle → Home)', () => {
    expect(tabFromHash('')).toBe('home');
    expect(tabFromHash('#')).toBe('home');
    expect(tabFromHash('#notes')).toBe('home');
    expect(tabFromHash('#home/extra')).toBe('home');
  });

  it('round-trips every tab through hashForTab (so a reload stays put)', () => {
    for (const t of TABS) expect(tabFromHash(hashForTab(t))).toBe(t);
  });

  it('defaults to home', () => {
    expect(DEFAULT_TAB).toBe('home');
  });

  it('keys on the first segment, so any trailing hash detail still resolves to its tab', () => {
    expect(tabFromHash('#meals/anything')).toBe('meals');
    expect(tabFromHash('#MEALS/x/y')).toBe('meals');
  });
});

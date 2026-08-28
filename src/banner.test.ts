import { describe, it, expect } from 'vitest';
import { hourlyIndex, stepIndex, swipeDir, BANNER_ROTATE_MS } from './banner';

describe('hourlyIndex (baseline auto-rotation)', () => {
  it('indexes by the wall-clock hour, modulo the count', () => {
    const now = 100 * BANNER_ROTATE_MS + 5_000; // hour 100, +5s
    expect(hourlyIndex(6, now)).toBe(100 % 6); // 4
    expect(hourlyIndex(6, now + BANNER_ROTATE_MS)).toBe(101 % 6); // next hour advances
  });
});

describe('stepIndex (next / prev with wrap-around)', () => {
  it('next advances and wraps at the end', () => {
    expect(stepIndex(2, 6, 1)).toBe(3);
    expect(stepIndex(5, 6, 1)).toBe(0); // wrap forward
  });
  it('prev goes back and wraps at the start', () => {
    expect(stepIndex(2, 6, -1)).toBe(1);
    expect(stepIndex(0, 6, -1)).toBe(5); // wrap backward
  });
  it('single image stays put', () => {
    expect(stepIndex(0, 1, 1)).toBe(0);
    expect(stepIndex(0, 1, -1)).toBe(0);
  });
});

describe('swipeDir (left → next, right → prev; ignore small / vertical)', () => {
  it('a clear left swipe → next (+1)', () => {
    expect(swipeDir(-60, 4)).toBe(1);
  });
  it('a clear right swipe → prev (-1)', () => {
    expect(swipeDir(60, -4)).toBe(-1);
  });
  it('ignores a sub-threshold move (a tap / tiny drag)', () => {
    expect(swipeDir(-30, 0)).toBe(0);
    expect(swipeDir(44, 0)).toBe(0);
  });
  it('ignores a mostly-vertical gesture', () => {
    expect(swipeDir(-50, 70)).toBe(0); // |dx| < |dy|
    expect(swipeDir(50, 50)).toBe(0); // equal → not horizontal
  });
  it('respects a horizontal swipe with some vertical drift', () => {
    expect(swipeDir(60, -49)).toBe(-1); // |60| > |49| → horizontal (right → prev)
  });
});

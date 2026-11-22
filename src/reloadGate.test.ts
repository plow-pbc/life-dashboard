import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReloadGate } from './reloadGate';

describe('createReloadGate', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reloads after the delay on a tab other than Meals', () => {
    const reload = vi.fn();
    createReloadGate('home', 1000, reload);
    vi.advanceTimersByTime(999);
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('holds the reload while Meals is showing', () => {
    const reload = vi.fn();
    createReloadGate('meals', 1000, reload);
    vi.advanceTimersByTime(60_000);
    expect(reload).not.toHaveBeenCalled();
  });

  it('runs a held reload as soon as the wall leaves Meals', () => {
    const reload = vi.fn();
    const gate = createReloadGate('home', 1000, reload);
    gate.setTab('meals');
    vi.advanceTimersByTime(5000);
    expect(reload).not.toHaveBeenCalled();
    gate.setTab('calendar');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload early when leaving Meals before it is due', () => {
    const reload = vi.fn();
    const gate = createReloadGate('meals', 1000, reload);
    gate.setTab('home');
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('never reloads after stop', () => {
    const reload = vi.fn();
    const gate = createReloadGate('home', 1000, reload);
    gate.stop();
    vi.advanceTimersByTime(5000);
    expect(reload).not.toHaveBeenCalled();
  });
});

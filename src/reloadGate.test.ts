import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReloadGate } from './reloadGate';

describe('createReloadGate', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reloads after the delay when nothing holds it', () => {
    const reload = vi.fn();
    createReloadGate(1000, reload);
    vi.advanceTimersByTime(999);
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('holds the reload while the embed is showing', () => {
    const reload = vi.fn();
    const gate = createReloadGate(1000, reload);
    gate.setHeld(true);
    vi.advanceTimersByTime(60_000);
    expect(reload).not.toHaveBeenCalled();
  });

  it('runs a held reload as soon as the embed goes away', () => {
    const reload = vi.fn();
    const gate = createReloadGate(1000, reload);
    gate.setHeld(true);
    vi.advanceTimersByTime(5000);
    expect(reload).not.toHaveBeenCalled();
    gate.setHeld(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload early when released before it is due', () => {
    const reload = vi.fn();
    const gate = createReloadGate(1000, reload);
    gate.setHeld(true);
    gate.setHeld(false);
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('still reloads when Meals shows the placeholder after a failed config load', () => {
    // MealsPane reports the embed as not shown, so the reload (which retries
    // the config) is not held.
    const reload = vi.fn();
    const gate = createReloadGate(1000, reload);
    gate.setHeld(false);
    vi.advanceTimersByTime(1000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('never reloads after stop', () => {
    const reload = vi.fn();
    const gate = createReloadGate(1000, reload);
    gate.stop();
    vi.advanceTimersByTime(5000);
    expect(reload).not.toHaveBeenCalled();
  });
});

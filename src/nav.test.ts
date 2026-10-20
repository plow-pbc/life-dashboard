import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TAB,
  TABS,
  hashForMealsRecipe,
  hashForTab,
  mealsRecipeFromHash,
  tabFromHash,
} from './nav';

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

  it('resolves a Meals deep-link (#meals/cook/<id>) to the Meals tab', () => {
    expect(tabFromHash('#meals/cook/80c34dfe-92cd-47a7-b7b4-3379f669d244')).toBe('meals');
    expect(tabFromHash('#MEALS/cook/abc')).toBe('meals');
  });
});

describe('Meals deep-link (#meals/cook/<id>)', () => {
  it('extracts the recipe id from a deep-link hash', () => {
    expect(mealsRecipeFromHash('#meals/cook/80c34dfe-92cd-47a7-b7b4-3379f669d244')).toBe(
      '80c34dfe-92cd-47a7-b7b4-3379f669d244',
    );
    expect(mealsRecipeFromHash('meals/cook/abc')).toBe('abc'); // tolerant of missing #
  });

  it('preserves the id case (cook-route ids are case-sensitive)', () => {
    expect(mealsRecipeFromHash('#meals/cook/AbC-123_x')).toBe('AbC-123_x');
  });

  it('returns null for the bare Meals tab and non-deep-link hashes (→ library base)', () => {
    expect(mealsRecipeFromHash('#meals')).toBeNull();
    expect(mealsRecipeFromHash('#home')).toBeNull();
    expect(mealsRecipeFromHash('')).toBeNull();
  });

  it('rejects an unsafe id (only [A-Za-z0-9_-] is a valid path segment)', () => {
    expect(mealsRecipeFromHash('#meals/cook/../../etc')).toBeNull();
    expect(mealsRecipeFromHash('#meals/cook/a b')).toBeNull();
    expect(mealsRecipeFromHash('#meals/cook/')).toBeNull();
    expect(mealsRecipeFromHash('#meals/cook/a/b')).toBeNull();
  });

  it('round-trips a recipe id through hashForMealsRecipe', () => {
    for (const id of ['abc', '80c34dfe-92cd-47a7-b7b4-3379f669d244', 'A_b-9']) {
      expect(mealsRecipeFromHash(hashForMealsRecipe(id))).toBe(id);
      expect(tabFromHash(hashForMealsRecipe(id))).toBe('meals');
    }
  });
});

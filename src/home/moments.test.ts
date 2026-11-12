import { describe, it, expect } from 'vitest';
import { pickHero } from './moments';

const at = (h: number, m = 0) => new Date(2026, 10, 11, h, m);
const game = (h: number, m = 0) => ({ date: at(h, m).toISOString() });

describe('pickHero', () => {
  it.each([
    [at(4, 59), 'cooking'],
    [at(5), 'weather'],
    [at(8), 'weather'],
    [at(10, 59), 'weather'],
    [at(11), 'cooking'],
    [at(16), 'cooking'],
    [at(23), 'cooking'],
  ])('with no games, %s → %s', (now, hero) => {
    expect(pickHero(now, [])).toBe(hero);
  });

  it('shows the matchup from 2h before a 7pm start until 4h after', () => {
    const games = [game(19)];
    expect(pickHero(at(16, 59), games)).toBe('cooking');
    expect(pickHero(at(17), games)).toBe('sports');
    expect(pickHero(at(22, 59), games)).toBe('sports');
    expect(pickHero(at(23), games)).toBe('cooking');
  });

  it('game night beats the morning weather', () => {
    expect(pickHero(at(9), [game(10)])).toBe('sports');
  });

  it('ignores games with no or unparseable start', () => {
    expect(pickHero(at(19), [{ date: null }, { date: 'TBD' }])).toBe('cooking');
  });

  describe('with dinner planned tonight', () => {
    it('keeps the meal over a game until 7:30pm, then the game takes it', () => {
      const games = [game(19)];
      expect(pickHero(at(17), games, true)).toBe('cooking');
      expect(pickHero(at(19, 29), games, true)).toBe('cooking');
      expect(pickHero(at(19, 30), games, true)).toBe('sports');
      expect(pickHero(at(22), games, true)).toBe('sports');
    });

    it('changes nothing on a night with no game', () => {
      for (const t of [at(8), at(17), at(19, 29), at(19, 30), at(23)]) {
        expect(pickHero(t, [], true)).toBe(pickHero(t, []));
      }
    });

    it('keeps the morning weather', () => {
      expect(pickHero(at(8), [], true)).toBe('weather');
    });
  });

  it('with no dinner planned, a game takes the hero as before', () => {
    expect(pickHero(at(17), [game(19)], false)).toBe('sports');
    expect(pickHero(at(19, 29), [game(19)], false)).toBe('sports');
  });
});

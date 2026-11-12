import type { SlotWidget } from './layout';

/** The bit of a sports-feed game the moment rules need. */
export type GameTime = { date: string | null };

// Game night: from GAME_LEAD before a followed team's start until GAME_TAIL
// after it, long enough to cover the game and let the final linger a while.
const GAME_LEAD_MS = 2 * 60 * 60_000;
const GAME_TAIL_MS = 4 * 60 * 60_000;
// Morning: weather leads while people are getting out the door.
const MORNING_FROM_HOUR = 5;
const MORNING_UNTIL_HOUR = 11;

/** True when `now` falls inside some game's window. */
export function isGameNight(now: Date, games: readonly GameTime[]): boolean {
  const t = now.getTime();
  return games.some((g) => {
    const start = g.date ? Date.parse(g.date) : NaN;
    return !Number.isNaN(start) && t >= start - GAME_LEAD_MS && t < start + GAME_TAIL_MS;
  });
}

// A planned dinner keeps the hero from a game until this time.
const DINNER_HOLDS_UNTIL = { hour: 19, minute: 30 };

/** What fills the 4×2 hero right now. Game night wins, then the morning
 *  weather; at every other hour (dinner from 4pm included) it's the meal.
 *  With a dinner planned tonight, a game doesn't take the hero until 7:30pm. */
export function pickHero(now: Date, games: readonly GameTime[], dinnerTonight = false): SlotWidget {
  const minutes = now.getHours() * 60 + now.getMinutes();
  const dinnerHolds =
    dinnerTonight && minutes < DINNER_HOLDS_UNTIL.hour * 60 + DINNER_HOLDS_UNTIL.minute;
  if (!dinnerHolds && isGameNight(now, games)) return 'sports';
  const h = now.getHours();
  if (h >= MORNING_FROM_HOUR && h < MORNING_UNTIL_HOUR) return 'weather';
  return 'cooking';
}

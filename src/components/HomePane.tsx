import { useEffect, useState } from 'react';
import { SLOTS, assignSlots, gridArea, type SlotId } from '../home/layout';
import { pickHero } from '../home/moments';
import { WIDGETS, type HomeContext } from '../home/registry';
import { useCollection } from '../home/useCollection';
import { hasDinnerTonight } from '../pinch';
import type { Game } from './Sports';
import { useMinuteClock } from './useMinuteClock';

/** The followed teams' games, shared by the sports widget and game-night
 *  detection. Null until the feed answers, and on any failure — the sports
 *  widget then renders nothing and the hero falls back to the meal. */
function useGames() {
  const [games, setGames] = useState<Game[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('api/sports');
        if (!res.ok) return; // 503 before the first upstream fetch lands
        const body = (await res.json()) as { games?: Game[] };
        if (!cancelled) setGames(Array.isArray(body.games) ? body.games : []);
      } catch {
        // Non-critical: no sports tile and no game night without the feed.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return games;
}

// The Home pane: fixed slots on the 4×6 grid, each filled from the widget
// registry. The slot owns the size and surface; the widget only fills it. The
// moment (time of day, game night, a planned dinner) only decides what fills
// the 4×2 hero, and the rest fill the side slots in priority order — no slot
// ever resizes.
export function HomePane(props: Omit<HomeContext, 'now' | 'games' | 'collection' | 'collectionSettled'>) {
  const now = useMinuteClock();
  const games = useGames();
  const { collection, settled } = useCollection();
  const ctx: HomeContext = { ...props, now, games, collection, collectionSettled: settled };
  const filled = assignSlots(pickHero(now, games ?? [], hasDinnerTonight(collection, now)));
  return (
    <div className="home">
      {(Object.keys(SLOTS) as SlotId[]).map((slot) => {
        const id = filled[slot];
        const w = WIDGETS[id];
        return (
          <div
            key={slot}
            className={`slot slot--${w.surface}${w.surface === 'glass' ? ' glass' : ''}`}
            data-slot={slot}
            data-widget={id}
            style={{ gridArea: gridArea(SLOTS[slot]) }}
          >
            {w.render(ctx)}
          </div>
        );
      })}
    </div>
  );
}

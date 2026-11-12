import { useEffect, useState } from 'react';
import { SLOTS, assignSlots, gridArea, type SlotId } from '../home/layout';
import { pickHero, type GameTime } from '../home/moments';
import { WIDGETS, type HomeContext } from '../home/registry';
import { useCollection } from '../home/useCollection';
import { hasDinnerTonight } from '../pinch';
import { useMinuteClock } from './useMinuteClock';

/** The followed teams' games, for spotting game night. Empty until the feed
 *  answers, and on any failure — then the hero just falls back to the meal. */
function useGames() {
  const [games, setGames] = useState<GameTime[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('api/sports');
        if (!res.ok) return;
        const body = (await res.json()) as { games?: GameTime[] };
        if (!cancelled) setGames(body.games ?? []);
      } catch {
        // Non-critical: no game night without the feed.
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
export function HomePane(props: Omit<HomeContext, 'now' | 'collection' | 'collectionSettled'>) {
  const now = useMinuteClock();
  const games = useGames();
  const { collection, settled } = useCollection();
  const ctx: HomeContext = { ...props, now, collection, collectionSettled: settled };
  const filled = assignSlots(pickHero(now, games, hasDinnerTonight(collection, now)));
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

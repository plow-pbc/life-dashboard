import type { ReactNode } from 'react';
import type { UpNextItem } from '../calendarLayout';
import type { Message as MessageType } from '../message';
import type { Collection } from '../pinch';
import { Banner } from '../components/Banner';
import { CalendarMini } from '../components/CalendarMini';
import { CookTonight } from '../components/CookTonight';
import { Header } from '../components/Header';
import { Sports } from '../components/Sports';
import { Weather } from '../components/Weather';
import type { Event } from '../types';
import type { WidgetId } from './layout';

/** Everything a Home widget may need, threaded down from the shell. */
export type HomeContext = {
  /** The agent's one line: posted card 2. */
  agentLine: MessageType | null;
  /** The app clock, ticking each minute (shifted when `?at=` forces it). */
  now: Date;
  /** The household calendar's events. */
  events: Event[];
  upNext: UpNextItem[];
  staleGeneratedAt: Date | null;
  isError: boolean;
  onOpenRecipe: (recipeId: string) => void;
  /** The synced Pinch library (null until it loads, or when unconfigured). */
  collection: Collection | null;
  /** Whether the library fetch has finished. */
  collectionSettled: boolean;
};

/** How a slot is drawn behind its widget.
 *  - glass: frosted panel. Only for still content — the Pi's GPU can't blur
 *    behind anything that moves at full frame rate.
 *  - tile:  full-bleed photo surface, never glass (photos change under it).
 *  - bare:  text straight on the background. */
export type Surface = 'glass' | 'tile' | 'bare';

type WidgetDef = { surface: Surface; render: (ctx: HomeContext) => ReactNode };

export const WIDGETS: Record<WidgetId, WidgetDef> = {
  header: {
    surface: 'bare',
    render: ({ agentLine, now }) => <Header line={agentLine} now={now} />,
  },
  cooking: {
    surface: 'tile',
    render: ({ onOpenRecipe, now, collection, collectionSettled }) => (
      <CookTonight
        onOpenRecipe={onOpenRecipe}
        now={now}
        collection={collection}
        settled={collectionSettled}
      />
    ),
  },
  // Bare: the calendar draws its own card (see .cm).
  calendar: {
    surface: 'bare',
    render: ({ events, upNext, now, staleGeneratedAt, isError }) =>
      isError ? (
        <section className="cm">
          <p className="error-state">Can't reach calendar — retrying soon.</p>
        </section>
      ) : (
        <CalendarMini
          events={events}
          upNext={upNext}
          now={now}
          staleGeneratedAt={staleGeneratedAt}
        />
      ),
  },
  sports: {
    surface: 'glass',
    render: () => (
      <section className="card c-seaglass">
        <Sports />
      </section>
    ),
  },
  weather: {
    surface: 'glass',
    render: () => (
      <section className="card c-apricot">
        <Weather />
      </section>
    ),
  },
  photos: { surface: 'tile', render: () => <Banner /> },
};

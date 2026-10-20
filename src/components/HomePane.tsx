import type { MonthLayout, UpNextItem } from '../calendarLayout';
import type { Message as MessageType } from '../message';
import { Banner } from './Banner';
import { Weather } from './Weather';
import { Sports } from './Sports';
import { Affirmation } from './Affirmation';
import { CookTonight } from './CookTonight';
import { CalendarMonth } from './CalendarMonth';
import { UpNext } from './UpNext';

type Props = {
  affirmation: MessageType | null;
  month: MonthLayout;
  upNext: UpNextItem[];
  staleGeneratedAt: Date | null;
  isError: boolean;
};

// The Home pane: the original dashboard grid of tiles, lifted verbatim out of App
// so the shell can swap it with the other panes. Visually unchanged — it still
// fills its box (now the viewport minus the bottom nav) via the .app grid.
export function HomePane({ affirmation, month, upNext, staleGeneratedAt, isError }: Props) {
  return (
    <div className="app">
      {/* Top-left 2×1 photo */}
      <Banner />

      {/* Top-middle: weather (apricot) */}
      <section className="card c-apricot cell-weather">
        <Weather />
      </section>

      {/* Top-right: sports (seaglass, mockup's "trivia" slot) */}
      <section className="card c-seaglass cell-sports">
        <Sports />
      </section>

      {/* Row 2 left: affirmation (lavender, posted card 2) */}
      <div className="cell-affirmation">
        <Affirmation message={affirmation} />
      </div>

      {/* Row 2 right: cook tonight (clay, mockup's most-urgent slot) */}
      <section className="card c-clay cell-cook">
        <CookTonight />
      </section>

      {/* Bottom: rolling 3-week calendar + up-next rail */}
      <div className="cal-region">
        {isError ? (
          <section className="card month">
            <p className="error-state">Can't reach calendar — retrying soon.</p>
          </section>
        ) : (
          <>
            <CalendarMonth layout={month} />
            <UpNext items={upNext} staleGeneratedAt={staleGeneratedAt} />
          </>
        )}
      </div>
    </div>
  );
}

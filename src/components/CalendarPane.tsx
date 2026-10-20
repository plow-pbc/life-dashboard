import type { MonthLayout, UpNextItem } from '../calendarLayout';
import { CalendarMonth } from './CalendarMonth';
import { UpNext } from './UpNext';

type Props = {
  month: MonthLayout;
  upNext: UpNextItem[];
  staleGeneratedAt: Date | null;
  isError: boolean;
};

// The Calendar pane: the same CalendarMonth + UpNext the Home tile uses, given the
// whole viewport (minus the nav) instead of the bottom strip — roomier weeks and a
// longer upcoming list (App passes a larger cap). Pure reuse; the data comes from
// calendarLayout.ts exactly as on Home.
export function CalendarPane({ month, upNext, staleGeneratedAt, isError }: Props) {
  return (
    <div className="cal-pane">
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
  );
}

import { useEffect, useState } from 'react';
import { loadCalendarEvents, type CalendarResult } from './calendar';
import { buildMonthLayout, buildUpNext } from './calendarLayout';
import { BottomNav } from './components/BottomNav';
import { HomePane } from './components/HomePane';
import { CalendarPane } from './components/CalendarPane';
import { MealsPane } from './components/MealsPane';
import { mealsRecipeFromHash, tabFromHash, type Tab } from './nav';
import type { Message as MessageType } from './message';

const NEXT_N = Number(__NEXT_N__);
const REFRESH_MS = Number(__REFRESH_MS__);

// NEXT_N caps the "Up next" rail only. The month grid must show EVERY event in
// its ~3-month window, so we load generously and let buildMonthLayout filter to
// the window (buildUpNext re-caps the rail to NEXT_N). This ceiling is far above
// any realistic household quarter — events are sorted by start, so the first
// CAL_LOAD_LIMIT upcoming events always cover the whole 13-week window — and the
// parse/filter cost is trivial.
const CAL_LOAD_LIMIT = 500;

// The Calendar pane owns the whole viewport, so its upcoming list runs longer than
// the Home tile's NEXT_N rail. Still a cap; the rail scrolls.
const CAL_PANE_NEXT_N = 50;

// The affirmation is the only remaining posted card (card 2). Weather and sports
// are now self-fetching components, no longer generic posted cards.
const AFFIRMATION_CARD = '2';

type State = { kind: 'loading' } | CalendarResult;

// The dashboard shell: a hash-routed content pane (Home / Calendar / Meals) above
// a persistent bottom nav. Calendar data is loaded once here and shared by the
// Home and Calendar panes; the shell stays mounted across tab switches, so panes
// are cheap to swap. See nav.ts for the hash-routing rationale.
export function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [affirmation, setAffirmation] = useState<MessageType | null>(null);
  // The full URL hash is the single routing source of truth: it carries both the
  // active tab AND the Meals deep-link recipe (#meals/cook/<id>). Storing the raw
  // hash (not just the derived tab) means a #meals → #meals/cook/<id> change — same
  // tab, different recipe — still re-renders. A bare URL (the Pi's hourly recycle)
  // → Home; a reload keeps the hash → stays put.
  const [hash, setHash] = useState<string>(() => location.hash);

  useEffect(() => {
    const onHashChange = () => setHash(location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const tab: Tab = tabFromHash(hash);
  const mealsRecipe = mealsRecipeFromHash(hash);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const result = await loadCalendarEvents(fetch, new Date(), CAL_LOAD_LIMIT, 30 * 60_000);
      if (!cancelled) setState(result);
    })();

    (async () => {
      try {
        const res = await fetch(`api/message?card=${AFFIRMATION_CARD}`);
        if (!res.ok) return;
        const body = (await res.json()) as { message: MessageType | null };
        if (!cancelled) setAffirmation(body.message);
      } catch {
        // Non-critical: the card shows its quiet invitation; the rest loads.
      }
    })();

    const reloadTimer = setTimeout(() => location.reload(), REFRESH_MS);
    return () => {
      cancelled = true;
      clearTimeout(reloadTimer);
    };
  }, []);

  // Build calendar layouts from the loaded events (empty until ready).
  const now = new Date();
  const events = state.kind === 'ready' ? state.events : [];
  const month = buildMonthLayout(events, now);
  const upNext = buildUpNext(events, now, NEXT_N);
  const upNextLong = buildUpNext(events, now, CAL_PANE_NEXT_N);
  const staleGeneratedAt = state.kind === 'ready' ? state.staleGeneratedAt : null;
  const isError = state.kind === 'error';

  return (
    <div className="shell">
      <main className="pane">
        {tab === 'home' && (
          <HomePane
            affirmation={affirmation}
            month={month}
            upNext={upNext}
            staleGeneratedAt={staleGeneratedAt}
            isError={isError}
          />
        )}
        {tab === 'calendar' && (
          <CalendarPane
            month={month}
            upNext={upNextLong}
            staleGeneratedAt={staleGeneratedAt}
            isError={isError}
          />
        )}
        {tab === 'meals' && <MealsPane recipeId={mealsRecipe} />}
      </main>
      <BottomNav tab={tab} />
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { loadCalendarEvents, type CalendarResult } from './calendar';
import { buildMonthLayout, buildUpNext } from './calendarLayout';
import { BottomNav } from './components/BottomNav';
import { HomePane } from './components/HomePane';
import { CalendarPane } from './components/CalendarPane';
import { MealsPane } from './components/MealsPane';
import { tabFromHash, type Tab } from './nav';
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

// The agent's line in the Home header is the only remaining posted card (card 2).
// Weather and sports are self-fetching components, not posted cards.
const AGENT_LINE_CARD = '2';

type State = { kind: 'loading' } | CalendarResult;

// The dashboard shell: a hash-routed content pane (Home / Calendar / Meals) above
// a persistent bottom nav. Calendar data is loaded once here and shared by the
// Home and Calendar panes; the shell stays mounted across tab switches, so panes
// are cheap to swap. See nav.ts for the hash-routing rationale.
export function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [agentLine, setAgentLine] = useState<MessageType | null>(null);
  // The URL hash is the single routing source of truth: it carries the active tab.
  // A bare URL (the Pi's hourly recycle) → Home; a reload keeps the hash → stays put.
  const [hash, setHash] = useState<string>(() => location.hash);
  // A ONE-SHOT request to open a recipe in the Meals embed, set by a Cook Tonight tap.
  // In-memory on purpose: it is never written to the URL/hash, so a reload (which keeps
  // the hash) can never re-open the recipe — the reload lands on the base embed. The
  // Meals pane consumes it on mount and clears it via clearMealsRecipe.
  const [mealsRecipe, setMealsRecipe] = useState<string | null>(null);
  const clearMealsRecipe = useCallback(() => setMealsRecipe(null), []);

  // Scrolling anywhere (the calendar, the sports pager) also flattens glass,
  // until it settles: a blur over a moving scroller drops the Pi to ~25fps.
  // A class on <html>, not React state, so a scroll never re-renders the app.
  useEffect(() => {
    const root = document.documentElement;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      root.classList.add('is-scrolling');
      clearTimeout(settle);
      settle = setTimeout(() => root.classList.remove('is-scrolling'), 150);
    };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true });
      clearTimeout(settle);
      root.classList.remove('is-scrolling');
    };
  }, []);

  useEffect(() => {
    const onHashChange = () => setHash(location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const tab: Tab = tabFromHash(hash);

  // Tab changes fade the new pane in. While it fades the shell is marked
  // animating, which swaps every glass surface for a flat fill: the Pi's GPU
  // can't blur behind something that changes every frame. The first render
  // (a reload, the hourly restart) never animates.
  const [shownTab, setShownTab] = useState<Tab>(tab);
  const [fading, setFading] = useState(false);
  if (tab !== shownTab) {
    setShownTab(tab);
    setFading(true);
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const result = await loadCalendarEvents(fetch, new Date(), CAL_LOAD_LIMIT, 30 * 60_000);
      if (!cancelled) setState(result);
    })();

    (async () => {
      try {
        const res = await fetch(`api/message?card=${AGENT_LINE_CARD}`);
        if (!res.ok) return;
        const body = (await res.json()) as { message: MessageType | null };
        if (!cancelled) setAgentLine(body.message);
      } catch {
        // Non-critical: the header shows just the clock; the rest loads.
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
    <div className={fading ? 'shell is-animating' : 'shell'}>
      <main className="pane">
        <div
          key={tab}
          className={fading ? 'pane-view is-entering' : 'pane-view'}
          onAnimationEnd={() => setFading(false)}
        >
          {tab === 'home' && (
            <HomePane
              agentLine={agentLine}
              events={events}
              upNext={upNext}
              staleGeneratedAt={staleGeneratedAt}
              isError={isError}
              onOpenRecipe={setMealsRecipe}
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
          {tab === 'meals' && <MealsPane openRecipe={mealsRecipe} onConsumed={clearMealsRecipe} />}
        </div>
      </main>
      <BottomNav tab={tab} />
    </div>
  );
}

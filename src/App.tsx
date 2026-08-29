import { useEffect, useState } from 'react';
import { loadCalendarEvents } from './calendar';
import type { Event } from './types';
import { Banner } from './components/Banner';
import { EventRow } from './components/EventRow';
import { Message } from './components/Message';
import { CookTonight } from './components/CookTonight';
import { CARDS, type CardSlot, type Message as MessageType } from './message';

const NEXT_N = Number(__NEXT_N__);
const REFRESH_MS = Number(__REFRESH_MS__);
const CALENDAR_FEED_MAX_AGE = Number(__CALENDAR_FEED_MAX_AGE__);

// Numbered card slots above the calendar. Each card fetches by its number
// independently from the local store (see /api/message in src/server/app.js).
// Empty cards still render — the kiosk layout stays at fixed dimensions all
// day, no reflow when a message arrives.
type State =
  | { kind: 'loading' }
  | { kind: 'ready'; events: Event[]; staleGeneratedAt: Date | null };

export function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [messages, setMessages] = useState<Record<CardSlot, MessageType | null>>(
    () => Object.fromEntries(CARDS.map((c) => [c, null])) as Record<CardSlot, MessageType | null>,
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const result = await loadCalendarEvents(fetch, new Date(), NEXT_N, CALENDAR_FEED_MAX_AGE);
      if (!cancelled) setState({ kind: 'ready', ...result });
    })();

    for (const card of CARDS) {
      (async () => {
        try {
          const res = await fetch(`api/message?card=${card}`);
          if (!res.ok) return;
          const body = (await res.json()) as { message: MessageType | null };
          if (cancelled) return;
          setMessages((prev) => ({ ...prev, [card]: body.message }));
        } catch {
          // Non-critical: leave this slot null on failure; the empty-state
          // placeholder still renders and the calendar still loads.
        }
      })();
    }

    const reloadTimer = setTimeout(() => location.reload(), REFRESH_MS);
    return () => {
      cancelled = true;
      clearTimeout(reloadTimer);
    };
  }, []);

  return (
    <main className="app">
      <Banner />
      {CARDS.map((card) => (
        <Message key={card} card={card} message={messages[card]} />
      ))}
      <CookTonight />
      <section className="calendar-panel">
        {/* The warm theme intentionally has no as-of freshness stamp. */}
        <header className="header">
          <h1>Life Calendar</h1>
        </header>
        {state.kind === 'ready' &&
          (state.events.length === 0 ? (
            <p className="empty-state">No upcoming events.</p>
          ) : (
            <ul className="event-list">
              {state.events.map((event) => (
                <EventRow key={event.uid} event={event} />
              ))}
            </ul>
          ))}
        {state.kind === 'ready' && state.staleGeneratedAt && (
          <p className="calendar-updated">
            Last updated{' '}
            {state.staleGeneratedAt.toLocaleTimeString([], {
              hour: 'numeric',
              minute: '2-digit',
            })}
          </p>
        )}
      </section>
    </main>
  );
}

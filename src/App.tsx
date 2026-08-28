import { useEffect, useState } from 'react';
import { parseICS } from './ical';
import type { Event } from './types';
import { Banner } from './components/Banner';
import { EventRow } from './components/EventRow';
import { Message } from './components/Message';
import { CookTonight } from './components/CookTonight';
import { CARDS, type CardSlot, type Message as MessageType } from './message';

const NEXT_N = Number(__NEXT_N__);
const REFRESH_MS = Number(__REFRESH_MS__);

// Numbered card slots above the calendar. Each card fetches by its number
// independently from the local store (see /api/message in src/server/app.js).
// Empty cards still render — the kiosk layout stays at fixed dimensions all
// day, no reflow when a message arrives.
type State =
  | { kind: 'loading' }
  | { kind: 'ready'; events: Event[] }
  | { kind: 'error' };

export function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [messages, setMessages] = useState<Record<CardSlot, MessageType | null>>(
    () => Object.fromEntries(CARDS.map((c) => [c, null])) as Record<CardSlot, MessageType | null>,
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('api/ical');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const events = parseICS(text, new Date(), NEXT_N);
        if (!cancelled) setState({ kind: 'ready', events });
      } catch {
        if (!cancelled) setState({ kind: 'error' });
      }
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
        {state.kind === 'error' && (
          <p className="error-state">Can't reach calendar — retrying soon.</p>
        )}
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
      </section>
    </main>
  );
}

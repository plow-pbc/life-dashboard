import { useEffect, useState } from 'react';
import './Sports.css';

// The Sports tile: an Apple-Sports-style scoreboard for the household's
// followed teams — up to three game rows laid out as a matchup: away team logo
// (circular, left) · center column · home team logo (circular, right), under a
// "Sports" eyebrow. Takes the slot the mockup (dashboard-warm-cal3week.html)
// calls "trivia", in the seaglass color family.
//
// Center column by game state (mirrors the Apple widget):
//   - upcoming (pre): the start time, with the weekday under it when not today.
//   - live (in):      the away/home scores flanking a live period+clock label.
//   - final (post):   the away/home scores flanking "Final".
// (The server still sends a per-game `league`, but it is not displayed.)
//
// Self-fetching rather than fed from App, following <CookTonight/>: the
// scoreboard is independent of the calendar and a sports failure must never
// delay or break the calendar render.
//
// The server (src/server/sports.js) owns the ESPN scoreboard calls, the cache,
// the logo mirroring, and the refresh interval; this component only reads the
// cached snapshot from /api/sports on load. The page's own REFRESH_MS reload
// re-fetches over time.
//
// Logos are same-origin (`api/sports/logo/<id>`): the server downloads ESPN's
// remote PNGs and serves them from our own origin, because the kiosk CSP
// (`img-src 'self' data:`) forbids loading the remote logo URLs directly. A team
// whose logo isn't available — no cached path, or a path that fails to load
// (first-refresh warm-up, a failed/refused download) — falls back to its
// abbreviation in the circle via the <img>'s onError, never a broken glyph.
//
// Unlike the recipe and weather tiles, this one DOES render when empty: with no
// followed teams (or none playing in the window) it shows "No upcoming games",
// which is the configured-but-quiet state. It renders nothing only before the
// first snapshot lands (503) or on a transport error, so a cold start or outage
// leaves the cell empty rather than asserting "No upcoming games" falsely.

type Team = { abbr: string; score: number | null; logo: string | null };
type Game = {
  id: string;
  date: string | null;
  league: string | null;
  away: Team;
  home: Team;
  state: 'pre' | 'in' | 'post' | string;
  detail: string;
};

// A team's circular crest: the mirrored logo when we have one AND it loads,
// else the abbreviation so the row never shows a hole or a broken-image glyph.
// A load failure (cache miss during warm-up, a failed/refused download) flips
// `failed` via onError and swaps to the abbr INSIDE the crest. No name label
// prints beneath the crest — logos only — so three matchup rows fit the tile
// without vertical cutoff.
function TeamCrest({ team }: { team: Team }) {
  const [failed, setFailed] = useState(false);
  // Reset when the logo source changes so a later-cached logo can recover from
  // an earlier miss on the same component instance.
  useEffect(() => setFailed(false), [team.logo]);
  const showAbbr = !team.logo || failed;
  return (
    <div className="sp-side">
      <div className="sp-crest">
        {showAbbr ? (
          <span className="sp-crest-abbr">{team.abbr}</span>
        ) : (
          <img
            className="sp-logo"
            src={team.logo!}
            alt=""
            loading="lazy"
            onError={() => setFailed(true)}
          />
        )}
      </div>
    </div>
  );
}

// Center column, one shape per state so nothing collides on the narrow tile:
//   - pre:  the start time (big) with the weekday (small) under it.
//   - in:   the away-home score (big) with the live clock/period (small) under
//           it, a pulsing dot ahead of the label.
//   - post: the away-home score (big) with "Final" (small) under it.
// Live/final put the SCORE in the center as the prominent element and the
// clock/period as a distinct small sublabel — mirroring the scheduled time +
// weekday — instead of flanking the center with scores that squeezed a nowrap
// clock label into an overflow painting over them (the live-overlap bug).
// `now` is threaded in so the "is it today?" test and the render agree on one clock.
function Center({ game, now }: { game: Game; now: Date }) {
  if (game.state === 'pre') {
    const when = game.date ? new Date(game.date) : null;
    const time = when
      ? when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
      : game.detail;
    const day =
      when && when.toDateString() !== now.toDateString()
        ? when.toLocaleDateString([], { weekday: 'short' })
        : null;
    return (
      <div className="sp-center">
        <span className="sp-time">{time}</span>
        {day && <span className="sp-day">{day}</span>}
      </div>
    );
  }
  // Live + final: the score on top, a small status label under it.
  const live = game.state === 'in';
  const scored = game.away.score != null && game.home.score != null;
  const awayWin = game.state === 'post' && scored && game.away.score! > game.home.score!;
  const homeWin = game.state === 'post' && scored && game.home.score! > game.away.score!;
  return (
    <div className={`sp-center ${live ? 'sp-center-live' : 'sp-center-final'}`}>
      <span className="sp-scoreline">
        <span className={`sp-score ${awayWin ? 'sp-score-win' : ''}`}>{game.away.score ?? '–'}</span>
        <span className="sp-score-sep">–</span>
        <span className={`sp-score ${homeWin ? 'sp-score-win' : ''}`}>{game.home.score ?? '–'}</span>
      </span>
      <span className="sp-status">
        {live && <span className="sp-dot" aria-hidden="true" />}
        <span className="sp-state">{game.detail || (live ? 'Live' : 'Final')}</span>
      </span>
    </div>
  );
}

export function Sports() {
  const [games, setGames] = useState<Game[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('api/sports');
        if (!res.ok) return; // 503 before the first upstream fetch lands
        const body = (await res.json()) as { games: Game[] };
        if (!cancelled) setGames(Array.isArray(body.games) ? body.games : []);
      } catch {
        // Non-critical: render nothing. The calendar still loads.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (games === null) return null;

  const now = new Date();

  return (
    <section className="sp" aria-label="Sports">
      <div className="sp-head">
        <span className="sp-eyebrow">Sports</span>
      </div>
      {games.length === 0 ? (
        <div className="sp-empty">No upcoming games</div>
      ) : (
        <div className="sp-games">
          {games.map((game) => (
            <div key={game.id} className={`sp-game sp-${game.state}`}>
              <div className="sp-row">
                <TeamCrest team={game.away} />
                <Center game={game} now={now} />
                <TeamCrest team={game.home} />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

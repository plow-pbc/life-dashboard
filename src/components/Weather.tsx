import { useEffect, useState } from 'react';
import './Weather.css';

// The Weather tile: current temperature, today's hi/lo as a gradient range bar,
// and a "condition · location" caption, under a "Weather" eyebrow.
// Mirrors the "weather" tile in mockups/dashboard-warm-cal3week.html.
//
// Self-fetching rather than fed from App, following <CookTonight/>: the weather
// snapshot is independent of the calendar, and a weather failure must never
// delay or break the calendar render.
//
// The server (src/server/weather.js) owns the National Weather Service calls,
// the cache, and the refresh interval; this component only reads the cached
// snapshot from /api/weather on load. The page's own REFRESH_MS reload is what
// re-fetches it over time, so there is no client-side polling here.
//
// Renders NOTHING until a snapshot is available (same as the recipe tile), so
// the grid cell the head chef places this in simply stays empty on a cold start
// or an upstream outage rather than flashing a placeholder on the wall.

type Weather = {
  temp: number;
  unit: string;
  hi: number;
  lo: number;
  condition: string;
  location: string;
};

export function Weather() {
  const [weather, setWeather] = useState<Weather | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('api/weather');
        if (!res.ok) return; // 503 before the first upstream fetch lands
        const body = (await res.json()) as Weather;
        if (!cancelled) setWeather(body);
      } catch {
        // Non-critical: render nothing. The calendar still loads.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!weather) return null;

  const caption = [weather.condition, weather.location].filter(Boolean).join(' · ');

  return (
    <section className="wx" aria-label="Weather">
      <div className="wx-head">
        <span className="wx-eyebrow">Weather</span>
      </div>
      <div>
        <div className="wx-temp">{weather.temp}&deg;</div>
        <div className="wx-range">
          <span className="wx-lo">{weather.lo}&deg;</span>
          <div className="wx-bar" />
          <span className="wx-hi">{weather.hi}&deg;</span>
        </div>
        {caption && <div className="wx-caption">{caption}</div>}
      </div>
    </section>
  );
}

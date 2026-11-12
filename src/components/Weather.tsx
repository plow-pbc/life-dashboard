import { useEffect, useState, type ReactNode } from 'react';
import { hourLabel, upcomingHours, wxKind, type Hour, type WxKind } from '../home/widgetData';
import './Weather.css';

// The Weather tile: current temperature and condition, today's high/low,
// sunrise and sunset, and the next hours as a strip. The same markup fills the
// 2×1 side slot and the 4×2 hero; Weather.css sizes it to whichever it is in
// (container queries on the slot), showing more hours and facts in the hero.
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
  wind?: string | null;
  hourly?: Hour[];
  sunrise?: string | null;
  sunset?: string | null;
};

// How many hours the strip carries; the side tile shows fewer (see Weather.css).
const HOURS = 8;

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

/** A small line-art weather glyph. */
function WxIcon({ kind }: { kind: WxKind }) {
  const sun = <circle cx="12" cy="12" r="4.2" className="wx-i-sun" />;
  const rays = (
    <path
      className="wx-i-sun"
      d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"
    />
  );
  const cloud = (
    <path
      className="wx-i-cloud"
      d="M7.5 18.5h9a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6 1.3A2.9 2.9 0 0 0 7.5 18.5Z"
    />
  );
  const moon = (
    <path className="wx-i-moon" d="M15.5 4.5a7.5 7.5 0 1 0 4 12.6 6.5 6.5 0 0 1-4-12.6Z" />
  );
  const parts: Record<WxKind, ReactNode> = {
    sun: (
      <>
        {sun}
        {rays}
      </>
    ),
    moon,
    partly: (
      <>
        <g transform="translate(-3 -3) scale(.8)">
          {sun}
          {rays}
        </g>
        {cloud}
      </>
    ),
    'partly-night': (
      <>
        <g transform="translate(-2 -3) scale(.7)">{moon}</g>
        {cloud}
      </>
    ),
    cloud,
    rain: (
      <>
        <g transform="translate(0 -3)">{cloud}</g>
        <path className="wx-i-rain" d="M9 18.5l-1 2.5M13 18.5l-1 2.5M17 18.5l-1 2.5" />
      </>
    ),
    storm: (
      <>
        <g transform="translate(0 -3)">{cloud}</g>
        <path className="wx-i-sun" d="M12.5 16.5l-2 3h3l-2 3" />
      </>
    ),
    snow: (
      <>
        <g transform="translate(0 -3)">{cloud}</g>
        <path className="wx-i-rain" d="M9 19.5h.01M12.5 20.5h.01M16 19.5h.01" />
      </>
    ),
    fog: <path className="wx-i-cloud" d="M4 9h16M6 13h12M4 17h16" />,
  };
  return (
    <svg className="wx-icon" viewBox="0 0 24 24" aria-hidden="true">
      {parts[kind]}
    </svg>
  );
}

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

  const hours = upcomingHours(weather.hourly ?? [], new Date(), HOURS);
  const now = hours[0];
  const rain = now?.precip;

  return (
    <section className="wx" aria-label="Weather">
      <div className="wx-now">
        {/* The strip's first hour when we have it, so the headline and "Now"
            agree even when the snapshot's first period has already passed. */}
        <div className="wx-temp">{now?.temp ?? weather.temp}&deg;</div>
        <div className="wx-sum">
          <div className="wx-cond">
            <WxIcon kind={wxKind(weather.condition, now?.isDaytime ?? true)} />
            <span>{weather.condition}</span>
          </div>
          <div className="wx-hilo">
            H {weather.hi}&deg; · L {weather.lo}&deg;
          </div>
          <div className="wx-place">{weather.location}</div>
        </div>
        <dl className="wx-facts">
          {weather.sunrise && (
            <div>
              <dt>Sunrise</dt>
              <dd>{clock(weather.sunrise)}</dd>
            </div>
          )}
          {weather.sunset && (
            <div>
              <dt>Sunset</dt>
              <dd>{clock(weather.sunset)}</dd>
            </div>
          )}
          {typeof rain === 'number' && (
            <div className="wx-fact-extra">
              <dt>Rain</dt>
              <dd>{rain}%</dd>
            </div>
          )}
          {weather.wind && (
            <div className="wx-fact-extra">
              <dt>Wind</dt>
              <dd>{weather.wind}</dd>
            </div>
          )}
        </dl>
      </div>
      {hours.length > 0 && (
        <ol className="wx-hours">
          {hours.map((h, i) => (
            <li className="wx-hour" key={h.time}>
              <span className="wx-hour-t">{hourLabel(h.time, i)}</span>
              <WxIcon kind={wxKind(h.condition, h.isDaytime)} />
              <span className="wx-hour-v">{h.temp}&deg;</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

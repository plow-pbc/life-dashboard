// Server-side weather fetcher backed by the US National Weather Service
// (api.weather.gov — no API key). Two-step resolution, mirroring NWS's own
// documented flow:
//
//   1. GET /points/{lat},{lon}            → the gridpoint + the per-office
//                                            forecast + hourly-forecast URLs
//   2. GET {forecastHourly}               → current temperature (first period)
//      GET {forecast}                     → today's hi/lo + a short condition
//
// The parse is split out from the fetch so it can be unit-tested against
// captured JSON with no network (see weather.test.js). createWeatherFetcher()
// wraps the parse in a single-slot server-side cache that refreshes on an
// interval — the viewer tile reads the cached snapshot, never the upstream.

const USER_AGENT =
  'life-dashboard-viewer (kitchen kiosk; https://github.com/plow)';

// NWS wants coordinates rounded to ~4 decimals; more just 301-redirects.
function roundCoord(n) {
  return Math.round(n * 10000) / 10000;
}

// Parse the /points response into the two forecast URLs we need next.
export function parsePoints(json) {
  const props = json?.properties;
  const forecast = props?.forecast;
  const forecastHourly = props?.forecastHourly;
  if (typeof forecast !== 'string' || typeof forecastHourly !== 'string') {
    throw new Error('points response missing forecast URLs');
  }
  return { forecast, forecastHourly };
}

// Parse the hourly forecast into the current temperature. The first period is
// the current hour; NWS always reports Fahrenheit for US points, but carry the
// unit through so the tile can label it.
export function parseCurrentTemp(hourlyJson) {
  const period = hourlyJson?.properties?.periods?.[0];
  if (!period || typeof period.temperature !== 'number') {
    throw new Error('hourly forecast missing current temperature');
  }
  return {
    temp: Math.round(period.temperature),
    unit: period.temperatureUnit || 'F',
  };
}

// Parse the twice-daily forecast into today's hi/lo + a short condition.
//
// NWS periods come in day/night pairs flagged isDaytime, each with a single
// temperature that is the HIGH for a daytime period and the LOW for a nighttime
// one. "Today" is the first two periods — but near midnight the daytime period
// may already be gone, so take whichever of the first two is daytime for the
// condition/high and whichever is nighttime for the low, falling back to the
// single available period when only one remains.
export function parseDayRange(forecastJson) {
  const periods = forecastJson?.properties?.periods;
  if (!Array.isArray(periods) || periods.length === 0) {
    throw new Error('forecast missing periods');
  }
  const head = periods.slice(0, 2);
  const day = head.find((p) => p.isDaytime) ?? head[0];
  const night = head.find((p) => !p.isDaytime) ?? head[0];
  const temps = head
    .map((p) => p.temperature)
    .filter((t) => typeof t === 'number');
  if (temps.length === 0) throw new Error('forecast periods missing temperatures');
  return {
    hi: Math.round(day.isDaytime ? day.temperature : Math.max(...temps)),
    lo: Math.round(!night.isDaytime ? night.temperature : Math.min(...temps)),
    // shortForecast is the compact label ("Sunny", "Partly Cloudy") — exactly
    // the "condition" the tile caption wants.
    condition: (day.shortForecast || night.shortForecast || '').trim(),
  };
}

// Combine the three upstream responses into the snapshot the tile renders.
export function buildWeather({ pointsJson, hourlyJson, forecastJson, location }) {
  parsePoints(pointsJson); // validate shape even though URLs already used upstream
  const { temp, unit } = parseCurrentTemp(hourlyJson);
  const { hi, lo, condition } = parseDayRange(forecastJson);
  return { temp, unit, hi, lo, condition, location };
}

async function getJson(url, fetchImpl) {
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/geo+json' },
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`weather upstream HTTP ${res.status} (${url})`);
  return res.json();
}

// One network pass: resolve the gridpoint, then read current + daily. Pure
// transport around the testable parsers above.
export async function fetchWeather({ lat, lon, location }, fetchImpl = fetch) {
  const pointsUrl = `https://api.weather.gov/points/${roundCoord(lat)},${roundCoord(lon)}`;
  const pointsJson = await getJson(pointsUrl, fetchImpl);
  const { forecast, forecastHourly } = parsePoints(pointsJson);
  const [hourlyJson, forecastJson] = await Promise.all([
    getJson(forecastHourly, fetchImpl),
    getJson(forecast, fetchImpl),
  ]);
  return buildWeather({ pointsJson, hourlyJson, forecastJson, location });
}

// Single-slot cache + background refresh. Returns a store with get(): the
// freshest successful snapshot, or null until the first fetch lands (the tile
// renders nothing in that gap, same as the recipe tile). A failed refresh keeps
// the last good snapshot rather than clearing it — a wall display should not go
// blank because one poll missed.
export function createWeatherFetcher({
  lat,
  lon,
  location,
  refreshMs = 15 * 60_000,
  fetchImpl = fetch,
  setIntervalImpl = setInterval,
} = {}) {
  let snapshot = null;
  const refresh = async () => {
    try {
      snapshot = await fetchWeather({ lat, lon, location }, fetchImpl);
    } catch (err) {
      console.warn(`weather refresh failed: ${err.message}`);
    }
    return snapshot;
  };
  // Prime immediately, then keep warm on the interval (unref so it never holds
  // the process open — matches the message poller in server.js).
  const primed = refresh();
  const timer = setIntervalImpl(refresh, refreshMs);
  if (timer && typeof timer.unref === 'function') timer.unref();
  return {
    get: () => snapshot,
    // Exposed for tests / an explicit warm-up before first request.
    ready: () => primed,
    refresh,
  };
}

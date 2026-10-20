import { describe, it, expect, vi } from 'vitest';
import {
  parsePoints,
  parseCurrentTemp,
  parseDayRange,
  buildWeather,
  fetchWeather,
  createWeatherFetcher,
} from './weather.js';

const pointsJson = {
  properties: {
    forecast: 'https://api.weather.gov/gridpoints/MTR/90,112/forecast',
    forecastHourly: 'https://api.weather.gov/gridpoints/MTR/90,112/forecast/hourly',
  },
};

const hourlyJson = {
  properties: {
    periods: [
      { number: 1, temperature: 71.6, temperatureUnit: 'F', shortForecast: 'Clear' },
      { number: 2, temperature: 70, temperatureUnit: 'F', shortForecast: 'Clear' },
    ],
  },
};

const forecastJson = {
  properties: {
    periods: [
      { number: 1, isDaytime: true, temperature: 74, shortForecast: 'Sunny' },
      { number: 2, isDaytime: false, temperature: 58, shortForecast: 'Clear' },
      { number: 3, isDaytime: true, temperature: 77, shortForecast: 'Sunny' },
    ],
  },
};

describe('parsePoints', () => {
  it('extracts the forecast + hourly URLs', () => {
    expect(parsePoints(pointsJson)).toEqual({
      forecast: pointsJson.properties.forecast,
      forecastHourly: pointsJson.properties.forecastHourly,
    });
  });

  it('throws when the forecast URLs are missing', () => {
    expect(() => parsePoints({ properties: {} })).toThrow(/forecast URLs/);
    expect(() => parsePoints(null)).toThrow();
  });
});

describe('parseCurrentTemp', () => {
  it('rounds the first hourly period temperature and carries the unit', () => {
    expect(parseCurrentTemp(hourlyJson)).toEqual({ temp: 72, unit: 'F' });
  });

  it('throws when there is no current period', () => {
    expect(() => parseCurrentTemp({ properties: { periods: [] } })).toThrow(/current temperature/);
  });
});

describe('parseDayRange', () => {
  it('reads today as the daytime high and nighttime low with a condition', () => {
    expect(parseDayRange(forecastJson)).toEqual({ hi: 74, lo: 58, condition: 'Sunny' });
  });

  it('handles a day that starts at night (daytime period already gone)', () => {
    const nightFirst = {
      properties: {
        periods: [
          { number: 1, isDaytime: false, temperature: 55, shortForecast: 'Clear' },
          { number: 2, isDaytime: true, temperature: 70, shortForecast: 'Sunny' },
        ],
      },
    };
    const r = parseDayRange(nightFirst);
    expect(r.lo).toBe(55);
    expect(r.hi).toBe(70);
    expect(r.condition).toBe('Sunny');
  });

  it('throws when there are no periods', () => {
    expect(() => parseDayRange({ properties: { periods: [] } })).toThrow(/periods/);
  });
});

describe('buildWeather', () => {
  it('combines the three payloads into a snapshot', () => {
    expect(buildWeather({ pointsJson, hourlyJson, forecastJson, location: 'Mountain View' })).toEqual({
      temp: 72,
      unit: 'F',
      hi: 74,
      lo: 58,
      condition: 'Sunny',
      location: 'Mountain View',
    });
  });
});

describe('fetchWeather', () => {
  it('resolves the gridpoint then reads current + daily', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes('/points/')) return json(pointsJson);
      if (url.endsWith('/hourly')) return json(hourlyJson);
      return json(forecastJson);
    });
    const result = await fetchWeather(
      { lat: 37.386, lon: -122.083, location: 'Mountain View' },
      fetchImpl,
    );
    expect(result).toMatchObject({ temp: 72, hi: 74, lo: 58, condition: 'Sunny', location: 'Mountain View' });
    // First call is the rounded /points lookup.
    expect(fetchImpl.mock.calls[0][0]).toContain('/points/37.386,-122.083');
  });

  it('throws when an upstream call is not ok', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500 }));
    await expect(
      fetchWeather({ lat: 1, lon: 2, location: 'x' }, fetchImpl),
    ).rejects.toThrow(/HTTP 500/);
  });
});

describe('createWeatherFetcher', () => {
  it('primes the snapshot and serves it from get()', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes('/points/')) return json(pointsJson);
      if (url.endsWith('/hourly')) return json(hourlyJson);
      return json(forecastJson);
    });
    const store = createWeatherFetcher({
      lat: 37.386,
      lon: -122.083,
      location: 'Mountain View',
      fetchImpl,
      setIntervalImpl: () => ({ unref() {} }),
    });
    expect(store.get()).toBeNull();
    await store.ready();
    expect(store.get()).toMatchObject({ temp: 72, location: 'Mountain View' });
  });

  it('keeps the last good snapshot when a refresh fails', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async (url) => {
      calls++;
      if (calls > 3) throw new Error('network down'); // second refresh fails
      if (url.includes('/points/')) return json(pointsJson);
      if (url.endsWith('/hourly')) return json(hourlyJson);
      return json(forecastJson);
    });
    const store = createWeatherFetcher({
      lat: 1,
      lon: 2,
      location: 'x',
      fetchImpl,
      setIntervalImpl: () => ({ unref() {} }),
    });
    await store.ready();
    const good = store.get();
    await store.refresh(); // fails
    expect(store.get()).toBe(good);
  });
});

function json(body) {
  return { ok: true, status: 200, json: async () => body };
}

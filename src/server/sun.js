// Sunrise and sunset from latitude/longitude alone (the standard "sunrise
// equation", accurate to a minute or two at household latitudes), so the
// weather tile can show them without another upstream.

const RAD = Math.PI / 180;
const J1970 = 2440587.5;
const J2000 = 2451545.0;
const sin = (deg) => Math.sin(deg * RAD);
const cos = (deg) => Math.cos(deg * RAD);

const toDate = (julian) => new Date((julian - J1970) * 86_400_000);

/**
 * Sunrise and sunset for the local calendar day of `day` (the host's time
 * zone), at `lat`/`lon` in degrees (east positive). Either is null when the sun
 * doesn't cross the horizon that day (polar day or night).
 */
export function sunTimes(day, lat, lon) {
  const noonUtc = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), 12) / 86_400_000;
  const n = Math.round(noonUtc + J1970 - J2000); // whole days from J2000 to that noon
  const meanSolarNoon = n - lon / 360;
  const M = (357.5291 + 0.98560028 * meanSolarNoon) % 360;
  const C = 1.9148 * sin(M) + 0.02 * sin(2 * M) + 0.0003 * sin(3 * M);
  const lambda = (M + C + 180 + 102.9372) % 360;
  const transit = J2000 + meanSolarNoon + 0.0053 * sin(M) - 0.0069 * sin(2 * lambda);
  const sinDecl = sin(lambda) * sin(23.4397);
  const cosDecl = Math.cos(Math.asin(sinDecl));
  // -0.833°: refraction plus the sun's radius, the usual "first/last light of the disc".
  const cosHour = (sin(-0.833) - sin(lat) * sinDecl) / (cos(lat) * cosDecl);
  if (cosHour < -1 || cosHour > 1) return { sunrise: null, sunset: null };
  const hourDays = Math.acos(cosHour) / RAD / 360;
  return { sunrise: toDate(transit - hourDays), sunset: toDate(transit + hourDays) };
}

const FEED_KEYS = new Set(['generated_at', 'window_days', 'events']);
const EVENT_KEYS = new Set(['uid', 'title', 'start', 'end', 'isAllDay', 'location']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function isCalendarFeed(value) {
  return (
    isObjectWithKeys(value, FEED_KEYS) &&
    isDateTime(value.generated_at) &&
    Number.isInteger(value.window_days) &&
    value.window_days > 0 &&
    Array.isArray(value.events) &&
    value.events.every(isCalendarEvent)
  );
}

function isCalendarEvent(value) {
  if (!isObjectWithKeys(value, EVENT_KEYS)) return false;
  const datesValid = value.isAllDay
    ? isDate(value.start) && isDate(value.end)
    : isDateTime(value.start) && isDateTime(value.end);
  return (
    typeof value.uid === 'string' &&
    value.uid.length > 0 &&
    typeof value.title === 'string' &&
    datesValid &&
    typeof value.isAllDay === 'boolean' &&
    (value.location === null || typeof value.location === 'string')
  );
}

function isObjectWithKeys(value, allowed) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => allowed.has(key)) &&
    Object.keys(value).length === allowed.size
  );
}

function isDate(value) {
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isDateTime(value) {
  return (
    typeof value === 'string' &&
    DATE_TIME.test(value) &&
    isDate(value.slice(0, 10)) &&
    !Number.isNaN(Date.parse(value))
  );
}

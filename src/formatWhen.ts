const dateFmt = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

const timeFmt = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
});

// Compact month+day (no weekday, no year) for multi-day ranges so they fit one
// line in the narrow calendar rail.
const monthDayFmt = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
});

// Split "when" into a date part and a time part so the calendar can stack the
// date over the time in a narrow left column (EventRow). All-day events use
// "all day" as the time part; multi-day all-day events render an inclusive range
// on the date part.
export function formatWhenParts(
  start: Date,
  end: Date,
  isAllDay: boolean,
): { date: string; time: string } {
  const datePart = dateFmt.format(start);
  if (isAllDay) {
    // ICS DTEND for DATE values is exclusive — last visible day is end - 1.
    // Use local-date arithmetic (not ms math) so a DST spring-forward inside
    // the range doesn't shift the last calendar day by one.
    const lastDay = new Date(end);
    lastDay.setDate(lastDay.getDate() - 1);
    if (lastDay.toDateString() === start.toDateString()) {
      // single all-day day: keep the full weekday form
      return { date: datePart, time: 'all day' };
    }
    // multi-day range: drop weekday + year so it fits one line in the rail.
    // same-month → "Jun 1-7"; cross-month → "Jun 15-Jul 2".
    const sameMonth =
      start.getFullYear() === lastDay.getFullYear() &&
      start.getMonth() === lastDay.getMonth();
    const date = sameMonth
      ? `${monthDayFmt.format(start)}-${lastDay.getDate()}`
      : `${monthDayFmt.format(start)}-${monthDayFmt.format(lastDay)}`;
    return { date, time: 'all day' };
  }
  return { date: datePart, time: timeFmt.format(start) };
}

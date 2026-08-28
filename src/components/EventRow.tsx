import type { Event } from '../types';
import { formatWhenParts } from '../formatWhen';

type Props = { event: Event };

export function EventRow({ event }: Props) {
  // Date stacked over time in a narrow left column; the title/location get the
  // freed horizontal room on the right.
  const { date, time } = formatWhenParts(event.start, event.end, event.isAllDay);
  return (
    <li className="event-row">
      <div className="event-when">
        <span className="event-date">{date}</span>
        <span className="event-time">{time}</span>
      </div>
      <div className="event-title">{event.title}</div>
      {event.location && <div className="event-location">{event.location}</div>}
    </li>
  );
}

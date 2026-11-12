import type { Message as MessageType } from '../message';
import { clockParts } from '../clock';
import { useFitText } from './useFitText';

type Props = { line: MessageType | null; now: Date };

// The Home header: clock, date and the agent's one line (posted card 2), set as
// plain text on the background with no card. The line is meant to be short, but
// whatever arrives is shrunk to fit and, past the legible floor, clamped with an
// ellipsis — it never spills out of the header.
export function Header({ line, now }: Props) {
  const { time, weekday, monthDay } = clockParts(now);
  const text = line?.text.trim();
  const lineRef = useFitText(text, { min: 20, max: 46, clamp: true });
  return (
    <header className="hdr">
      <div className="hdr-clock">
        <span className="hdr-time">{time}</span>
        <span className="hdr-date">
          {weekday}
          <span>{monthDay}</span>
        </span>
      </div>
      {text && (
        <div className="hdr-line" ref={lineRef}>
          {text}
        </div>
      )}
    </header>
  );
}

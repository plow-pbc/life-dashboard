import type { Message as MessageType } from '../message';
import { useFitText } from './useFitText';

type Props = { message: MessageType | null };

// The affirmation card (posted card 2, lavender family) in the mockup's
// `.affirmation` slot. A producer posts the note via /api/message?card=2.
// Empty/absent message → the quiet invitation, matching the other posted cards.
//
// The note AUTO-FITS: a short line renders large so the tile doesn't look lost,
// a longer (~180-char) line shrinks toward a legible floor so it fits without a
// hard clip. The fit is measured against the bounded .note box (see useFitText
// and the .note flex/overflow rules in index.css).
//
// The posted date rides INLINE on the eyebrow ("Affirmation · Nov 3") rather
// than a footer: the old "Posted <date>" footer was dropped so a ~180-char note
// fits, and the title line already has the room. The date comes from the
// message's `date` (the producer's compact label); absent → just the title,
// with no dangling separator.
export function Affirmation({ message }: Props) {
  const text = message?.text.trim();
  const date = message?.date?.trim();
  const noteRef = useFitText(text, { min: 20, max: 34 });
  return (
    <section className="card c-lavender affirmation" aria-label="Affirmation">
      <div className="head">
        <span className="eyebrow">Affirmation{date ? ` · ${date}` : ''}</span>
      </div>
      {text ? (
        <div className="note" ref={noteRef}>{text}</div>
      ) : (
        <p className="tile-empty">Ask Hive to post an affirmation.</p>
      )}
    </section>
  );
}

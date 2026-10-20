import type { Message as MessageType } from '../message';

type Props = { message: MessageType | null };

// The affirmation card (posted card 2, lavender family) in the mockup's
// `.affirmation` slot. A producer posts the note via /api/message?card=2; the
// optional top-level `date` ("Oct 15") renders as a subtle mono footnote,
// styled like the mockup footer's "Updated 8:14 AM". Empty/absent message →
// the quiet invitation, matching the other posted cards.
export function Affirmation({ message }: Props) {
  const text = message?.text.trim();
  return (
    <section className="card c-lavender affirmation" aria-label="Affirmation">
      <div className="head">
        <span className="eyebrow">Affirmation</span>
      </div>
      {text ? (
        <div className="note">{text}</div>
      ) : (
        <p className="tile-empty">Ask Hive to post an affirmation.</p>
      )}
      {message?.date && <div className="affirmation-date">Posted {message.date}</div>}
    </section>
  );
}

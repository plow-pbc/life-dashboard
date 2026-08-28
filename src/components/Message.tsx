import { cardPresentation, type CardSlot, type Message as MessageType } from '../message';

type Props = {
  card: CardSlot;
  message: MessageType | null;
};

// Generic box renderer. The producer decides how the card looks: `text` is an
// HTML fragment dropped in verbatim (dangerouslySetInnerHTML) carrying its OWN
// <style> block — the viewer ships no per-widget CSS, only the generic prose
// path and the shared theme tokens/fonts those producer styles reference. No
// per-type branch lives here — weather, sports, and anything a future producer
// invents render through this one path. No sanitization: the single trusted
// household writer is bearer-gated and reads are loopback-only (XSS is out of
// scope by design).
//
// A producer that still posts a bare prose string (the legacy alert / message /
// digest path) is auto-wrapped in <p class="message-text"> so it keeps the prose
// styling (font, clamp, alert bolding) with no lockstep producer cutover. A
// fragment is detected by a leading "<" immediately followed by a tag char
// (letter or "/"), so prose that merely starts with "<" ("<3 from the kids",
// "< 5 min to leave") stays prose. Bare prose is HTML-escaped before wrapping so
// "5 < 10 people" or a literal "&" renders verbatim, not as a broken tag/entity.
// Empty / absent / blank `text` → a quiet invitation, never fake data.
const looksLikeHtml = (s: string) => /^<[a-zA-Z/]/.test(s);
const escapeHtml = (s: string) =>
  s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));

export function Message({ card, message }: Props) {
  const { shown, className } = cardPresentation(card, message);
  // The eyebrow (card title) is producer-controlled: a message's `title`
  // overrides the type-derived label, and an empty title ('') hides it entirely
  // to reclaim vertical space. Absent title → the type label (default).
  const eyebrow = message?.title ?? shown;
  const text = message?.text.trim();
  const html = text
    ? looksLikeHtml(text)
      ? text
      : `<p class="message-text">${escapeHtml(text)}</p>`
    : '';
  return (
    <section className={className} aria-label={`Card ${card}`}>
      {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
      {html ? (
        <div className="tile-body" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <p className="tile-empty">Ask your Plow to post a {shown}.</p>
      )}
    </section>
  );
}

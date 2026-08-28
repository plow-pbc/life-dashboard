export type Message = {
  card: string;
  type: string;
  text: string;
  // Optional producer-controlled eyebrow. Omitted → the card shows its type as
  // the title (default). A non-empty string overrides it; an empty string ("")
  // hides the title entirely, so a producer can reclaim the vertical space.
  title?: string;
};

// The numbered card slots the kiosk renders (3-column grid). With the photo
// banner present: the photo spans 2 tiles on the top row with 3=weather in the
// third; 1, 2, 5 sit equal-width on the next row (1 alert, 2 affirmation,
// 5 sports); 4=digest gets its own full-width row at 2x the card-row height
// below the calendar. (Bannerless: 1/2/3 across the top row, 5 next, 4 full-width.)
// Producers decide which card their message occupies; the message's `type` is
// the card's eyebrow label. The message's `text` is the renderable payload — an
// HTML fragment the viewer drops in generically (dangerouslySetInnerHTML). The
// viewer knows NOTHING about weather or sports specifically: all per-type
// richness lives in the producer-emitted HTML — including its own <style> — which
// references only the viewer's shared theme tokens/fonts, never viewer widget CSS.
export const CARDS = ['1', '2', '3', '4', '5'] as const;
export type CardSlot = (typeof CARDS)[number];

// Empty-slot hint text — the de-facto producer placement, a default NOT a
// contract: the first message to land replaces the hint with its own type.
const EMPTY_HINT: Record<CardSlot, string> = {
  '1': 'alert',
  '2': 'message',
  '3': 'weather',
  '4': 'digest',
  '5': 'sports',
};

// Warm category accent travels with the card POSITION (a stable palette across
// the day regardless of what producers post).
const CARD_ACCENT: Record<CardSlot, string> = {
  '1': 'c-clay',
  '2': 'c-lavender',
  '3': 'c-cornflower',
  '4': 'c-seaglass',
  '5': 'c-clay',
};

// Pure presentation derivation for a card slot — kept out of the component so
// it's testable. Position decides placement + accent; the eyebrow label is the
// producer's `title` (or the type as fallback), resolved in the component.
export function cardPresentation(card: CardSlot, message: Message | null) {
  const shown = message?.type ?? EMPTY_HINT[card];
  return {
    shown,
    className:
      `message-card message-card--card${card} ${CARD_ACCENT[card]}` +
      (message === null ? ' message-card--empty' : ''),
  };
}

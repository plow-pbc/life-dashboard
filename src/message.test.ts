import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { cardPresentation, type CardSlot, type Message } from './message';
import { Message as MessageCard } from './components/Message';
import { msg } from '../test/fixtures';

const render = (card: CardSlot, message: Message | null) =>
  renderToStaticMarkup(createElement(MessageCard, { card, message }));

describe('cardPresentation (type decides styling, position decides placement)', () => {
  it.each<[string, CardSlot, Message | null, string, Partial<ReturnType<typeof cardPresentation>>]>([
    ['eyebrow shows the message type, wherever the card is', '1', msg({ type: 'affirmation' }), 'affirmation', {}],
    [
      'empty slot falls back to the per-position hint',
      '3',
      null,
      'weather',
      { className: 'message-card message-card--card3 c-cornflower message-card--empty' },
    ],
    [
      'card 5 is the sports slot',
      '5',
      null,
      'sports',
      { className: 'message-card message-card--card5 c-clay message-card--empty' },
    ],
    [
      'placement + accent come from the card number',
      '4',
      msg({ type: 'digest' }),
      'digest',
      { className: 'message-card message-card--card4 c-seaglass' },
    ],
  ])('%s', (_label, card, message, shown, expected) => {
    const got = cardPresentation(card, message);
    expect(got.shown).toBe(shown);
    expect(got).toMatchObject(expected);
  });
});

describe('Message renders the producer HTML generically', () => {
  it.each([
    // Any producer HTML drops into .tile-body verbatim — the viewer has no
    // per-type parsing, so weather/sports/future widgets share one path.
    ['sports', '5', '<div class="sp-game"><span class="sp-star">★</span><span class="sp-sc a">5</span></div>'],
    ['weather', '3', '<div class="weather"><span class="weather-temp">72°</span></div>'],
  ])('drops the %s producer fragment into the card body verbatim', (type, card, fragment) => {
    const out = render(card as CardSlot, msg({ type, text: fragment }));
    expect(out).toContain('class="tile-body"');
    expect(out).toContain(fragment);
  });

  it.each([
    // Legacy plain-text producers (ld-morning-triage et al.) keep prose styling
    // via the auto-wrap, with HTML-special chars escaped so content isn't lost
    // and a leading "<" (used as punctuation) treated as prose, not a fragment.
    ['plain prose', 'Pizza night!', '<p class="message-text">Pizza night!</p>'],
    ['escaped &<>', '5 < 10 people & pizza', '<p class="message-text">5 &lt; 10 people &amp; pizza</p>'],
    ['leading "<" punctuation', '<3 from the kids', '<p class="message-text">&lt;3 from the kids</p>'],
  ])('auto-wraps + escapes legacy prose (%s)', (_label, text, expected) => {
    expect(render('1', msg({ type: 'alert', text }))).toContain(expected);
  });

  it('shows a quiet invitation for an absent card, never fake data', () => {
    // Absent (never-posted) is the reachable empty state → the slot's position
    // hint (card 3 = weather). Blank text isn't reachable via the API — POST
    // rejects empty `text` with 400 — so it's not a displayed state.
    const out = render('3', null);
    expect(out).toContain('tile-empty');
    expect(out).toContain('Ask your Plow to post a weather.');
    expect(out).not.toContain('tile-body');
  });

  it.each<[string, string | undefined, string | null]>([
    // The eyebrow is producer-controlled: absent title → type label; empty title
    // → no eyebrow; a string → that label.
    ['absent title falls back to the type label', undefined, 'affirmation'],
    ['empty title hides the eyebrow', '', null],
    ['a custom title overrides the label', 'Scores', 'Scores'],
  ])('producer-controlled title — %s', (_label, title, expected) => {
    const message = title === undefined
      ? msg({ type: 'affirmation', text: 'hi' })
      : msg({ type: 'affirmation', text: 'hi', title });
    const out = render('2', message);
    if (expected === null) expect(out).not.toContain('<span class="eyebrow">');
    else expect(out).toContain(`<span class="eyebrow">${expected}</span>`);
  });
});

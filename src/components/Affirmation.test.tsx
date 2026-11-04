import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { Affirmation } from './Affirmation';
import { msg } from '../../test/fixtures';

const render = (message: Parameters<typeof Affirmation>[0]['message']) =>
  renderToStaticMarkup(createElement(Affirmation, { message }));

describe('Affirmation title-line date', () => {
  it('rides the posted date inline on the eyebrow', () => {
    const html = render(msg({ text: 'You are enough.', date: 'Nov 3' }));
    expect(html).toContain('Affirmation · Nov 3');
  });

  it('shows just the title with no dangling separator when no date', () => {
    const html = render(msg({ text: 'You are enough.' }));
    expect(html).toContain('>Affirmation<');
    expect(html).not.toContain('·');
  });

  it('shows just the title when the date is blank', () => {
    const html = render(msg({ text: 'You are enough.', date: '   ' }));
    expect(html).toContain('>Affirmation<');
    expect(html).not.toContain('·');
  });
});

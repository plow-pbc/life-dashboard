import type { Message } from '../src/message';

export function msg(overrides: Partial<Message> = {}): Message {
  return {
    card: '2',
    type: 'affirmation',
    text: 'hi',
    ...overrides,
  };
}

/** Wraps VEVENT blocks in a minimal VCALENDAR envelope. */
export function calendar(vevents: string): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Test//Test//EN',
    'CALSCALE:GREGORIAN',
    vevents.trim(),
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

export function vevent(fields: Record<string, string>): string {
  const lines = ['BEGIN:VEVENT'];
  for (const [k, v] of Object.entries(fields)) lines.push(`${k}:${v}`);
  lines.push('END:VEVENT');
  return lines.join('\r\n');
}

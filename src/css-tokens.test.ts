import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { describe, it, expect } from 'vitest';

// Guards the one failure this stylesheet actually had, which is silent by
// construction: `var(--x)` on an undefined token is invalid-at-computed-value-
// time, not a parse error, so an inherited property quietly falls back to the
// inherited value. --t-eyebrow rendered four consumers 55% oversized for months
// with nothing red, because a `*/` inside a comment's glob path closed that
// comment early and turned the declaration after it into garbage.
//
// postcss rather than a regex so a declaration sitting inside a comment is not
// counted as declared — the property this guard depends on.
//
// LIMITATION: checks that a token is declared SOMEWHERE, not that it is
// reachable through the cascade from the element using it. Scoped tokens
// (--accent-ink under .c-*, --row-h/--cook-h on .app) pass for any consumer.
const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8');

/** Every problem found in `source`; empty means clean. */
function check(source: string): string[] {
  let root;
  try {
    root = postcss.parse(source, { from: 'index.css' });
  } catch (err) {
    return [`parse: ${(err as Error).message}`];
  }

  const declared = new Set<string>();
  const used = new Set<string>();
  root.walkDecls((d) => {
    if (d.prop.startsWith('--')) declared.add(d.prop);
    // Only bare var(--x) — var(--x, fallback) is safe by construction.
    for (const m of d.value.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) used.add(m[1]);
  });

  return [...used].filter((t) => !declared.has(t)).map((t) => `undefined token ${t}`);
}

describe('index.css', () => {
  it('has no undefined tokens', () => {
    expect(check(css)).toEqual([]);
  });

  // The real stylesheet is clean, so the check above would stay green even if
  // check() stopped detecting anything. This reproduces the original bug in
  // memory, so the guard is exercised on every run rather than only when
  // someone remembers to plant it by hand.
  it('detects the glob-path comment that broke --t-eyebrow', () => {
    const broken = css.replace('ref/team-skills/', 'ref/team-skills/*/SKILL.md');
    expect(broken, 'mutation anchor no longer present in index.css').not.toBe(css);
    expect(check(broken)).not.toEqual([]);
  });

  // The row above is caught by postcss throwing on the garbage the early close
  // leaves behind, so it never reaches the undefined-token check — which is the
  // point of the file. This one does.
  it('detects a token used without a declaration', () => {
    expect(check(`${css}\n.probe { color: var(--nope); }\n`)).toEqual([
      'undefined token --nope',
    ]);
  });
});

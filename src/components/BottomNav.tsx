import { TABS, TAB_LABELS, hashForTab, type Tab } from '../nav';

// Line-art icons in the same stroke idiom as the rest of the dashboard's glyphs
// (stroke: currentColor, 1.8, rounded — set in .nav-icon CSS). viewBox 0 0 24 24.
function NavIcon({ tab }: { tab: Tab }) {
  switch (tab) {
    case 'home':
      return (
        <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5.5 9.5V21h13V9.5" />
          <path d="M9.75 21v-6h4.5v6" />
        </svg>
      );
    case 'calendar':
      return (
        <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
          <path d="M3 9.5h18" />
          <path d="M8 2.5v4M16 2.5v4" />
        </svg>
      );
    case 'meals':
      return (
        <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
          {/* fork */}
          <path d="M6 3v4M8 3v4M10 3v4" />
          <path d="M6 7c0 1.2 .9 2 2 2s2-.8 2-2" />
          <path d="M8 9v12" />
          {/* knife */}
          <path d="M16.5 3c-1.4 0-2.5 2.2-2.5 5s1.1 4 2.5 4" />
          <path d="M16.5 12v9" />
        </svg>
      );
  }
}

// The persistent bottom nav. Each tab is a finger-sized <a href="#tab"> so a tap
// changes the hash natively (hashchange → the shell swaps the pane); the active
// tab is highlighted. Anchors (not buttons) keep it robust even if JS is slow:
// the hash still changes on tap.
export function BottomNav({ tab }: { tab: Tab }) {
  return (
    <nav className="bottom-nav" aria-label="Dashboard sections">
      {TABS.map((t) => (
        <a
          key={t}
          className={'nav-item' + (t === tab ? ' is-active' : '')}
          href={hashForTab(t)}
          aria-current={t === tab ? 'page' : undefined}
        >
          <NavIcon tab={t} />
          <span className="nav-label">{TAB_LABELS[t]}</span>
        </a>
      ))}
    </nav>
  );
}

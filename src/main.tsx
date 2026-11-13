import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { setFamilyKeywords } from './calendarLayout';
// Warm-theme fonts, bundled so Vite ships the woff2 files in the build (the
// kiosk runs offline; no system-installed fonts assumed). The viewer loads the
// weights its own chrome uses plus those producer-emitted widget HTML references
// (700, for sports scores) — font assets are part of the shared theme contract.
import '@fontsource/instrument-serif'; // 400 — display figures
import '@fontsource/dm-sans/300.css'; // light running copy
import '@fontsource/dm-sans/300-italic.css'; // empty-card placeholder
import '@fontsource/dm-sans/400.css'; // body default (unstyled text)
import '@fontsource/dm-sans/500.css'; // event titles
import '@fontsource/dm-sans/600.css'; // Home calendar day letters and event titles
import '@fontsource/dm-sans/700.css'; // bold — producer widget HTML (e.g. sports scores)
import '@fontsource/dm-mono/500.css'; // eyebrows / captions / date rail
import './index.css';

// Household calendar keywords are runtime config, so load them before the first
// render; a failed read just leaves the built-in keywords in place.
fetch('api/config')
  .then((res) => res.json())
  .then((cfg: { familyKeywords?: string[] }) => setFamilyKeywords(cfg.familyKeywords ?? []))
  .catch((err) => console.error('api/config', err))
  .finally(() =>
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  );

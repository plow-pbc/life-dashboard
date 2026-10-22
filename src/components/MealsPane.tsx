import { useEffect, useState } from 'react';
import { embedSrc } from '../pinch';

// The Meals pane: the owner's CONFIGURED Pinch recipe app, embedded in an iframe
// filling the pane above the nav. The base URL is not hardcoded — it comes from the
// viewer config (GET /api/config → pinchBackendUrl + pinchEmbedToken). The origin is
// validated to a bare https origin and also drives the CSP frame-src, so the iframe
// src and the policy that must allow it are always the same value. Embedding (not
// navigating away) keeps the nav visible, so tapping Home returns to the dashboard.
//
// AUTH: Pinch's embed needs a read-only token to render the library rather than its
// login gate. The token rides in the embed URL query — src = <origin>/embed?token=<token>
// — which Pinch reads server-side as a Bearer (no cookie). The server percent-encodes the
// token before serving it, so it is interpolated verbatim here (no re-encoding).
//
// PERSISTENT src = BASE embed URL. The ~5-min kiosk reload remounts this pane, so the
// reload always loads the base URL and Pinch restores the user's last position — the
// wall must never BAKE a recipe into the persistent src (it would yank the user back on
// every reload). `openRecipe` is a ONE-TIME request (from a Cook Tonight tap): it is
// frozen at mount into a one-shot &recipe= deep-link, then cleared in the parent via
// onConsumed so a later remount/reload is base again. The id is never in the URL/hash,
// so a reload is base by construction. Pinch also strips the param after landing, so
// its OWN in-embed reloads stay clean.
//
// allow="autoplay": lets the embed sound a timer chime without a user gesture (paired
// with the kiosk --autoplay-policy=no-user-gesture-required flag).
//
// Unconfigured — missing EITHER the origin or the token — → this pane shows a short
// placeholder instead (an origin with no token would only ever render the login gate).

type Config = { loaded: boolean; origin: string | null; token: string | null };

export function MealsPane({
  openRecipe,
  onConsumed,
}: {
  openRecipe: string | null;
  onConsumed: () => void;
}) {
  const [cfg, setCfg] = useState<Config>({ loaded: false, origin: null, token: null });
  // Freeze the requested recipe at mount: it drives the one-shot deep-link only, so a
  // later openRecipe change (incl. the parent clearing it) never reloads the iframe.
  const [recipeOnce] = useState(openRecipe);

  // Clear the one-shot in the parent so the next remount (tab switch) or reload is base.
  useEffect(() => {
    if (recipeOnce) onConsumed();
  }, [recipeOnce, onConsumed]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('api/config');
        if (!res.ok) {
          if (!cancelled) setCfg({ loaded: true, origin: null, token: null });
          return;
        }
        const body = (await res.json()) as {
          pinchBackendUrl?: string | null;
          pinchEmbedToken?: string | null;
        };
        if (!cancelled)
          setCfg({
            loaded: true,
            origin: body.pinchBackendUrl ?? null,
            token: body.pinchEmbedToken ?? null,
          });
      } catch {
        if (!cancelled) setCfg({ loaded: true, origin: null, token: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Stay blank until we know (avoids flashing the placeholder before the iframe).
  if (!cfg.loaded) return <div className="meals-pane" />;

  if (!cfg.origin || !cfg.token) {
    return (
      <div className="meals-pane">
        <div className="meals-empty">
          <svg className="meals-empty__icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 3v4M8 3v4M10 3v4" />
            <path d="M6 7c0 1.2 .9 2 2 2s2-.8 2-2" />
            <path d="M8 9v12" />
            <path d="M16.5 3c-1.4 0-2.5 2.2-2.5 5s1.1 4 2.5 4" />
            <path d="M16.5 12v9" />
          </svg>
          <p className="meals-empty__text">
            Set up recipes with Hive first, then this opens your Pinch.
          </p>
        </div>
      </div>
    );
  }

  // Base embed URL, or a one-time recipe deep-link when this mount was a Cook Tonight
  // tap (recipeOnce). The token (already percent-encoded by the server) authenticates
  // it so Pinch renders the app rather than its login gate.
  const src = embedSrc(cfg.origin, cfg.token, recipeOnce);

  return (
    <div className="meals-pane">
      <iframe
        className="meals-frame"
        src={src}
        title="Meals — your Pinch recipes"
        allow="autoplay"
      />
    </div>
  );
}

import { useEffect, useState } from 'react';

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
// A `recipeId` (from a `#meals/cook/<id>` deep-link, e.g. the Cook Tonight tile)
// deep-links to that recipe, carrying the same token: src = <origin>/cook/<id>?token=<token>.
// CRITICAL: the origin is ALWAYS the configured one, never the snapshot cookUrl's
// host — the cookUrl host may differ from PINCH_BACKEND_URL, and a cross-origin
// src would be blocked by the CSP frame-src. The id is already validated to a safe
// path-segment charset (nav.mealsRecipeFromHash / pinch.cookRecipeId). No recipeId
// → the Pinch library embed (a direct Meals nav tap).
//
// Unconfigured — missing EITHER the origin or the token — → this pane shows a short
// placeholder instead (an origin with no token would only ever render the login gate).

type Config = { loaded: boolean; origin: string | null; token: string | null };

export function MealsPane({ recipeId }: { recipeId: string | null }) {
  const [cfg, setCfg] = useState<Config>({ loaded: false, origin: null, token: null });

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

  // Deep-link to a recipe on the CONFIGURED origin (never the cookUrl host), else
  // the Pinch library embed. The token (already percent-encoded by the server)
  // authenticates both so Pinch renders the app rather than its login gate.
  const src = recipeId
    ? `${cfg.origin}/cook/${recipeId}?token=${cfg.token}`
    : `${cfg.origin}/embed?token=${cfg.token}`;

  return (
    <div className="meals-pane">
      <iframe className="meals-frame" src={src} title="Meals — your Pinch recipes" />
    </div>
  );
}

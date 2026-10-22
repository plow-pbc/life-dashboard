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
// The src is ALWAYS the BASE embed URL — never a /cook/<id> or /recipe/<id> deep-link.
// Pinch itself restores the user's last position inside the embed, so the wall must NOT
// drive where the embed lands: the persistent iframe and the ~5-min kiosk reload both
// load the base URL, and Pinch takes it from there. (This is why the pane takes no
// recipe id — the Cook Tonight tile is a separate navigation, not an embed deep-link.)
//
// Unconfigured — missing EITHER the origin or the token — → this pane shows a short
// placeholder instead (an origin with no token would only ever render the login gate).

type Config = { loaded: boolean; origin: string | null; token: string | null };

export function MealsPane() {
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

  // Always the base embed URL. The token (already percent-encoded by the server)
  // authenticates it so Pinch renders the library rather than its login gate; Pinch
  // restores the user's last position within the embed on its own.
  const src = `${cfg.origin}/embed?token=${cfg.token}`;

  return (
    <div className="meals-pane">
      <iframe className="meals-frame" src={src} title="Meals — your Pinch recipes" />
    </div>
  );
}

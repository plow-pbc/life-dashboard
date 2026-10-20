// The configured Pinch backend URL (env PINCH_BACKEND_URL) feeds TWO sinks that
// are both injection-sensitive: the page CSP `frame-src` header and the Meals
// iframe `src`. So it is validated to a bare, clean https ORIGIN and nothing more
// — no path, query, fragment, credentials, or wildcard host — and the normalized
// origin is what both sinks use. Anything that doesn't pass returns null, which
// the server treats as "unconfigured" (no frame-src, Meals shows a placeholder).

const HOST_RE = /^[a-z0-9.-]+$/i;

/**
 * Normalize a raw PINCH_BACKEND_URL to a clean `https://host[:port]` origin, or
 * null if it is absent/invalid. Origin-only by construction (URL.origin drops any
 * path/query/fragment), https-only, no credentials, no wildcard host.
 */
export function normalizePinchBackendUrl(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null; // https only (CSP + iframe)
  if (u.username || u.password) return null; // no embedded credentials
  if (u.search || u.hash) return null; // origin only — no query/fragment
  if (u.pathname && u.pathname !== '/') return null; // origin only — no path
  if (!HOST_RE.test(u.hostname)) return null; // safe host charset (no '*', no injection)
  // URL.origin is "https://host" (or "https://host:port"), never a trailing slash.
  return u.origin;
}

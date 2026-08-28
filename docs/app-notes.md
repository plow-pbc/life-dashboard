# life-dashboard-viewer

Tiny React app that shows the next 12 events from a shared Google Calendar, served by a Node proxy on the kiosk box.

## Local dev

```sh
cp .env.example .env
# Fill in ICAL_URL with the calendar's private ICS URL.

npm install
just dev    # starts Vite (5173) + API server (5174), Vite proxies /api → 5174
```

Open http://localhost:5173.

## Tests

```sh
just test
```

## Kiosk deploy

The canonical bring-up is the repo-root [`README.md`](../README.md) § Bring-up
on a fresh Pi, with the updater bootstrap in
[`updater/README.md`](../updater/README.md) § Bootstrap — this repo no longer
ships as a SEED. The unit files at the repo root
(`life-dashboard-viewer.service`, `life-kiosk-viewer.service`) are systemd
**user** units using the `%h` home-dir specifier; Chromium is a system package
at `/usr/bin/chromium`. `life-kiosk-viewer.service` orders itself
`After=life-dashboard-viewer.service` and recycles Chromium hourly
(`RuntimeMaxSec=1h`) so any manual navigation away from the kiosk URL resets
within the hour.

## Configuration

| Variable | Required | Default | Notes |
|---|---|---|---|
| `ICAL_URL` | yes | — | Full private ICS URL. Secret. |
| `NEXT_N` | no | `12` | Max events displayed. **Baked at build time** — rebuild to change. |
| `REFRESH_MS` | no | `300000` | Page reload interval (5 min). **Baked at build time**. |
| `DASHBOARD_TOKEN` | no | — | Bearer token for the remote write APIs (`/api/message`, the texted-photo CRUD `POST`/`DELETE /api/banners`) and the off-box `GET /api/version` verification read. Setting it enables those routes and binds the server on `0.0.0.0` (LAN-reachable). Secret. |
| `PINCH_DATA_FILE` | no | — | Recipe library JSON for the Cook Tonight strip; cached photos are read from its sibling `photos/`. Blank → `/api/pinch/*` never mounts and the strip is absent (no row allocated). |

## Cook Tonight (optional)

A short strip above the calendar showing one recipe from a Paprika library, with its photo.

**This app never writes the recipe files.** A separate out-of-process sync job owns them and rewrites the library on a schedule; the dashboard only reads, which is why the store has no lock and no write path. See [`SEED.md`](../../SEED.md) § Recipe sync for installing that job. Without it, leave `PINCH_DATA_FILE` blank and the strip is simply absent.

Which recipe shows: the most recently cooked, else anything in the library.

Reads are loopback-only like every other read — a recipe library is household data — and served under the same Host guard. The strip is display-only: there is no cooking mode, grocery list, or recipe detail here, and no route mutates anything.

Only a photo served by this app's own `/api/pinch/photos/<id>` route is rendered. The sync stores Paprika's URL verbatim when it is publicly fetchable, so a recipe imported from the web can carry a remote one; rendering that would have the kiosk fetch a third-party endpoint on every reload.

**That is a contract with the sync, which is not versioned in this repo** (see `SEED.md` § Recipe sync): it must emit `photoUrl` as exactly `/api/pinch/photos/<id>`, with `<id>` matching the route's `[A-Za-z0-9_-]{1,128}`. A local URL in any other shape — an extension, a cache-busting query, a wider alphabet — is treated as remote and falls back to the placeholder for every recipe at once.

## Architecture

One Node process serves the Vite-built React SPA AND proxies the secret ICS URL at `/api/ical` with a 60-second in-memory cache and stale-on-failure fallback. The React app fetches that same-origin endpoint, parses with `ical.js` (recurrence-aware, drops `STATUS:CANCELLED`), and renders a list of the next `NEXT_N` events. The page calls `location.reload()` every `REFRESH_MS` (5 min default) — that, not in-app polling, is the freshness + state-recovery mechanism. Without `DASHBOARD_TOKEN` the server binds loopback only; with it, it binds `0.0.0.0` so remote producers can reach the write APIs. A Host-header allowlist defends loopback callers against DNS rebinding; non-loopback callers may only POST `/api/message`, mutate banners via `POST`/`DELETE /api/banners`, and read `GET /api/version` — all with the bearer (every other read, the banner listing, and the SPA stay loopback) plus the open `/healthz` probe.

## Messages (optional)

Plow posts messages from the `ld-*` bundles (in the `plow-pbc/seed-life-dashboard-agent`
repo, under `ref/team-skills/`; rendered-card text is capped producer-side — see the
`SKILL.md` bundles there — sized to this app's `--t-card`/line-clamp budget) directly
to this server's `/api/message`
endpoint. Storage is a file-backed
JSON store (`data/messages.json`) keyed by **card number**: each POST writes
the latest message for its card slot, so a chatty producer can never evict
another card's content. The kiosk browser fetches `/api/message?card=N` from
the same-origin server (the bearer token never reaches the browser) and renders
five numbered slots. A card whose slot has no stored message renders a quiet
invitation placeholder so the layout stays at fixed dimensions all day.

### Card layout

Cards are dumb numbered slots; **producers decide placement**. The grid is 3
columns. With a photo banner present: the photo spans 2 tiles on the top row
with **card 3 (weather)** in the third; **cards 1, 2, 5** sit equal-width on the
next row (1 alert, 2 affirmation, 5 sports); **card 4 (digest)** gets its own
full-width row at 2× the card-row height below the calendar. Each position keeps a stable
warm category accent (1 clay, 2 lavender, 3 cornflower, 4 seaglass, 5 clay) so
the palette doesn't shift as content changes.

Bannerless:

```
┌─────────┬─────────┬─────────┐
│  Card 1 │  Card 2 │  Card 3 │  15rem
├─────────┴─────────┴─────────┤
│           Card 5            │  15rem
├─────────────────────────────┤
│      Cook Tonight strip     │  8rem  — conditional, see below
├─────────────────────────────┤
│                             │
│          Calendar           │  flexible
│                             │
├─────────────────────────────┤
│           Card 4            │  30rem
└─────────────────────────────┘
```

With a photo banner, the top two rows become `banner banner card3` / `card1
card2 card5`; the rest is unchanged.

The Cook Tonight strip appears only when there is a recipe to show: the snapshot
is configured AND the library has at least one recipe. No snapshot, an empty
library, or a failed fetch all render nothing — `<CookTonight/>` returns null and
`.app:has(.pinch-tile)` never matches, so the kiosk keeps the full calendar
height rather than showing a blank card. Same bargain `.app:has(.banner)`
strikes for the photo.

### Wire contract

POST body: `{ card, type, text }` — all three required, trimmed; any non-empty
string is accepted for each field. An optional `title` (string) controls the
card's eyebrow. GET with `?card=K` returns `{ message }` (null when the slot has
no content). Messages posted to a card other than `'1'`–`'5'` are accepted and
stored but never displayed (the kiosk only fetches those five).

**The card's eyebrow is producer-controlled via the optional `title`** — omit it
and the card shows its `type` as the small uppercase label (`type: 'affirmation'`
shows "AFFIRMATION"); send `title: "Scores"` to override it; send `title: ""` to
**hide the eyebrow entirely** (reclaims the vertical space — e.g. alert /
affirmation / sports run title-less). **The message's `text` is the
renderable payload**: a *self-contained* HTML fragment the viewer drops into the
card body verbatim (`dangerouslySetInnerHTML`) — it carries its **own `<style>`
block**, so all widget-specific styling lives in the producer's HTML, not the
viewer. The viewer has **no per-type rendering code and no per-widget CSS** —
weather, sports, and any future widget render through this one path. Adding or
restyling a widget is a pure producer change; the viewer never changes. The one
shared contract is the viewer's theme tokens and bundled fonts (`--ink`,
`--muted`, `--live-red`, the DM Sans / DM Mono weights, …) that the producer's
`<style>` may reference; the viewer itself styles only the generic prose path
(`.message-text`).

A producer that still posts a bare prose string (the legacy alert / message /
digest path) is auto-wrapped in `<p class="message-text">` — and HTML-escaped —
so it keeps prose styling with no lockstep cutover. There is **no
sanitization** of producer HTML: the single trusted household writer is
bearer-gated and reads are loopback-only, so XSS is out of scope by design.

There is no expiry: the latest post per card stays on screen until a newer one
for the same card lands. **To clear a card, post a newer message to that card**
(e.g. empty-state wording), since nothing expires on its own.

To enable:

1. **Generate a token:** `openssl rand -hex 32`. Set `DASHBOARD_TOKEN=<token>` in `.env` on the Pi, then restart `life-dashboard-viewer.service`. The server will bind `0.0.0.0:5174` and register `/api/message`.
2. **Configure producers** (e.g. Plow on the Mac) to POST `{"card","type","text"}` with `Authorization: Bearer <token>` to `http://<pi-tailscale-hostname>:5174/api/message`. Default to a Tailscale hostname — the bearer is then WireGuard-encrypted on the wire. A raw LAN hostname/IP works as a trusted-household fallback, with the bearer transiting in plaintext. The remote surface is write-only except `GET /api/version` (bearer-gated, for deploy verification): every other GET is loopback-only (the kiosk).

If `DASHBOARD_TOKEN` is not set, the `/api/message` route is not registered and the message cards render as muted empty-state placeholders (the calendar still works).

## Banners (optional)

Drop image files (`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`) into `./banners/` next to `server.js`. The dashboard fetches the listing at page load and shows one banner across the top row (3 tiles wide, beside the weather card), cycling through the sorted list once an hour. Selection is keyed off the wall clock (`floor(now / 1h) % count`), so it survives the kiosk's `REFRESH_MS` page reloads — every reload within the same hour shows the same banner. The hourly pick is only the baseline: a horizontal swipe on the image steps to the next/previous photo locally, until the next page reload re-bases to the hourly index. With an empty or missing folder `<Banner/>` renders nothing and the grid uses the bannerless layout (via `.app:has(.banner)`) — no photo row, and the message cards fill the top row instead. When banners are present, the photo takes the top row (3 tiles wide) beside the weather card. Files are served straight off disk; no rebuild required when adding new banners (changes pick up at the next page reload).

### Texted-photo uploads (when `DASHBOARD_TOKEN` is set)

Two file families share `./banners/`: **curated** files (e.g. the `s2_*` family set) and **agent-uploaded** "texted" photos, which are always namespaced `up_<ms>_<rand>_<slug>.jpg`. The bearer-gated CRUD only ever touches the `up_*` set — curated files are never modified. **The `up_` prefix is reserved for uploads:** the cap/clear/delete operations match files by that prefix, so don't name a curated drop-in `up_*` or it will be treated as an upload and can be trimmed or cleared.

- `POST /api/banners` — body `{ "filename": "...", "data": "<base64 image>" }` (≤15 MB; JPEG/PNG/WebP/GIF only, enforced by a magic-byte check; HEIC must be converted client-side). Validates, bakes in EXIF orientation, strips metadata, resizes to ≤1600px longest side, re-encodes JPEG, and caps the `up_*` set to the newest 10. Returns `{ stored, upCount }`.
- `DELETE /api/banners` — removes **all** `up_*` photos (curated files survive).
- `GET /api/banners` — the loopback listing the kiosk reads (unchanged).

Plow posts messages and texted photos via the `ld-*` team-skills (`plow-pbc/seed-life-dashboard-agent`).

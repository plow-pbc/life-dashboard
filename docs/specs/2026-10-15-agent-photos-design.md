# Agent-programmable photos — design

**Status:** proposal (read-only scoping; nothing built here)
**Date:** 2026-10-15

## Goal

The owner texts the Lifey agent to **add / change / remove** the photos shown
in the wall's top-left photo Banner, and the Banner photos stay **swipeable**.

## TL;DR

The viewer side is **already built**. `POST`/`DELETE /api/banners` exist,
`sharp` already validates + resizes + strips EXIF, uploads are namespaced
`up_<ms>_<rand>_<slug>.jpg` and capped at 10, the swipe already works, and the
privacy model (loopback-only reads, bearer-gated writes, CSP that renders only
the app's own `/banners/*` route) is in place. **The only missing piece is on
the Lifey agent:** there is no photo-CRUD helper analogous to
`skills/wall/scripts/kiosk_card.py`, no wall `SKILL.md` to teach the flow, and
the current API only supports add + clear-all (no single remove, no reorder).
The simplest robust ship is a small `wall_photo.py` helper plus skill prose;
single-remove and reorder are optional viewer additions the owner may not need.

---

## End-to-end flow

```
Owner texts a photo to Lifey (Plow chat)
   │
   ▼
plugin/index.ts receive(): account "chat" downloads each attachment, calls
   runtime.channel.media.saveMediaBuffer(...) → a local file in the container,
   handed to the model as media[] = { path, contentType, fileName }
   │
   ▼
Model recognizes "put this on the wall" → runs the wall skill's photo helper
   (proposed: skills/wall/scripts/wall_photo.py), the deterministic twin of
   kiosk_card.py. It reads the Pi endpoint + bearer location from config and
   PRINTS the two Latch calls to make (it never posts, never touches the token).
   │
   ▼
Latch (two calls the agent makes, exactly like kiosk_card.py):
   1. mcp__plow__plow_write_file  → stage the base64 JSON body on the Mac
   2. mcp__plow__plow_run_command → curl it to the Pi with -H @…/dashboard.hdr
   │   (the cloud agent can't reach the Pi; the Mac is the only box on its LAN)
   ▼
Pi viewer: POST /api/banners  (bearer-gated, non-loopback producer write)
   src/server/banners.js save(): magic-byte check → sharp rotate/resize/strip
   → write up_<ms>_<rand>_<slug>.jpg atomically → cap up_* to newest 10
   │
   ▼
Banner.tsx fetches GET /api/banners (loopback list) at the next page reload
   (~5 min), serves the file from /banners/*, shows one at a time, swipe steps.
```

The upload path is the same shape the wall already uses for **cards**
(`kiosk_card.py` → Latch write + curl). Photos reuse that muscle exactly; only
the endpoint (`/api/banners`) and the body (base64 image) differ.

---

## Storage & data model (on the Pi)

- **Where:** `~/ld-data/banners/` on the Pi (gitignored; symlinked into every
  release by the updater, so a deploy never loses photos — `updater/README.md`).
  Served at runtime from `./banners/` via `serveStatic('/banners/*')`.
- **Two families share the folder** (`docs/app-notes.md` §167):
  - **curated** drop-ins (e.g. the `s2_*` family set) — placed by hand on the
    Pi, never touched by the agent.
  - **agent-uploaded ("texted")** photos, always `up_<ms>_<rand>_<slug>.jpg`.
    The bearer-gated CRUD matches **only** the `up_*` prefix, so it can never
    trim or clear a curated photo. (Reserved-prefix rule: don't name a curated
    file `up_*`.)
- **No separate manifest.** Ordering is **derived from filenames**: `GET
  /api/banners` lists the folder and `.sort()`s ascending. For `up_*` files the
  leading `up_<ms>` epoch makes sort order == chronological order. The viewer's
  `hourlyIndex` then picks a baseline off `floor(now/1h) % count`. This is the
  right default: a manifest is a second source of truth that can disagree with
  the folder (the same reasoning the recipe tile uses to *derive* its photos
  dir rather than configure one).
- **Format / size:** inputs JPEG/PNG/WebP/GIF only (magic-byte gated; **HEIC is
  rejected server-side** — the prebuilt libvips can't decode it). `sharp`
  bakes in EXIF orientation, **strips all metadata (incl. GPS)**, resizes to
  ≤1600px longest side (never upscales), re-encodes JPEG q82. Request ceiling
  15 MB decoded; decode ceiling 64 MP (decompression-bomb guard).
- **Cap:** newest **10** `up_*` kept; older ones auto-deleted on each save.

---

## Mapping text commands → operations

| Owner says (example) | Operation | Available today? |
|---|---|---|
| texts a photo: "put this on the wall" | `POST /api/banners` (add) | **Yes** — API done; needs agent helper |
| "add these to the wall" (several photos) | one `POST` per image | **Yes** — loop the helper |
| "clear the wall photos" / "take them all down" | `DELETE /api/banners` (clear all `up_*`) | **Yes** — API done; needs agent helper |
| "change the wall photo to this one" | `DELETE` then `POST` (clear + add), **or** add + let the cap/owner prune | **Yes** via compose; "replace exactly one" is not a primitive |
| "take down *that* beach photo" (one specific) | — | **No** — no single-delete route (see Gaps) |
| "put the baby picture first" (reorder) | — | **No** — order is filename-derived (see Gaps) |

**Recommended command surface for v1:** *add* (one or many) and *clear all*.
These two cover the stated goal (add / change / remove) when "change" is read
as clear-then-add and "remove" is read as clear-all. The wall holds a small
rotating set, not a managed album, so this is likely enough — confirm with the
owner (open question Q1).

### Proposed agent helper: `skills/wall/scripts/wall_photo.py`

Deterministic twin of `kiosk_card.py`, same safety posture:

- **Reads** the Pi endpoint from `config.wall.endpoint_url` in
  `/var/lib/plow/workspace/lifey/config.json`, validated against a strict regex
  — reuse the exact `ENDPOINT_RE` shape but anchored to `…/api/banners`
  (the metacharacter-host injection guard is load-bearing: the URL is
  interpolated into the `sh -c` the Mac runs).
- Takes `--image PATH` (the saved inbound media path) for *add*, or `--clear`.
  For *add* it base64-encodes the file into the `{ "filename", "data" }`
  envelope the viewer expects.
- **Never posts and never touches the token.** It PRINTS the same two-call
  Latch block `kiosk_card.py` prints: `plow_write_file` the JSON to
  `~/Plow/ld/photo-<n>.json`, then `plow_run_command` a
  `curl -fsS -H @$HOME/Plow/ld/dashboard.hdr … <endpoint>`
  (`-X DELETE` with no body for clear).
- Keep the image body **off argv** (write the base64 to the staged file via
  `plow_write_file`, exactly as card bodies stay off the command line).

### Proposed wall `SKILL.md`

There is currently **no `skills/wall/SKILL.md`** — only the scripts dir exists.
Add one that teaches: when the owner texts a photo "for the wall," run
`wall_photo.py --image <media.path>` and make the two printed Latch calls;
when they say "clear/take down the photos," run `wall_photo.py --clear`. State
the HEIC limitation (convert first, see Q3) and that the wall shows the newest
~10. Mirror `kiosk_card.py`'s tone: the helper is the deterministic half; the
model makes the Latch calls.

---

## Swipe behavior

**Already implemented and tested** — no work needed for the core goal.

- `src/banner.ts`: pure, unit-tested index logic. `hourlyIndex` picks the
  baseline (survives the kiosk's ~5-min `location.reload()`); `stepIndex` wraps
  next/prev; `swipeDir(dx,dy)` classifies a gesture (≥45px, more horizontal
  than vertical) — swipe **left → next**, **right → prev**, taps/vertical drags
  ignored.
- `src/components/Banner.tsx`: pointer-capture swipe on the `<img>`, one photo
  at a time, filename URL-encoded (`summer#1.png` won't be parsed as a
  fragment), empty list collapses the row.
- **What's needed for swipe:** nothing. A freshly texted photo appears at the
  next reload and is immediately in the swipe cycle. (Optional nicety: no
  position indicator / dots today — consistent with the "no decorative
  signifiers" house rule; leave it out.)

---

## Privacy

Family photos; keep them off any public path. The viewer's existing model
already enforces this — the agent side must not undermine it:

- **Reads never leave loopback.** `GET /api/banners` and `/banners/*` are
  loopback-only; non-loopback callers may **only** `POST`/`DELETE /api/banners`
  (plus message/calendar/version) with the household bearer. The kiosk reads
  its own photos over loopback; nobody off-box can list or fetch them.
- **Host-header allowlist** guards loopback callers against DNS-rebinding —
  applied to the whole surface *because* banner images can be private.
- **CSP** (`img-src 'self' data:`) means the viewer renders **only its own
  `/banners/*` route**, never an arbitrary remote URL — the same rule the
  recipe tile relies on. A texted photo must be **stored on the Pi and served
  locally**; never point the Banner at a remote image URL.
- **EXIF/GPS stripped** by `sharp` on every upload — texted photos don't carry
  home coordinates onto the wall or into the file at rest.
- **Token hygiene** (inherited from `kiosk_card.py`): the bearer lives only in
  `~/Plow/ld/dashboard.hdr` on the Mac, read via `curl -H @file`; it never
  crosses the Latch relay or appears in argv. The image bytes likewise stay off
  argv (staged file, not command line).
- **Group-chat leakage:** a photo texted in a group reaches the owner's Mac and
  the household wall. The agent already refuses Mac-touching setup in groups;
  the skill should only honor "put this on the wall" from the owner's own
  authority (owner DM / trusted context), consistent with the existing wall-
  setup rule. (See Q4.)

---

## Gaps vs. the stated goal

1. **Agent helper + skill (required).** No `wall_photo.py`, no wall `SKILL.md`.
   This is the real work: a small deterministic script + prose. Everything it
   calls already exists.
2. **Single-photo remove (optional).** API is add + clear-all only. "Take down
   *that* one" has no primitive. Deferring is reasonable (the set is tiny and
   rotates); if wanted, add `DELETE /api/banners/:name` scoped to `up_*` and a
   way for the agent to list current photos with thumbnails to pick from.
3. **Reorder (optional).** Order is filename/epoch derived. "Put this first"
   isn't expressible without either a manifest (rejected above as a second
   source of truth) or a rename convention. Likely out of scope for a rotating
   wall; confirm with owner.

---

## Open questions for the owner

- **Q1 — Scope of "change/remove":** Is add + clear-all enough, or do you want
  to remove/reorder *individual* photos? (Drives whether we touch the viewer
  API at all, vs. ship the agent helper alone.)
- **Q2 — Curated vs. texted:** Should texted photos live *alongside* the
  curated `s2_*` family set (both rotate together), or should "clear the wall"
  wipe everything? Today clear-all only removes `up_*`; curated photos survive.
- **Q3 — HEIC:** iPhone photos are often HEIC, which the server rejects. Do we
  (a) convert on the owner's Mac via Latch (`sips`) before upload, (b) have the
  agent transcode in-container, or (c) tell the owner to send JPEG? (a) fits the
  existing Mac-as-waypoint pattern best.
- **Q4 — Who can post:** Only the owner, from their own DM? Or anyone in a
  trusted household group? (Privacy + the existing "no setup in groups" rule.)
- **Q5 — Cap of 10:** Is 10 the right ceiling for the texted set, or should the
  wall hold more / fewer?
- **Q6 — Confirmation / undo:** After a photo goes up (next reload, up to ~5
  min), should Lifey text a confirmation? Is clear-all's irreversibility okay,
  or do we want a soft-delete window?
```
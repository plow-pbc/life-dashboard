# life-dashboard

Template for a household wall kiosk: a React/Vite calendar-and-cards dashboard
(`src/`, served by `server.js` on a Raspberry Pi) plus the Pi-side updater
(`updater/`) that turns a git push into a health-checked, auto-rolling-back
deploy. An agent (or a human) develops the dashboard by pushing to the
household's repo; the wall updates itself.

- Wire protocol producers post against: `docs/kiosk-protocol.md` (canonical copy).
- Deploy/rollback mechanics and on-disk layout: `updater/README.md`.
- App internals (routes, guards, tiles): `docs/app-notes.md`.

## How households use this

Each household deploys from its **own private copy** of this template — a
plain clone-push, **not a GitHub fork** (forks of public repos must be public,
and the household repo may accumulate household-specific tweaks):

```sh
gh repo create <you>/life-dashboard-<household> --private
git clone git@github.com:<you>/life-dashboard-<household>.git
cd life-dashboard-<household>
git remote add template git@github.com:plow-pbc/life-dashboard.git
git fetch template && git merge template/main && git push origin main
```

To pick up template improvements later: `git fetch template && git merge
template/main && git push` (the updater deploys the merge like any other push).

## Bring-up on a fresh Pi

1. Create the household repo (above) and give the Pi read access to it.
2. Seed the updater (clone to `~/ld-releases/bootstrap`, initial `~/ld-current`
   symlink, `~/ld-data/`, enable the timer) — exact commands in
   `updater/README.md` § Bootstrap.
3. Write `~/ld-data/.env` from the keys documented in `.env.example`
   (`ICAL_URL` is required; `DASHBOARD_TOKEN` enables the remote message/photo
   APIs; `PINCH_DATA_FILE` enables the recipe tile). Secrets stay on the Pi —
   they are never in any repo.
4. Install and start the viewer + kiosk units:
   ```sh
   cp life-dashboard-viewer.service life-kiosk-viewer.service ~/.config/systemd/user/
   systemctl --user daemon-reload
   systemctl --user enable --now life-dashboard-viewer life-kiosk-viewer
   loginctl enable-linger $USER   # user units run without a login session
   ```

## The agent's deploy contract

- **Push to the household repo's `main` = deploy.** The updater fetches within
  2 minutes, builds, tests, health-checks, and flips atomically.
- **Verify via `GET /api/version`** → `{sha, deployedAt}`. Success is a live
  SHA match; anything else, read `~/ld-releases/state/last-result.json`.
- **SSH is for diagnostics only** (journal reads, `systemctl --user restart
  life-dashboard-viewer`, updater state) — never the deploy path.

## Privacy

The template carries zero household data. Calendars, tokens, messages, and
photos live only on the Pi (`~/ld-data/`, gitignored paths) and household
repos stay private.

## Development

```sh
npm ci
npm test        # vitest: app + updater suites
npm run lint    # tsc + eslint
npm run dev     # vite client + server with .env
```

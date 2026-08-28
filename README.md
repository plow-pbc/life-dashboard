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
git clone git@github.com:plow-pbc/life-dashboard.git life-dashboard-<household>
cd life-dashboard-<household>
git remote rename origin template
git remote add origin git@github.com:<you>/life-dashboard-<household>.git
git push -u origin main
```

To pick up template improvements later: `git fetch template && git merge
template/main && git push` (the updater deploys the merge like any other push).

## Bring-up on a fresh Pi

1. Install the toolchain: `/usr/bin/node` ≥ 20.6 (both units and the updater
   hardcode that path; the `--env-file` flag needs 20.6) and Chromium at
   `/usr/bin/chromium` — on Raspberry Pi OS, `sudo apt install nodejs chromium`
   and check `node --version`.
2. Create the household repo (above) and give the Pi read access to it.
3. Seed the updater (`loginctl enable-linger` FIRST — every unit here is a
   `--user` unit that would otherwise die with the login session — then clone
   to `~/ld-releases/bootstrap`, initial `~/ld-current` symlink, `~/ld-data/`,
   deploy-key git auth, enable the timer) — exact commands in
   `updater/README.md` § Bootstrap.
4. Write `~/ld-data/.env` from the keys documented in `.env.example`
   (`ICAL_URL` is required; `DASHBOARD_TOKEN` enables the remote message/photo
   APIs; `PINCH_DATA_FILE` enables the recipe tile). Secrets stay on the Pi —
   they are never in any repo.
5. Install and start the viewer + kiosk units:
   ```sh
   cp life-dashboard-viewer.service life-kiosk-viewer.service ~/.config/systemd/user/
   systemctl --user daemon-reload
   systemctl --user enable --now life-dashboard-viewer life-kiosk-viewer
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

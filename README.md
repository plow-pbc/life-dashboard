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

The end-to-end sequence — fork, keys, Pi, agent, and the prove-the-loop
checklist — is [`docs/runbook.md`](docs/runbook.md); the sections below and
`updater/README.md` own the per-step details it links to.

Each household deploys from its **own copy** of this template. A public
fork is the simplest shape — the Pi then fetches with no credential at all —
and it is safe because the repo holds the *frame*, never the data (see
Privacy below). What public costs is the commit stream: household commits and
diffs are world-readable, so household code and commit messages must stay
free of personal detail (the agent's skill enforces this as a hard rule). A
private clone-push works too, at the price of a read credential for the Pi:

```sh
gh repo create <you>/life-dashboard-<household> --public
git clone https://github.com/plow-pbc/life-dashboard.git life-dashboard-<household>
cd life-dashboard-<household>
git remote rename origin template
git remote add origin https://github.com/<you>/life-dashboard-<household>.git
git push -u origin main
```

To pick up template improvements later: `git fetch template && git merge
template/main && git push` (the updater deploys the merge like any other push).

## Bring-up on a fresh Pi

1. Install the toolchain: `/usr/bin/node` ≥ 20.6 (both units and the updater
   hardcode that path; the `--env-file` flag needs 20.6) and Chromium at
   `/usr/bin/chromium` — on Raspberry Pi OS, `sudo apt install nodejs chromium`
   and check `node --version`.
2. Create the household repo (above). Public: the Pi fetches anonymously —
   nothing to provision. Private: give the Pi a read-only credential
   (`updater/README.md` § Git auth).
3. One-shot install — lingering, `~/ld-data/`, bootstrap release + build,
   all three user units, started (idempotent; `updater/README.md` § Bootstrap
   has the by-hand equivalent, and git auth only matters for a private repo).
   The Pi has no clone yet, so fetch the script by cloning to a scratch path
   and run it from there:
   ```sh
   HOUSEHOLD=https://github.com/<you>/life-dashboard-<household>.git
   SCRATCH=$(mktemp -d)
   git clone --depth 1 "$HOUSEHOLD" "$SCRATCH/repo"
   sh "$SCRATCH/repo/updater/bootstrap.sh" "$HOUSEHOLD"
   rm -rf "$SCRATCH"
   ```
4. Write `~/ld-data/.env` from the keys documented in `.env.example`
   (`ICAL_URL` is required; `DASHBOARD_TOKEN` enables the remote message/photo
   APIs and the off-box `/api/version` verification read;
   `PINCH_DATA_FILE` enables the recipe tile). Secrets stay on the Pi —
   they are never in any repo. Then `systemctl --user restart
   life-dashboard-viewer`.

## The agent's deploy contract

- **Push to the household repo's `main` = deploy.** The updater fetches within
  2 minutes, builds, tests, health-checks, and flips atomically. Every
  git-over-ssh run binds the provisioned credentials explicitly — never the
  default identity or trust state:

  ```sh
  export GIT_SSH_COMMAND='ssh -i <state>/ld-dev/ssh/deploy_key -o IdentitiesOnly=yes \
    -o UserKnownHostsFile=<state>/ld-dev/ssh/known_hosts -o StrictHostKeyChecking=yes'
  ```
- **Verify via `GET /api/version`** with the household bearer
  (`Authorization: Bearer $DASHBOARD_TOKEN` — off-box reads 401 without it)
  → `{sha, deployedAt}`. Success is a live SHA match; anything else, read
  `~/ld-releases/state/last-result.json`.
- **SSH is for diagnosis and repair** (journal reads, `systemctl --user
  restart life-dashboard-viewer`, updater state, fixing live state) — never
  the deploy path: viewer-code changes ride the push, not the shell.

## Privacy

The template carries zero household data. Calendars, tokens, messages, and
photos live only on the Pi (`~/ld-data/`, gitignored paths) — a household
repo, public or private, ships the display's mechanism and nothing personal.

## Development

```sh
npm ci
npm test        # vitest: app + updater suites
npm run lint    # tsc + eslint
npm run dev     # vite client + server with .env
```

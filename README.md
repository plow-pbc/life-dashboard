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

One sudo step (the toolchain), then one script. Two modes, chosen by how the
script is called; in both, the script is idempotent — re-running repairs a
partial install and never clobbers `~/ld-data/`.

### Paired with Plow (no tailnet, no fork)

The Pi tracks this template's `main`, polls its cards from the Plow kiosk
store, and reports its deploy status upstream — it never accepts a connection.
The household's agent mints a pairing code and texts the owner these two
lines, which are the owner's whole contribution:

```sh
sudo apt install -y nodejs npm git chromium fonts-noto-color-emoji
curl -fsSL https://raw.githubusercontent.com/plow-pbc/life-dashboard/main/updater/bootstrap.sh | sh -s -- --pair ABC123
```

`--pair` redeems the code once (`POST $PLOW_API_BASE/v1/kiosks/pair`, default
`https://api.plow.co`; a used or expired code fails loudly) and writes
`~/ld-data/.env` — `KIOSK_REMOTE_URL`, `KIOSK_STATUS_URL`, and
`DASHBOARD_TOKEN` holding the kiosk's read token, mode 600 — then proceeds
exactly as the fork mode below. An `.env` that already holds
`KIOSK_REMOTE_URL` skips the pair. What remote store mode changes about the
viewer and updater's behavior is documented in `.env.example` and
[`docs/app-notes.md` § Configuration](docs/app-notes.md#configuration).

### Household fork (LAN or tailnet producers)

1. Install the toolchain: `/usr/bin/node` ≥ 20.6 (both units and the updater
   hardcode that path; the `--env-file` flag needs 20.6) and Chromium at
   `/usr/bin/chromium` — on Raspberry Pi OS, `sudo apt install nodejs chromium`
   and check `node --version`.
2. Create the household repo (above). Public: the Pi fetches anonymously —
   nothing to provision. Private: give the Pi a read-only credential
   (`updater/README.md` § Git auth).
3. One-shot install — lingering, `~/ld-data/`, bootstrap release + build,
   all three user units, started (`updater/README.md` § Bootstrap has the
   by-hand equivalent, and git auth only matters for a private repo):
   ```sh
   curl -fsSL https://raw.githubusercontent.com/plow-pbc/life-dashboard/main/updater/bootstrap.sh \
     | sh -s -- https://github.com/<you>/life-dashboard-<household>.git
   ```
4. Write `~/ld-data/.env` from the keys documented in `.env.example`
   (`DASHBOARD_TOKEN` enables the remote message/photo APIs and the off-box
   `/api/version` verification read; `PINCH_DATA_FILE` enables the recipe
   tile). Secrets stay on the Pi — they are never in any repo.

### Calendar transport by install mode

The Life agent can push the household calendar feed only when the Pi is in
remote-write mode: `DASHBOARD_TOKEN` is set, `KIOSK_REMOTE_URL` is blank, and
the viewer therefore binds `0.0.0.0`. The agent posts directly to the
bearer-gated `/api/calendar` endpoint.

A paired install always binds loopback, and the Plow kiosk store has no calendar
feed relay. A tokenless local install also binds loopback. Neither can receive a
pushed feed; `ICAL_URL` is their calendar path. Add the owner's private ICS URL
to `~/ld-data/.env` and run `systemctl --user restart life-dashboard-viewer`.
Without a usable pushed feed or reachable ICS fallback, the cards continue to
render and the calendar area shows "Can't reach calendar".

## The agent's deploy contract

- **Push to the household repo's `main` = deploy.** The updater fetches within
  2 minutes, builds, tests, health-checks, and flips atomically. Every
  git-over-ssh run binds the provisioned credentials explicitly — never the
  default identity or trust state:

  ```sh
  export GIT_SSH_COMMAND='ssh -i <state>/ld-dev/ssh/deploy_key -o IdentitiesOnly=yes \
    -o UserKnownHostsFile=<state>/ld-dev/ssh/known_hosts -o StrictHostKeyChecking=yes'
  ```

- **Verify the deploy.** In fork mode, `GET /api/version` with the household
  bearer (`Authorization: Bearer $DASHBOARD_TOKEN` — off-box reads 401
  without it) → `{sha, deployedAt}`; success is a live SHA match. In paired
  mode the Pi binds loopback only, so verification instead reads the
  updater's own report: `GET /v1/kiosks/{uid}` on Plow returns the last
  `KIOSK_STATUS_URL` PUT (`{sha, deployed_at, last_result}`). Either way,
  anything else, read `~/ld-releases/state/last-result.json`.
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

## License

Apache-2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE). Copyright 2026 The Plow Collective, Inc.

Household copies of this template inherit this license.

"Plow" and the Plow logo are trademarks of The Plow Collective, Inc. The license grants no trademark rights.

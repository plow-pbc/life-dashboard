# Pi-side updater

Deploy = a push to the household repo's `main`. Every 2 minutes a systemd
**user** timer (no sudo anywhere) runs `updater.mjs`, which:

1. `git fetch` + `git rev-parse origin/main` in the current release.
2. Exits (`noop` / `skipped-bad-sha`) if the SHA is already live or pinned bad.
3. Clones the repo at that SHA into a fresh release dir, then `npm ci`,
   `npm run build`, `npm test` — any failure stops, unpinned: the next tick
   retries, so a transient registry/network hiccup never wedges deploys.
4. Symlinks the shared household state into the release (see below), boots the
   built server on probe port 5199, and health-checks `/healthz`, `/`,
   `/api/version`.
5. Writes the `version.json` stamp, atomically flips `~/ld-current`
   (symlink create + rename), restarts the viewer unit, and re-checks
   `http://localhost:5174` until `/api/version` reports the new SHA.
6. Any post-flip failure: flips the symlink back to the previous release,
   restarts, and pins the SHA. Success: prunes to the 5 newest releases.

Only a rolled-back SHA — one that reached the wall and failed live — gets
pinned; a pinned SHA is never retried, so push a new commit to deploy again.

## On-disk contract

| Path | Meaning |
| --- | --- |
| `~/ld-current` | Symlink to the live release dir. The viewer unit's `WorkingDirectory`; the updater binary also runs from here. |
| `~/ld-releases/<sha>/` | One immutable checkout + build per deployed SHA (newest 5 kept). |
| `~/ld-releases/state/last-result.json` | What the last run did: `{at, ok, action, sha, detail?}`. First thing to read when diagnosing. |
| `~/ld-releases/state/bad-sha` | One pinned (rolled-back) SHA per line; membership blocks a retry. |
| `<release>/version.json` | Deploy stamp `{sha, deployedAt}` written at flip time; served by `GET /api/version`. |
| `~/ld-data/{.env,data,banners}` | Household state outside the deploy path. The updater symlinks each (when present) into every release, so a flip never loses secrets, messages, or photos. |

## Bootstrap (once per Pi)

The updater runs *from the current release* (`ExecStart` points at
`~/ld-current/updater/updater.mjs`), so a broken push can never brick the
updater — the new copy only takes over after its release passes the health
checks. That needs one manual seed:

```sh
loginctl enable-linger $USER   # FIRST: without lingering, --user units silently stop with the login session
git clone https://github.com/<org>/<household-repo>.git ~/ld-releases/bootstrap
ln -s ~/ld-releases/bootstrap ~/ld-current
mkdir -p ~/ld-data/data ~/ld-data/banners   # plus ~/ld-data/.env (see repo README)
cp updater/life-dashboard-updater.* ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now life-dashboard-updater.timer
```

Git auth: none for a **public** household repo — the timer fetches over
anonymous HTTPS and the clone above is the whole story. For a **private**
one, auth must be in place BEFORE the bootstrap clone, and the origin must be
the SSH URL (an HTTPS origin never consults the SSH key): the fetches run
under systemd with no ssh-agent, so give the Pi a passphrase-less read-only
key pinned **globally** (fresh release clones don't inherit repo-local
config), then clone over SSH —

```sh
git config --global core.sshCommand 'ssh -i ~/.ssh/ld_deploy -o IdentitiesOnly=yes'
git clone git@github.com:<org>/<household-repo>.git ~/ld-releases/bootstrap   # instead of the HTTPS clone above
```

The first timer run replaces `bootstrap` with a real `<sha>` release.

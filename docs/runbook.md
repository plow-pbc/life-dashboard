# Runbook — stand up a household dashboard, end to end

The complete order of operations for one household: a wall kiosk that an AI
agent can improve by pushing code, with no human in the deploy loop. Each step
links to the doc that owns its details; this file owns the *sequence* and the
*why* of the topology.

## The topology (and why it's shaped this way)

```
plow-pbc/life-dashboard              the public TEMPLATE (this repo)
         │  fork (stays public)
         ▼
<you>/life-dashboard-<household>     your household repo, PERSONAL account
     ▲                    │
     │ SSH push over a    │ anonymous HTTPS fetch (timer, ~2 min)
     │ write deploy key   ▼
     │                 Pi updater — builds, health-checks,
     │                 flips atomically, rolls back
  the agent ···· diagnostic/repair SSH ····►  Pi
  (source of the deploy-key push above)
```

- **The household repo is a public fork.** Public makes the Pi's fetches
  credential-free; a fork of a public repo is public by construction. It is
  safe because the repo only ever ships the display's *mechanism* — data
  (calendars, tokens, messages, photos) lives in `~/ld-data/` on the Pi and
  never enters git. The corollary is a hard rule for anyone committing:
  **no personal detail in code, filenames, or commit messages** —
  personalization flows through Pi-side config only.
- **It lives under a personal account, not an org**, because per-repo deploy
  keys are the narrowest write credential GitHub offers and org/enterprise
  policy can ban them; personal accounts allow them. That keeps the agent's
  only GitHub credential scoped to this one repo and revocable in one click.
- **Deploy = `git push` to the fork's `main`.** The Pi pulls on a timer,
  builds, tests, health-checks, flips a symlink atomically, and rolls back a
  release that fails live — so a bad push costs a rollback, never a dark wall.

## 1. Fork the template

Under a **personal** GitHub account:

```sh
gh repo fork <template-owner>/life-dashboard --fork-name life-dashboard-<household> --clone=false
```

## 2. Mint the two agent-side keys

On the machine that hosts the agent, in the agent's own state directory
(shown here as `$AGENT_STATE` — e.g. a container-mounted home), private
halves never displayed:

```sh
mkdir -p "$AGENT_STATE/ld-dev/ssh"
ssh-keygen -t ed25519 -N '' -C 'dashboard deploy'      -f "$AGENT_STATE/ld-dev/ssh/deploy_key"
ssh-keygen -t ed25519 -N '' -C 'dashboard diagnostics' -f "$AGENT_STATE/ld-dev/ssh/pi_key"
chmod 600 "$AGENT_STATE"/ld-dev/ssh/deploy_key "$AGENT_STATE"/ld-dev/ssh/pi_key
printf 'git@github.com:<you>/life-dashboard-<household>.git\n' > "$AGENT_STATE/ld-dev/repo-url"
gh api meta --jq '.ssh_keys[] | "github.com \(.)"' > "$AGENT_STATE/ld-dev/ssh/known_hosts.new" \
  && mv "$AGENT_STATE/ld-dev/ssh/known_hosts.new" "$AGENT_STATE/ld-dev/ssh/known_hosts"
```

The `known_hosts` line pins GitHub's published SSH host keys so every
git-over-ssh run uses `StrictHostKeyChecking=yes` — no trust-on-first-use.

Register the deploy key (write-scoped, this repo only):

```sh
gh repo deploy-key add "$AGENT_STATE/ld-dev/ssh/deploy_key.pub" \
  --repo <you>/life-dashboard-<household> --title 'dashboard agent (write)' --allow-write
```

Authorize the diagnostics key on the Pi (idempotent; the options only block
tunneling/forwarding — **the key deliberately grants a full user-level shell**,
because the agent's mandate includes open-ended diagnosis and repair, and the
guardrail is recoverability, not a command allowlist; scope it down with a
`restrict,command=` forced-command wrapper only if your household wants a
narrower agent):

```sh
PUB=$(cat "$AGENT_STATE/ld-dev/ssh/pi_key.pub")
ssh <pi-user>@<pi> "grep -qF '$PUB' ~/.ssh/authorized_keys || \
  echo 'no-port-forwarding,no-agent-forwarding,no-X11-forwarding $PUB' >> ~/.ssh/authorized_keys"
```

## 3. Bring up the Pi

Owned by [`README.md` § Bring-up on a fresh Pi](../README.md#bring-up-on-a-fresh-pi):
install the toolchain (`/usr/bin/node` ≥ 20.6, Chromium — the one sudo
step), then the one-shot does the rest — lingering, `~/ld-data/`, bootstrap
clone + build of the **household fork**, all three systemd **user** units,
started; idempotent, so re-running repairs a partial install:

```sh
HOUSEHOLD=https://github.com/<you>/life-dashboard-<household>.git
SCRATCH=$(mktemp -d)
git clone --depth 1 "$HOUSEHOLD" "$SCRATCH/repo"
sh "$SCRATCH/repo/updater/bootstrap.sh" "$HOUSEHOLD"
rm -rf "$SCRATCH"
```

Finish by writing `~/ld-data/.env` (`ICAL_URL`, optional — blank leaves the
calendar tile showing its unreachable state; `DASHBOARD_TOKEN` enables
remote card writes *and* the agent's off-box `GET /api/version` verification
read) and restarting the viewer unit. No git credential anywhere (public
fork = anonymous fetch).

## 4. Teach the agent

The contract the agent follows has exactly one owner per rule — this
section is only the map: the deploy contract (push = deploy, live-SHA
verification, SSH scope) is
[`README.md` § The agent's deploy contract](../README.md#the-agents-deploy-contract);
the no-personal-data rule is [`README.md` § Privacy](../README.md#privacy)
plus the fork bullet in the topology section above. A worked example of an
agent skill encoding the whole contract lives in the operator's agent repo.

## 5. Prove the loop end to end

Before calling the install done, run one real deploy through the whole path:

1. From the agent's environment: clone via `repo-url` over the deploy key,
   commit a trivial change, push.
2. Watch the updater take it: within ~2 min the Pi builds, health-checks,
   flips; `GET /api/version` (with the bearer, off-box) reports the pushed
   SHA.
3. Break it on purpose once: push a commit with a failing test and confirm
   the wall never changes (build gate), then a commit that passes tests but
   fails live if you can contrive one — confirm rollback pins it in
   `~/ld-releases/state/bad-sha` and `last-result.json` says why.

A kiosk whose rollback path has never fired is a kiosk whose rollback path
is a hypothesis.

## Failure modes, quickly

| Symptom | First read |
|---|---|
| Push rejected `Permission denied (publickey)` | deploy key missing/revoked — re-register; never substitute another credential |
| `Host key verification failed` | GitHub rotated its SSH host keys (or `known_hosts` is missing) — re-mint it with the atomic `gh api meta` recipe from § 2 (`gh api` writes `.new`, rename only on its success); never weaken host checking |
| Pushed SHA never goes live | `ssh <pi-user>@<pi> 'cat ~/ld-releases/state/last-result.json'` — build failure retries next tick; a rollback pins the SHA until a new push |
| `/api/version` 401 off-box | request lacks the `DASHBOARD_TOKEN` bearer |
| `journalctl --user -u …` shows nothing | Pis often keep no per-user journals — use `journalctl _SYSTEMD_USER_UNIT=life-dashboard-viewer.service` |
| Wall dark, services active | check the kiosk unit's Chromium and `http://localhost:5174/healthz` on the Pi |

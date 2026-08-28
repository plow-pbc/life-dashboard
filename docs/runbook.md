# Runbook — stand up a household dashboard, end to end

The complete order of operations for one household: a wall kiosk that an AI
agent can improve by pushing code, with no human in the deploy loop. Each step
links to the doc that owns its details; this file owns the *sequence* and the
*why* of the topology.

## The topology (and why it's shaped this way)

```
plow-pbc/life-dashboard          the public TEMPLATE (this repo)
        │  fork (stays public)
<you>/life-dashboard-<household> your household repo, under a PERSONAL account
        │                        │
        │ anonymous HTTPS fetch  │ SSH push over a write deploy key
        ▼                        │
   Pi updater  ◄─────────────────┘  the agent (any machine that can reach
   builds, health-checks,           GitHub + the Pi)
   flips atomically, rolls back
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
```

Register the deploy key (write-scoped, this repo only):

```sh
gh repo deploy-key add "$AGENT_STATE/ld-dev/ssh/deploy_key.pub" \
  --repo <you>/life-dashboard-<household> --title 'dashboard agent (write)' --allow-write
```

Authorize the diagnostics key on the Pi (restricted, idempotent):

```sh
PUB=$(cat "$AGENT_STATE/ld-dev/ssh/pi_key.pub")
ssh <pi-user>@<pi> "grep -qF '$PUB' ~/.ssh/authorized_keys || \
  echo 'no-port-forwarding,no-agent-forwarding,no-X11-forwarding $PUB' >> ~/.ssh/authorized_keys"
```

## 3. Bring up the Pi

Owned by [`README.md` § Bring-up on a fresh Pi](../README.md) and
[`updater/README.md` § Bootstrap](../updater/README.md): toolchain
(`/usr/bin/node` ≥ 20.6, Chromium), `loginctl enable-linger`, bootstrap clone
of the **household fork**, `~/ld-data/` with its `.env` (`ICAL_URL`;
`DASHBOARD_TOKEN` enables remote card writes *and* the agent's off-box
`GET /api/version` verification read), viewer + kiosk + updater systemd
**user** units. No sudo beyond package install; no git credential (public
fork = anonymous fetch).

## 4. Teach the agent

The agent needs to know: the workspace path, that `repo-url` + `deploy_key`
are how it clones and pushes (SSH, `GIT_SSH_COMMAND`, accept-new), that
`pi_key` is for diagnostics only — never for deploying by editing files on
the Pi — and the two hard rules: **success is only a live SHA match** on
`GET /api/version` (bearer-authenticated off-box), and **no personal data in
the public repo**. A worked example of this skill lives in the operator's
agent repo; the contract it encodes is this section.

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
| Pushed SHA never goes live | `ssh <pi-user>@<pi> 'cat ~/ld-releases/state/last-result.json'` — build failure retries next tick; a rollback pins the SHA until a new push |
| `/api/version` 401 off-box | request lacks the `DASHBOARD_TOKEN` bearer |
| `journalctl --user -u …` shows nothing | Pis often keep no per-user journals — use `journalctl _SYSTEMD_USER_UNIT=life-dashboard-viewer.service` |
| Wall dark, services active | check the kiosk unit's Chromium and `http://localhost:5174/healthz` on the Pi |

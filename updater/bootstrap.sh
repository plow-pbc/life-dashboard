#!/bin/sh
# One-shot Pi bring-up for the life-dashboard kiosk. Idempotent: re-running
# repairs a partial install and never clobbers existing state or .env.
#
#   sh updater/bootstrap.sh [--pair <code>] [<repo-url>]
#   curl -fsSL https://raw.githubusercontent.com/plow-pbc/life-dashboard/main/updater/bootstrap.sh | sh -s -- --pair ABC123
#
# <repo-url> defaults to the template; a household fork passes its own.
# --pair <code> redeems a Plow kiosk pairing code and writes ~/ld-data/.env
# (KIOSK_REMOTE_URL, KIOSK_STATUS_URL, DASHBOARD_TOKEN) — remote store mode,
# no fork, no inbound connection. An .env already holding KIOSK_REMOTE_URL
# skips the pair. Either way ICAL_URL stays the owner's to add afterwards.
#
# Runs as the kiosk user, no sudo — every unit is systemd --user.
# Prerequisites it CHECKS but does not install (they need apt/sudo):
# /usr/bin/node >= 20.6 and /usr/bin/chromium — README § Bring-up.
# LD_NODE / LD_CHROMIUM override those two paths for the test suite only.
#
# Everything lives in main() so `curl | sh` parses the whole script before
# running a line of it — a child reading stdin can't eat the rest of the file.
set -eu

main() {
  REPO_URL=https://github.com/plow-pbc/life-dashboard
  PAIR_CODE=
  while [ $# -gt 0 ]; do
    case $1 in
      --pair) PAIR_CODE=${2:?--pair needs a code}; shift 2 ;;
      -*) fail "unknown option $1 (usage: bootstrap.sh [--pair <code>] [<repo-url>])" ;;
      *) REPO_URL=$1; shift ;;
    esac
  done
  PLOW_API_BASE=${PLOW_API_BASE:-https://api.plow.co}
  LD_NODE=${LD_NODE:-/usr/bin/node}
  LD_CHROMIUM=${LD_CHROMIUM:-/usr/bin/chromium}

  # -- prerequisites: fail loudly before touching anything ---------------------
  [ -x "$LD_NODE" ] || fail "$LD_NODE missing — sudo apt install nodejs (>= 20.6)"
  node_major=$("$LD_NODE" -e 'console.log(process.versions.node.split(".")[0])')
  node_minor=$("$LD_NODE" -e 'console.log(process.versions.node.split(".")[1])')
  [ "$node_major" -gt 20 ] || { [ "$node_major" -eq 20 ] && [ "$node_minor" -ge 6 ]; } \
    || fail "node $("$LD_NODE" --version) too old — the units need >= 20.6 (--env-file)"
  [ -x "$LD_CHROMIUM" ] || fail "$LD_CHROMIUM missing — sudo apt install chromium"

  # -- household state (never inside a release; survives every flip) -----------
  mkdir -p "$HOME/ld-data/data" "$HOME/ld-data/banners"
  if [ -f "$HOME/ld-data/.env" ]; then
    [ -z "$PAIR_CODE" ] || grep -q '^KIOSK_REMOTE_URL=.' "$HOME/ld-data/.env" \
      || fail "~/ld-data/.env exists without KIOSK_REMOTE_URL — move it aside to pair this Pi"
  elif [ -n "$PAIR_CODE" ]; then
    pair
  else
    printf 'ICAL_URL=\n' > "$HOME/ld-data/.env"
    chmod 600 "$HOME/ld-data/.env"
    echo "bootstrap: wrote empty ~/ld-data/.env — fill in ICAL_URL (see .env.example)"
  fi

  # -- lingering: without it every --user unit dies with the login session -----
  loginctl enable-linger "$USER"

  # -- bootstrap release + the ld-current symlink the units run from -----------
  mkdir -p "$HOME/ld-releases"
  # Two guards compose: rev-parse rejects a broken pre-existing clone (one
  # made outside this script), and the .new-then-rename makes THIS script's
  # clone all-or-nothing — an interrupted run leaves no bootstrap/ at all, so
  # the retry re-clones instead of accepting a half-checkout.
  git -C "$HOME/ld-releases/bootstrap" rev-parse HEAD >/dev/null 2>&1 || {
    rm -rf "$HOME/ld-releases/bootstrap" "$HOME/ld-releases/bootstrap.new"
    git clone "$REPO_URL" "$HOME/ld-releases/bootstrap.new"
    mv "$HOME/ld-releases/bootstrap.new" "$HOME/ld-releases/bootstrap"
  }
  [ -L "$HOME/ld-current" ] || ln -s "$HOME/ld-releases/bootstrap" "$HOME/ld-current"
  [ -d "$HOME/ld-current/" ] || fail "ld-current is a broken symlink — its target release is gone; rm it and re-run"

  # Shared household state into the live release — the updater does this for
  # every release it builds, but the bootstrap release predates the updater,
  # and the viewer unit reads ld-current/.env.
  for name in .env data banners; do
    ln -sfn "$HOME/ld-data/$name" "$HOME/ld-current/$name"
  done

  # The live release must be runnable: the updater binary runs from ld-current,
  # and the viewer serves from its dist/. On a first run that IS the bootstrap
  # clone; on a repair run it is whatever release the updater promoted — build
  # and install units from THERE, never from a stale bootstrap snapshot.
  cd "$HOME/ld-current/"
  npm ci
  npm run build

  # -- units: viewer + kiosk from the release, updater timer from the release --
  mkdir -p "$HOME/.config/systemd/user"
  # Still cwd ~/ld-current: units come from the LIVE release (see above).
  cp life-dashboard-viewer.service life-kiosk-viewer.service \
     updater/life-dashboard-updater.service updater/life-dashboard-updater.timer \
     "$HOME/.config/systemd/user/"
  systemctl --user daemon-reload
  systemctl --user enable --now life-dashboard-viewer life-kiosk-viewer life-dashboard-updater.timer

  echo "bootstrap: done — the first timer run replaces bootstrap with a real <sha> release."
  echo "bootstrap: add ICAL_URL to ~/ld-data/.env when you have it, then: systemctl --user restart life-dashboard-viewer"
}

fail() { echo "bootstrap: $1" >&2; exit 1; }

# Redeem the pairing code (one-shot upstream: a used or expired code is a 410,
# which curl -f turns into a non-zero exit). node writes the file so URL and
# token bytes never pass through shell quoting; mode 600 from the first byte.
pair() {
  case $PAIR_CODE in
    ''|*[!A-Za-z0-9]*) fail "pairing code must be alphanumeric (from the agent)" ;;
  esac
  # `if body=$(...)` (not `body=$(...) || ...`) so `set -e` doesn't exit the
  # script before the failing exit status can be captured into $status.
  if body=$(curl -fsS -X POST -H 'content-type: application/json' \
    -d "{\"code\":\"$PAIR_CODE\"}" "$PLOW_API_BASE/v1/kiosks/pair"); then
    :
  else
    status=$?
    fail "pairing failed (curl exit $status) — a used/expired code, or this Pi cannot reach $PLOW_API_BASE"
  fi
  printf '%s' "$body" | "$LD_NODE" -e '
    const fs = require("fs");
    const r = JSON.parse(fs.readFileSync(0, "utf8"));
    for (const k of ["cards_url", "status_url", "read_token"])
      if (typeof r[k] !== "string" || !r[k] || /[\r\n]/.test(r[k]))
        throw new Error(`pair response has an invalid ${k}`);
    fs.writeFileSync(
      process.argv[1],
      `ICAL_URL=\nKIOSK_REMOTE_URL=${r.cards_url}\nKIOSK_STATUS_URL=${r.status_url}\nDASHBOARD_TOKEN=${r.read_token}\n`,
      { mode: 0o600 },
    );
  ' "$HOME/ld-data/.env"
  echo "bootstrap: paired — wrote ~/ld-data/.env (remote store mode)"
}

main "$@"

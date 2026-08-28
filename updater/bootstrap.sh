#!/bin/sh
# One-shot Pi bring-up for the life-dashboard kiosk. Idempotent: re-running
# repairs a partial install and never clobbers existing state or .env.
#
#   sh updater/bootstrap.sh <household-repo-url>
#
# Run it from any checkout of the household repo (it re-clones its own
# bootstrap copy), as the kiosk user, no sudo — every unit is systemd --user.
# Prerequisites it CHECKS but does not install (they need apt/sudo):
# /usr/bin/node >= 20.6 and /usr/bin/chromium — README § Bring-up step 1.
# After it finishes: write ~/ld-data/.env (ICAL_URL at minimum), then
# `systemctl --user restart life-dashboard-viewer`.
set -eu

REPO_URL=${1:?usage: bootstrap.sh <household-repo-url>}

fail() { echo "bootstrap: $1" >&2; exit 1; }

# -- prerequisites: fail loudly before touching anything -----------------------
[ -x /usr/bin/node ] || fail "/usr/bin/node missing — sudo apt install nodejs (>= 20.6)"
node_major=$(/usr/bin/node -e 'console.log(process.versions.node.split(".")[0])')
node_minor=$(/usr/bin/node -e 'console.log(process.versions.node.split(".")[1])')
[ "$node_major" -gt 20 ] || { [ "$node_major" -eq 20 ] && [ "$node_minor" -ge 6 ]; } \
  || fail "node $(/usr/bin/node --version) too old — the units need >= 20.6 (--env-file)"
[ -x /usr/bin/chromium ] || fail "/usr/bin/chromium missing — sudo apt install chromium"

# -- lingering: without it every --user unit dies with the login session -------
loginctl enable-linger "$USER"

# -- household state (never inside a release; survives every flip) -------------
mkdir -p "$HOME/ld-data/data" "$HOME/ld-data/banners"
[ -f "$HOME/ld-data/.env" ] || {
  printf 'ICAL_URL=\n' > "$HOME/ld-data/.env"
  chmod 600 "$HOME/ld-data/.env"
  echo "bootstrap: wrote empty ~/ld-data/.env — fill in ICAL_URL (see .env.example)"
}

# -- bootstrap release + the ld-current symlink the units run from -------------
mkdir -p "$HOME/ld-releases"
if [ ! -d "$HOME/ld-releases/bootstrap/.git" ]; then
  rm -rf "$HOME/ld-releases/bootstrap"
  git clone "$REPO_URL" "$HOME/ld-releases/bootstrap"
fi
[ -L "$HOME/ld-current" ] || ln -s "$HOME/ld-releases/bootstrap" "$HOME/ld-current"

# The bootstrap release must be runnable: the updater binary runs from
# ld-current, and the viewer serves from its dist/.
cd "$HOME/ld-releases/bootstrap"
npm ci
npm run build

# -- units: viewer + kiosk from the release, updater timer from the release ----
mkdir -p "$HOME/.config/systemd/user"
cp life-dashboard-viewer.service life-kiosk-viewer.service \
   updater/life-dashboard-updater.service updater/life-dashboard-updater.timer \
   "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --now life-dashboard-viewer life-kiosk-viewer life-dashboard-updater.timer

echo "bootstrap: done — the first timer run replaces bootstrap with a real <sha> release."
echo "bootstrap: fill ~/ld-data/.env, then: systemctl --user restart life-dashboard-viewer"

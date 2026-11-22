# Review instructions — life-dashboard

## Cause-first bug fixes

Fix a bug at its cause so the class can't recur. Never fix it with a layer, guard, link, workaround or hand-edit of data around it. A fix that adds net complexity must state why in the PR. When the bug comes from a duplicated source or identity, remove the duplicate rather than bridging the two.

Repo-specific reviewer policy. The universal review policy is prepended by the
reviewer and is not restated here.

## What this repo is

Template for a household wall kiosk: a React/Vite calendar-and-cards dashboard
served by `server.js` on a Raspberry Pi, plus the Pi-side `updater/` that turns
a git push into a health-checked, auto-rolling-back deploy. Households deploy
from their own (often public) copy; agents post cards over the protocol in
`docs/kiosk-protocol.md`.

**Stage:** user-facing. Runs on household walls.

## Review bar

Report **Critical** and **Important** findings only. Nits and style go
unmentioned.

- **No security against coworkers.** Everyone with push access, and our own
  agents, are trusted. Don't propose guards against them.
- **Simplest code wins.** Shorter is better when it does the same thing.

## Where the real risks are

- **Privacy.** The repo holds the frame, never the data, and copies are often
  public. Flag personal detail in code, fixtures, or docs.
- **Protocol drift.** `docs/kiosk-protocol.md` is canonical for producers; flag
  a server change that breaks it without updating it.
- **Bricked kiosk.** Flag an updater change that weakens the health check or
  rollback, since a bad deploy otherwise leaves a dark screen.

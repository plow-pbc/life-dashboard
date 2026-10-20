# Meal-planning agent — design scope

Status: proposal (read-only study, nothing built)
Date: 2026-10-15

The owner floated "an agent that can manage this for us" for meal planning. This
doc scopes what that agent would actually do, how it should relate to Lifey and
Pinch, what data and APIs it needs, and a phased recommendation with the open
questions the owner must answer first.

## What exists today (and what it doesn't)

Three pieces already stand, and the gap between them is exactly where a
meal-planning agent would live.

**Pinch** (`~/Hacking/Pinch`) is a full recipe app for the kiosk: a photo-forward
library, recipe detail, a cooking mode (tap-to-start timers + wake lock), and
aisle-sorted grocery lists. Its data model is rich (`src/types.ts`): a `Recipe`
carries ingredients, derived `ingredientLines`, `steps`, pre-computed
`timerLabels`, times, servings, rating, and `lastCookedAt`; a `GroceryItem`
carries a parsed quantity/unit, an `aisle`, a `checked` flag, and the `recipeId`
it came from. Pinch owns a Hono server with a single-JSON-file store and these
routes: `GET /api/pinch/collection`, `PUT /api/pinch/groceries`,
`POST /api/pinch/recipes/:id/cooked`, and the Bearer-gated `PUT /api/pinch/recipes`
(sync job only). A server-side **Paprika sync** pulls recipes one way from a
Paprika account, hash-skips unchanged recipes, downloads photos, and labels
timers/aisles with an LLM (Anthropic Haiku or OpenAI) at sync time. The grocery
list is built **in-app**, not imported from Paprika.

**The kiosk's Cook Tonight tile** (`plow-life-dashboard/src/pinch.ts`,
`src/components/CookTonight.tsx`, `src/server/pinch/`) is deliberately **not**
the full Pinch app. It is a stripped-down, read-only snapshot: a smaller `Recipe`
type (`id`, `title`, `photoUrl`, `lastCookedAt` only), its own minimal
`/api/pinch/*` read routes (`store.js` reads, never writes), and a tile that
`pickTonight()` fills with the most-recently-cooked recipe, else anything in the
library. It is display-only by design: no cooking mode, no grocery list, no
detail, no write path. Its data comes from `PINCH_DATA_FILE`, a JSON file written
by a **separate out-of-process `pinch-sync`** that is not versioned in this repo;
the contract is only that the sync emits `photoUrl` as exactly
`/api/pinch/photos/<id>`.

**Lifey** (`~/Hacking/plow-dev/plow-lifey-agent`) is the OpenClaw household agent.
It reaches the owner by text, runs skills (`morning-brief`, `wall`,
`google-workspace`, `onboarding`), schedules recurring work with the native
`automations` tool (cron `agentTurn` jobs, e.g. the 7am brief), and posts kiosk
cards through a **two-hop Latch relay**: write the card's wire JSON to the owner's
Mac, then `curl` it to the Pi's `/api/message` with a bearer the Mac holds
(`skills/wall/scripts/kiosk_card.py`). Cards are self-contained HTML fragments the
producer styles; the viewer renders them verbatim.

**The gap:** everything today is *display and capture*. Recipes flow Paprika →
sync → Pinch/kiosk, and a human decides what to cook, what to buy, and when. No
component **plans**, **decides**, or **writes back** a plan. That planning layer
is the entire value of a "meal-planning agent."

## What a meal-planning agent would actually DO

Ranked by value over what Pinch→Cook Tonight already does. Each is a thing a
human does by hand today.

1. **Choose what to cook tonight (with intent).** Today the tile shows the
   most-recently-cooked recipe — a backward-looking default, not a decision. The
   agent would pick *forward*: rotate variety, respect what's already on the
   calendar tonight (a late meeting → something fast), avoid repeating last
   night, honor the household's stated preferences. This is the smallest change
   that turns a passive tile into "an agent managing it."
2. **Plan the week's meals.** Propose a 5–7 night plan from the library, balanced
   for effort and variety, pinned to the family calendar (busy nights get quick
   meals; a free Sunday gets the ambitious one). Delivered as a text the owner
   can approve or tweak, then surfaced on the wall.
3. **Generate a grocery list from the plan.** Roll the planned recipes'
   ingredients into one aisle-sorted shopping list — exactly the shape Pinch's
   `GroceryItem`/`Aisle`/`PUT /api/pinch/groceries` already models. This is the
   highest-leverage write because it saves a weekly chore and the data model is
   already there.
4. **Capture recipes by text.** Owner texts "add grandma's chili" with a photo or
   a URL; the agent parses it into the recipe model and files it. Note the
   current flow is Paprika → one-way sync; a text-capture path either writes to
   Paprika (so the sync stays the single source of truth) or is a new write path
   that must not fight the sync. This is a source-of-truth decision, not just a
   feature (see open questions).
5. **Tie meals to the family calendar.** The agent already has calendar access
   via Lifey's `google-workspace`/`morning-brief` plumbing. Meal planning is one
   of the few places reading *and writing* the calendar (put "Dinner: sheet-pan
   chicken" on the right night) adds real value.
6. **Suggest by season / what's on hand.** The most "agentic" sounding, the least
   grounded: the household has no pantry-inventory data today, so "what's on hand"
   would require the owner to maintain an inventory (friction) or the agent to
   guess (low trust). Seasonality is cheap (date + region); on-hand is a Phase 3+
   idea at best. Recommend deferring.

## How it should relate to Lifey

**Recommendation: a Lifey skill, not a separate agent.** Meal planning is the
same shape of work Lifey already does: read the household's data (calendar,
preferences), think, deliver one warm text, optionally post a wall card on a
schedule. A separate agent would duplicate Lifey's calendar access, its Latch
relay to the Pi, its `automations` scheduling, its voice, and its household
config — and then have to stay in sync with all of it. Everything the planner
needs, Lifey already has wired. Precedent: `morning-brief` is exactly this
pattern (scheduled `automations` job → gather → rank → one text → optional wall
card).

**How the skill reads/writes Pinch's data.** This is the crux, because the kiosk
and Pinch are two different surfaces over the same recipes:

- **Read recipes:** the full library lives in Pinch's store (rich model) and a
  thin snapshot feeds the kiosk. The planner needs the *rich* model
  (ingredients, times, categories) to plan and build a grocery list, so it should
  read Pinch's `GET /api/pinch/collection`, not the kiosk's stripped snapshot.
- **Write the grocery list:** Pinch already exposes `PUT /api/pinch/groceries`
  with the exact `GroceryItem`/`Aisle` model. The planner composes the list and
  PUTs it. (The kiosk's routes are read-only and intentionally cannot do this —
  so the write target is the Pinch server, reached the same way Lifey reaches the
  Pi today: the Latch two-hop relay, or a direct call if the planner runs where
  Pinch's server is reachable.)
- **Write "cook this tonight":** the kiosk tile today derives tonight from
  `lastCookedAt`. To let the agent *choose* tonight, the cleanest path is a small
  new field the snapshot honors (e.g. a `plannedForDate` or an explicit
  "tonight" pointer) rather than overloading `lastCookedAt` (which `pinch.ts`
  correctly treats as cooking history). That is a small, additive contract change
  to the kiosk snapshot + `pickTonight()` — flag it as a required dependency, not
  a given.
- **Deliver the plan:** as a Lifey text (approve/tweak) and, once approved, a wall
  card via the existing `kiosk_card.py` relay — a new card type (`meals` /
  `dinner-plan`) rendered as its own HTML fragment, no viewer change needed.

So: **one new Lifey skill (`meal-plan`)**, reading Pinch's full collection,
writing groceries via Pinch's existing PUT, delivering via text + a new wall card,
scheduled by `automations`. No new agent, no new server.

## Data and APIs it needs

| Need | Source today | Status |
|---|---|---|
| Rich recipe library (ingredients, steps, times, categories, `lastCookedAt`) | Pinch `GET /api/pinch/collection` | Exists |
| Write grocery list (aisle-sorted) | Pinch `PUT /api/pinch/groceries` + `GroceryItem`/`Aisle` model | Exists |
| Family calendar (read: busy nights; write: dinner events) | Lifey `google-workspace` / `plow-gog` | Read exists; write needs confirming |
| Household preferences (dislikes, rotation, diets) | Lifey household config (`onboarding/scripts/household.py`) | Needs a `meal_prefs` block added |
| Post the plan to the wall | `kiosk_card.py` Latch relay + a new card type | Relay exists; card type is new |
| Tell the kiosk what to cook tonight | kiosk snapshot + `pickTonight()` | Needs a small additive field |
| Capture a recipe from text | — | New; depends on the source-of-truth decision (Paprika vs. direct Pinch write) |
| Reach Pinch's server to write | Latch two-hop relay (as with the Pi today) | Reuse Lifey's existing mechanism |

The agent brings LLM reasoning (ranking, parsing a texted recipe) — Pinch already
proves the pattern with its sync-time Haiku labelers, so the household is
comfortable with LLM-in-the-loop on recipe data.

## Recommended scope and phasing

Smallest valuable first step first; each phase is shippable and earns the next.

- **Phase 1 — Pick tonight with intent (smallest valuable).** A `meal-plan` Lifey
  skill that, on a daily `automations` job, reads Pinch's collection + today's
  calendar + household prefs and chooses *one* dinner, delivered as a warm text
  and (once the additive snapshot field exists) reflected in the Cook Tonight
  tile. No weekly plan, no grocery write yet. This alone converts the passive
  tile into "an agent managing it" and reuses `morning-brief`'s exact shape.
- **Phase 2 — Weekly plan + grocery list.** Extend the skill to propose a 5–7
  night plan (approve/tweak by text), post it to the wall as a new card, and PUT
  the rolled-up aisle-sorted grocery list to Pinch. This is the chore-saving
  payoff and leans entirely on data models that already exist.
- **Phase 3 — Capture recipes by text + calendar write-back.** Let the owner text
  a recipe (resolve the Paprika-vs-direct source-of-truth question first), and
  write dinner events onto the family calendar. Season-aware suggestions can ride
  along cheaply here.
- **Defer:** "what's on hand" / pantry inventory — no data source today and high
  friction to create one.

## Open questions the owner must answer

1. **Source of truth for recipes.** Paprika is the one-way origin today. Should
   texted/agent-captured recipes write back into Paprika (keeping the existing
   sync as the single pipeline), or get a new direct-to-Pinch write path (faster,
   but now two writers and a reconciliation problem)? This gates Phase 3 and
   shapes Phase 1–2's assumptions.
2. **Who decides vs. who approves?** Should the agent *auto-set* tonight's dinner
   and auto-build the grocery list, or always propose-and-wait for a text
   approval? (Affects trust, and whether the kiosk shows a decided or a proposed
   meal.)
3. **May the agent write the family calendar?** Reading busy nights is safe;
   adding "Dinner: …" events is a different trust level. In or out?
4. **Where does the grocery list live for the shopper?** Pinch's in-kiosk list is
   on the wall. Does the owner want it pushed somewhere they'll have at the store
   (a text, a phone), or is the kiosk list enough?
5. **Is the Cook Tonight tile allowed a small contract change?** Letting the agent
   *choose* tonight needs an additive field in the kiosk snapshot + `pickTonight()`
   beyond today's `lastCookedAt` heuristic. Acceptable?
6. **How does the planner reach Pinch's server to write?** Confirm it reuses
   Lifey's existing Latch two-hop relay to the household box (as the wall does),
   and confirm Pinch's server is reachable the same way the Pi is.
7. **Where do meal preferences live?** Propose a `meal_prefs` block in the Lifey
   household config (dislikes, rotation cadence, diets, serving count). Confirm,
   and decide whether onboarding should ask for them.

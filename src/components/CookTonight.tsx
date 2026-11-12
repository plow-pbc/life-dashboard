import { useState } from 'react';
import { isLocalPhotoUrl, isMenuStale, pickTonight, type Collection } from '../pinch';
import { formatDuration, parseMinutes, type Minutes } from '../home/widgetData';
import { hashForTab } from '../nav';

// The recipe tile: one recipe from the synced Pinch library, photo-first, with
// when it's on and its prep/cook times.
// Tapping it switches to the MEALS TAB and opens THIS recipe's detail inside the Pinch
// embed, one time — staying in the shell (the nav stays, tap Home to return); the user
// taps Cook in Pinch to start. onOpenRecipe stashes the recipe id as an in-memory
// one-shot (App), so the deep-link never enters the URL: the next ~5-min kiosk reload
// lands on the base embed (Change 1 preserved). The href="#meals" is the semantic/
// fallback nav; onOpenRecipe both records the recipe and drives the tab switch.
// Pinch matches the id case-insensitively, so the UPPERCASE collection id works —
// no need to call /plan/today.
//
// This slot is a CONFIGURABLE WIDGET slot. When no recipe is configured it shows
// a designed invite placeholder (see WidgetSlotPlaceholder below), in the spirit
// of the empty-<Banner/> state — not an empty cell. A later Lifey flow will let
// the user pick which widget lives here; for now the recipe is the one widget and
// the placeholder is the "open slot" invite. See the .rc / .widget-ph blocks in
// index.css for the layout.
//
// The library comes from Home (useCollection), which also uses it to decide
// whether tonight's dinner holds the hero. `settled` gates the invite
// placeholder so it only appears once the slot is CONFIRMED empty — never
// flashing during the initial load before a real recipe arrives.
export function CookTonight({
  onOpenRecipe,
  now,
  collection,
  settled,
}: {
  onOpenRecipe: (recipeId: string) => void;
  now: Date;
  collection: Collection | null;
  settled: boolean;
}) {
  // When the library is stale (a failed hourly sync — e.g. an expired recipe
  // token), the tile dates the menu instead of presenting frozen data as
  // tonight's plan.
  const generatedAt = collection?.generatedAt ?? null;
  // A recipe can carry a photoUrl whose bytes aren't cached yet — the library
  // outruns the photo download. Routine, so fall back to the neutral
  // placeholder rather than letting the browser paint a broken-image glyph on
  // a wall display.
  const [photoFailed, setPhotoFailed] = useState(false);

  const pick = collection ? pickTonight(collection, now) : null;

  // No recipe: show the invite once we've confirmed the slot is empty; stay blank
  // (null) while the fetch is still in flight.
  if (!pick) return settled ? <WidgetSlotPlaceholder /> : null;

  // When the library is stale, the label becomes a dated "Menu from Oct 21"
  // instead of "Tonight"/"Recently cooked" — the whole point is to stop
  // presenting a frozen library as tonight's plan. Fresh data keeps pick.meta.
  const stale = isMenuStale(generatedAt, now);
  const when =
    stale && generatedAt
      ? `Menu from ${new Date(generatedAt).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        })}`
      : pick.meta;

  const times: { label: string; min: Minutes }[] = [];
  for (const [label, text] of [
    ['Prep', pick.recipe.prepTime],
    ['Cook', pick.recipe.cookTime],
  ] as const) {
    const min = parseMinutes(text);
    if (min !== null) times.push({ label, min });
  }

  // Photo-first: the photo fills the tile and the text sits over it on a scrim.
  // No steps, ingredients or buttons — the whole tile is the tap target.
  // onOpenRecipe records this recipe's id as the Meals one-shot AND the
  // href="#meals" switches the tab, so the Meals pane opens the recipe once. The
  // id is in memory only (never the URL), so the next reload lands on the base
  // embed.
  return (
    <a
      className="rc"
      href={hashForTab('meals')}
      onClick={() => onOpenRecipe(pick.recipe.id)}
      aria-label={`${when}: open ${pick.recipe.title} in Meals`}
    >
      {isLocalPhotoUrl(pick.recipe.photoUrl) && !photoFailed ? (
        <img
          className="rc-photo"
          src={pick.recipe.photoUrl}
          alt=""
          onError={() => setPhotoFailed(true)}
        />
      ) : (
        <div className="rc-photo rc-photo--none" />
      )}
      <div className="rc-scrim" />
      <div className="rc-body">
        {/* WHEN this recipe is on: "Tonight" for a pin or meal-plan pick, else
            why it's shown ("Recently opened"…), so a fallback is never labelled
            as tonight's plan. */}
        <span className="rc-when">{when}</span>
        <h2 className="rc-title">{pick.recipe.title}</h2>
        {times.length > 0 && (
          <div className="rc-times">
            {times.map(({ label, min }) => {
              const d = formatDuration(min);
              return (
                <div className="rc-time" key={label}>
                  <span className="rc-time-n">
                    {d.value}
                    <small>{d.unit}</small>
                  </span>
                  <span className="rc-time-l">{label}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </a>
  );
}

// The designed empty state for this widget slot: a soft clay wash + a small
// icon + a warm, human invite to set a widget up here via Plow. Same spirit as
// the empty-<Banner/> placeholder, tuned to this slot's clay accent.
function WidgetSlotPlaceholder() {
  return (
    <section className="widget-ph" aria-label="Open widget slot">
      <svg className="widget-ph__icon" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <path d="M12 8.5v7M8.5 12h7" />
      </svg>
      <p className="widget-ph__lead">This spot's open.</p>
      <p className="widget-ph__sub">Ask Hive to add a widget here.</p>
    </section>
  );
}

# DEADSTOP — design canon

> Time only breathes when you do.

DEADSTOP is a single-screen, ink-on-paper stick-figure roguelike gunfight for
RUN.world.
The world clock is bound to the player's own motion: stand still and bullets
hang in the air like pins on a corkboard; move, aim, or fire and the whole
firefight surges forward. Every level is a lattice of frozen lead you thread on
foot, and every gun you carry has a hard round count — when it runs dry the gun
itself becomes the last thing you can throw.

This file is canon for content and numbers. Code follows this document; when
they disagree, fix the code or update this file in the same change.

## 1. Pillars

1. **The clock is the controller.** Time is not a resource bar; it is a direct
   readout of the player's own agency. Standing still must always be legible,
   never punished by an invisible timer.
2. **One hit ends you.** Both sides die fast. Reading a frozen bullet lattice
   and stepping through it is the entire skill.
3. **Guns are ammunition, not loadout.** You never "own" a weapon. You hold
   what you took off the last body, and you count rounds out loud.
4. **The page is the world.** Everything is drawn as if inked by hand on a
   ledger page: living wobble, dry-brush texture, no gradients, no glow.

## 2. The Standstill clock

`timeScale` is recomputed every frame from player agency and then smoothed.

| Source | Contribution |
| --- | --- |
| Movement | `0..1` proportional to stick/key magnitude |
| Aim rotation | up to `0.35`, from angular velocity of the aim vector |
| Firing | pulse of `1.0` held for `0.14` real seconds |
| Throwing a gun | pulse of `1.0` held for `0.20` real seconds |
| Floor (never fully frozen) | `0.045` |
| A genuinely clear page | `1.0` |

Smoothing is asymmetric: attack `18/s`, release `6/s`. Rising to speed is
instant enough to feel like agency; falling back to standstill has a visible
glide so the player can watch the world settle.

**A clear page runs at normal speed.** The clock is a readout of danger, not a
punishment for standing still: with every hostile down and nothing queued behind
them there is nothing to read and nothing to dodge, so crawling to the reward
gun is only a wait. Queued spawns still count as occupied — a group walking in
is the tensest beat the game has, and treating the gap between waves as empty
would also open the clock on the first frame of every run, before the opening
group has been placed.

Everything simulated multiplies its delta by `timeScale` **except** the
player's own movement, aim, and **rate of fire**, which always run in real time.
That asymmetry is the contract; nothing may violate it.

The trigger belongs on the player's side of that line. Draining the weapon
cooldown on the world clock throttled the rate of fire by exactly the factor the
world was slowed, so standing still — the game's entire reading stance — cost
`4.83s` between rifle shots, `9.00s` between shotgun shells, and `21.62s`
between launcher rounds. Each shot still pulses the clock, so sustained fire
moves the page and the trade is preserved; only the punishment is gone.

Reduced motion does not change the clock — it only removes decorative shake,
boil, and particle churn.

## 3. The page

- World is a fixed `1280 x 720` page. The whole arena is always on screen; the
  camera never scrolls, it only fits and breathes (a small push-in on kills).
- Every level draws one of six **floor plans**, chosen deterministically from
  the run seed. Blocks stop bullets and bodies; rockets detonate on them.

| Archetype | Shape |
| --- | --- |
| `open` | Two desks, long sight lines. Always the first page of a run. |
| `pillars` | Six fluted pillars in a loose grid. |
| `corridor` | Four long desks cutting the page into lanes. |
| `bunker` | Two crates back to back in the middle, two drums in the corners. |
| `gauntlet` | Three staggered vertical walls. |
| `scatter` | Three to five mixed crates, desks, pillars, and drums. |

No plan may ever wall in the spawn point, and enemies walk around cover rather
than pressing into it.

## 4. Player

| Property | Value |
| --- | --- |
| Move speed | `126` u/s (real time), before QUICK FEET |
| Radius | `13` |
| Health | 1 — any bullet, blast, or rusher contact is lethal, unless SECOND SKIN soaks it |
| Aim | mouse position (desktop) or the right-thumb aim stick (touch, assisted) |
| Fire | left click, the FIRE button, or a quick tap in the aim zone |
| Throw | Automatic — a gun that runs dry is thrown along the same aim |
| Pickup | walk over a dropped gun; auto-equips when empty-handed, otherwise `E`/tap swaps |

Being unarmed is a real state: you cannot punch, you can only run and pick up.

## 5. Weapons

| id | Name | Rounds | Cadence (rpm) | Pellets | Speed | Damage | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `pistol` | PISTOL | 7 | 260 | 1 | 620 | 1 | Starter, tight |
| `smg` | SMG | 26 | 700 | 1 | 640 | 1 | `0.055` rad spread |
| `shotgun` | SHOTGUN | 6 | 95 | 6 | 560 | 1 | `0.20` rad cone, heavy knock |
| `rifle` | RIFLE | 8 | 135 | 1 | 1150 | 1 | Pierces 2 bodies |
| `launcher` | LAUNCHER | 3 | 50 | 1 | 330 | 1 | `104` blast, detonates on cover |

Every shot is lethal to any body it touches except the TANK, which soaks 3.
Damage numbers exist only so the tank has a shape; there is no health economy.

**Thrown guns.** A dry gun is thrown by a fresh pull of the trigger: a spinning
body that kills on contact for the game's highest style multiplier (`x3`), then
falls out of play.

**Holding the trigger is one act of shooting, start to finish.** It empties the
gun and stops there. The round that runs the magazine out must never also fling
the frame, because the player never asked for that — they were still holding the
same button they started shooting with. Release, press again, and the gun goes.

That edge is also what separates the two acts on screen. Earlier attempts used a
timer, first in real seconds and then in world seconds, and both were wrong. A
wall-clock delay fired while the last round was still hanging in the air, so the
gun launched alongside it down the same line; moving the timer onto the world
clock widened the gap but still threw a gun the player had not asked to throw.
No timer can tell a deliberate throw from a held button. The release can.

A dry gun never traps the player: walking over any loaded drop always swaps,
whatever is in hand.

**Throwing has no verb.** There is no `F`, no right click, and no THROW button.
Those existed only so an empty gun was not dead weight, which made "an empty gun
is still a weapon" a rule the player had to be *told* through a control nothing
else in the game used — and on touch it cost a permanent thumb-sized button for
an action taken a handful of times a run.

Two consequences, both accepted deliberately:

- **A loaded gun can no longer be thrown.** Sacrificing a full magazine for the
  `x3` was previously the flashiest play in the game; it is gone. Thrown kills
  still score `x3`, they just always come from a spent frame.
- **The throw goes wherever the last shot went.** It cannot be aimed
  independently, because it leaves on the same trigger pull.

A spent frame does not land as a pickup. Guns are only thrown when empty, so it
would be a `0`-round trap whose only use is re-arming the throw — enemy drops
are filtered on the same rule.

**Level rewards.** Clearing a level places a fresh gun at the player's feet:

`1 → SMG`, `2 → SHOTGUN`, `3 → RIFLE`, `4 → LAUNCHER`, then the ladder repeats
from SMG with a `+2` round bonus per completed cycle.

## 6. Enemies

| id | Name | Speed | Soak | Weapon | Behaviour |
| --- | --- | --- | --- | --- | --- |
| `rusher` | RUSHER | 168 | 1 | none | Sprints the shortest path, walking around cover; contact kills. Drops nothing. |
| `grunt` | GRUNT | 78 | 1 | pistol | Holds `260` range, strafes, fires 3-round bursts. Present on every level as the guaranteed source of fresh rounds. |
| `tank` | TANK | 52 | 3 | shotgun | Walks straight in, fires a cone inside `180`. Flinches on hit. |
| `sniper` | SNIPER | 0 | 1 | rifle | Anchored at `480`. Charges a lock for `1.4..1.7s`, then fires a piercing round. |
| `rocketeer` | ROCKETEER | 62 | 2 | launcher | Level 9+. Slow lob from `340` with a `104` blast. |

Every armed enemy draws a **sight line**: a thin ink ray along its aim that
inks in solid and thickens as its shot charges. The lattice of sight lines plus
frozen rounds is the puzzle the player reads while standing still.

Enemies obey `timeScale`. Their reaction times are generous by design: they
acquire in `0.5..1.7` world-seconds depending on family, so a moving player is always the one
spending the clock.

## 7. Levels, acts, and twists

A run is a ladder of procedural levels. Level `N` composition:

```
creep(P)  = floor(max(0, N - 12) / P)
rushers   = 1 + floor(N * 0.6) + creep(9)    capped 13
grunts    = 1 + floor(N / 2)   + creep(14)   capped 9   (always at least one)
tanks     = (N >= 4) ? floor((N-1)/4)  + creep(22) capped 4
snipers   = (N >= 6) ? floor((N-2)/5)  + creep(18) capped 3
rocketeer = (N >= 9) ? floor((N-4)/6)  + creep(26) capped 3
```

The curve never slides backwards. Enemy families are gated so each one gets a
clean introduction: TANK at 4, SNIPER at 6, ROCKETEER at 9. A page is then
trimmed to `ROSTER_HARD_CAP = 30` bodies by `capComposition`, shedding rushers
first and never the last grunt. Both the roster the core builds and the count
the HUD and the sim read go through that same function, so a trimmed page can
never report a size it does not field.

**The run is endless, so the curve is too.** Body counts saturate on purpose —
the arena is one screen and the frame budget is finite. Past that point the page
stops getting harder by fielding *more* bodies and starts fielding *better*
ones:

```
pressure(N) = N <= 12 ? 1 : 1 + log2(1 + (N - 12) / 6) * 0.34
```

Pressure grows without bound but logarithmically, so level 40 is meaningfully
worse than level 20 and level 4000 is still a fight rather than an instant loss.
Every stat that reads it clamps its own share, so no single dimension runs away:

| Stat | Reads | Clamp |
| --- | --- | --- |
| Enemy speed | `× pressure` | `1.4` |
| Acquire time | `÷ pressure` | `1.85` |
| Burst cadence | `÷ pressure` | `1.7` |
| Soak per body | `+ floor((pressure-1) / 0.62)` | `+3` |

Pressure sets the ambition; the clamps keep it fair. Level 16 and level 100 used
to be the identical fight — `simulate.ts` now sweeps to level 2000 and asserts
pressure is monotonic, finite, unbounded, and clamped at every step.

**Acts and elites.** Every five levels is an act. Every fifth level is an
**elite page**: one extra body from the heaviest available family, a guaranteed
twist, and double the clear bonus.

**Twists.** From level 3, a level may be stamped with one modifier. Elite pages
always carry one.

| Twist | From | Effect |
| --- | --- | --- |
| `CROWDED` | 3 | Three more rushers. |
| `BARE PAGE` | 3 | No cover at all. |
| `DIM LIGHT` | 4 | Sight lines stay hidden until the shot locks. |
| `SCARCE` | 4 | You start the page with half your rounds. |
| `HAIR TRIGGER` | 5 | Enemies acquire 40% faster. |
| `MARKSMEN` | 6 | One extra sniper. |
| `HEAVY` | 7 | One extra tank. |
| `SWARM` | 8 | Five more rushers, and almost nothing else. |

Spawns arrive in `2..3` staggered groups so a level has a rhythm rather than a
single dump. Clearing every body ends the level.

**Interlude.** `1.6s` of held breath: the page settles, the level banner strikes
through, the reward gun is inked in at the player's feet. Input stays live.

**Draft.** After the interlude the run stops on a three-card draft. One pick,
no going back, and it stays for the rest of the run. Keys `1`, `2`, `3` work.

**The draft outlives the board.** There are only 26 booster stacks in the game,
so a run deep enough takes them all — and it must not lose its between-page
choice exactly where the endless run begins. Once every booster is maxed the
draft deals **loadout** instead: three guns, fully loaded, DEEP POCKETS applied.
That choice only matters more as pressure adds soak to every body. The draft is
never skipped; a `DraftOffer` is a discriminated union of `booster | weapon`, so
the compiler forces every surface to handle both.

## 7b. Boosters

Fourteen boosters, each stacking one to three times. Every one is drafted for
free between levels; ten of them can also be bought with ink before a run.

| Booster | Stacks | Ink | Effect |
| --- | --- | --- | --- |
| STEADY HAND | 2 | 90 | Spread halved per stack |
| QUICK FEET | 3 | 100 | `+14%` move speed per stack |
| LONG BARREL | 2 | 100 | `+30%` round speed per stack |
| WIDE STEP | 1 | 80 | `1.6x` pickup reach, and swap while loaded |
| DEEP POCKETS | 3 | 110 | `+3` rounds on every gun you lift |
| SCAVENGER | 2 | 110 | Bodies drop guns half full again |
| HEAVY THROW | 2 | 120 | A thrown gun goes through one more body |
| COLD START | 2 | 130 | `+0.55s` enemy acquire for the first `5s` of a page |
| LONG BREATH | 2 | 140 | Time floor drops `0.014` per stack, min `0.015` |
| TWIN TAP | 1 | 150 | The first shot out of a standstill fires twice |
| PAPER CUT | 1 | 150 | Every graze loads a round |
| RICOCHET | 2 | 160 | Your rounds bounce off cover once per stack |
| DEAD EYE | 1 | 170 | A kill made while still refunds the round |
| SECOND SKIN | 2 | 220 | Soak one lethal hit per page, per stack |

The kit carries **two** boosters into a run. Ink is spent at the moment the run
starts, never before.

## 8. Scoring

| Event | Points |
| --- | --- |
| RUSHER down | 100 |
| GRUNT down | 150 |
| TANK down | 300 |
| SNIPER down | 350 |
| ROCKETEER down | 400 |
| Level clear | `250 x level`, doubled on an elite page |
| Rounds unspent at level clear | `15` each |
| Graze (round passes within `30` while time is under `0.35`) | 25, once per round |

**Style multipliers** (multiplicative, applied to the kill):

- Thrown-gun kill: `x3`
- **Headshot: `x2.5`** — a round through the drawn head
- Kill while `timeScale < 0.2`: `x1.5` (STILL)
- Blast kill beyond the first in one detonation: `x2`
- Point blank (inside `80`): `x1.25`

**Hitboxes.** A figure carries two solids: the body circle at the entity origin
(`radius` per family) and a head circle at `FIGURE_HEAD_Y * scale` above it with
radius `FIGURE_HEAD_RADIUS * scale`. The head is tested only when the body
misses, so the harder shot is never stolen by the easier one.

Both come from `FIGURE_HEAD_Y` / `FIGURE_HEAD_RADIUS` / `figureScaleFor()` in
`config.ts`, which the renderer draws from and the core hit-tests against. They
were previously separate — art.ts owned the drawn head, core.ts owned a single
body circle — and they drifted until a round through the middle of a drawn head
passed `9.3` units clear of anything solid and simply left the page. Anything
the player can aim at is described once.

The legs, from the hip down, still fall outside the body circle. That is left
deliberately forgiving: the torso circle is generous and leg shots missing is a
convention players read as normal, where a head passing through is not.

**Chain.** Kills inside `2.5` world-seconds of each other build a chain; the
score multiplier is `1 + chain * 0.15`, capped at `x3`, and is shown as a
struck-through tally in the corner.

## 9. Meta and economy

- **INK** is the soft currency: `1` per `250` score banked at the end of a run,
  plus the daily reward. Ink buys pages, never power.
- **Pages** (the palette the whole game is drawn in):
  `FIELD LEDGER` free, `GRAPH GRID` 400 ink, `NIGHT SHIFT` 1200 ink,
  `BLUEPRINT` + `CARBON` in the Ledger Pack, `RED PEN` in the bundle.
- **Records**: best score, deepest level, lifetime downs, longest chain.
- **Daily ledger**: a seven-day ink track (60/80/110/140/180/220/400),
  server-time gated, with a duplicate-claim guard.

## 9b. Never a dead page

A player with no gun, no loaded drop, and no gun in flight is handed a 5-round
pistol after `5` world-seconds. It is a safety net rather than an economy: it
cannot fire while the player still holds a loaded weapon, and every level also
fields at least one grunt whose sidearm can be taken off the body.

## 10. Monetization

Non-payer promise: every gun, enemy, level, twist, booster, and scoring rule is
reachable with ink earned from play. Money buys pages, removes the results
break, and can top up ink. It never unlocks content a free player cannot reach.

**Durable purchases** (RUN Shop, entitlement-verified)

| Product | Item id | Price | Value |
| --- | --- | --- | --- |
| Ledger Pack | `deadstop_ledger_pack` | 199 RB | Blueprint and Carbon pages, permanent |
| Ad-Free Forever | `deadstop_no_interstitials` | 299 RB | Removes the mandatory results break |
| First Pen Bundle | `deadstop_founder_bundle` | 399 RB | Both pages, ad-free, and the exclusive Red Pen page |

**Consumable ink** (redeemed from verified order history, never from a client promise)

| Product | Item id | Price | Ink |
| --- | --- | --- | --- |
| Small Ink Case | `deadstop_ink_case_small` | 99 RB | 600 |
| Ink Case | `deadstop_ink_case_medium` | 249 RB | 2,000 |
| Large Ink Case | `deadstop_ink_case_large` | 499 RB | 5,000 |

A full two-booster kit costs roughly `170..380` ink, and a competent run pays
`10..40` ink, so a case is a shortcut rather than a gate. Grants are keyed by
`orderId`, so a replayed history or an interrupted checkout can never
double-grant or lose an order.

Prices are launch hypotheses matched to the sibling RUN title in this
workspace, which uses the same three-tier cosmetic/ad-free/bundle shape at
199/299/399 RB. Rollback signal: conversion under `0.5%` on the bundle after
1k sessions, or refund rate over `3%`.

**Ads**

| Placement | Format | Trigger | Rules |
| --- | --- | --- | --- |
| `rewarded_second_wind` | Rewarded | Death screen, before the run is banked | Once per run, 3/day, 120s cooldown. Grants a revive with the current level re-inked and the score kept. |
| `interstitial_results_break` | Interstitial | After the results screen exit, every 3rd banked run | 1 per session, 3/day, 600s cooldown. Skipped when the player took the rewarded offer. Removed by `no_interstitials`. |

Both channels fail closed: nothing is granted without a host-verified outcome.

## 10-. Daily page and its reminder

Seven days of ink — 60 / 80 / 110 / 140 / 180 / 220 / 400 — cycling on
`totalClaims % 7`. Day 7 is sized to cover most of the first ink-bought page, so
a week of returning buys something the player can see.

Claims are gated on `trustedTimeGate()` and keyed `daily-reward:<day>`, held in
`claimIds`, with an in-flight lock. A rolled device clock mints nothing, a
replayed day cannot double-grant, and a double tap claims once.

**One reminder, and only one.** `src/systems/notifications.ts` schedules a
single local notification for the next unlock, at
`REMINDER_HOUR_AFTER_MIDNIGHT = 9` local rather than at the midnight the reward
technically unlocks — waking someone at 00:00 about free ink is how a game gets
its notifications turned off for good. There is deliberately no streak nag and
no re-engagement ping for simply not playing.

It fails closed at every step: no host namespace, no player preference, no
granted platform permission, or no trusted clock each mean no reminder, never an
optimistic one. The notification id is stable so re-arming replaces rather than
stacks, the permission is requested from the player's own tap (never a passive
prompt), and boot cancels anything pending — a player who is already here has
answered the nudge. `submitMessageAsync({ channels: ["local"] })` is used rather
than the deprecated `scheduleAsync`, and a `skipped` channel is never reported
as scheduled.

## 10a. First-time onboarding

DEADSTOP rests on one counter-intuitive rule — the world only moves while you
do — and a line of text does not teach that. Standing still and watching the
page freeze does. So onboarding coaches by demonstration: three steps, each
naming one rule and waiting for the player to actually perform it.

| Step | Rule named | Advances when |
| --- | --- | --- |
| 1 | `TIME MOVES WHEN YOU DO` | The player has covered `FTUE_MOVE_DISTANCE = 190` world units |
| 2 | `NOW PUT A ROUND IN THEM` | A round is fired |
| 3 | `AN EMPTY GUN IS STILL A WEAPON` | The gun is thrown |

Onboarding also ends the moment the first page is cleared, so it can never nag
a player who found their own way through. Completion writes `controlsSeen` and
is never shown again.

The previous version was a single hint line that vanished on the first keypress
— it taught nothing and could be dismissed by noise. Each step is now *earned*:
twitching in place does not satisfy the clock lesson, and throwing early does
not skip the shooting one.

`src/ui/ftue.ts` holds the whole thing as a pure, deterministic state machine —
no DOM, no clock of its own, one method fed one frame at a time — so the
headless sim drives it exactly as the game does. Copy is authored twice per
step, `touchHint` and `keyboardHint`, so a thumb is never told to press a key.

## 10b. Touch and input mode

Landscape only, with an honest rotate nudge in portrait.

**The scheme is never decided once.** A boot-time `pointer: coarse` query is
wrong on a hybrid laptop, on an iPad with a keyboard, and in some webviews, and
being wrong there means the game is keyboard-only. Instead:

- On-screen controls are present whenever the device reports any touch
  capability (`maxTouchPoints`, `any-pointer: coarse`, or `ontouchstart`).
- The live mode flips to `touch` the moment a touch lands or a stick is
  grabbed, and back to `mouse` on a real mouse move outside the controls.
- Settings carry `TOUCH CONTROLS = AUTO | ALWAYS ON | OFF`. With `ALWAYS ON`,
  a mouse can drive the sticks, so DEADSTOP is playable with no keyboard on any
  device at all.

**Tap a spot, shoot that spot.** Touch aiming is absolute, not a relative
stick: the whole page is a firing surface, and a round goes exactly where the
finger lands. Holding keeps aiming at the finger as it moves and, with
`HOLD TO KEEP FIRING` on, keeps firing; a press under `320ms` is one deliberate
shot regardless. An inked reticle marks the spot before the round leaves the
barrel — teal while the aim is resting, red while the trigger is down.

A thumb covers about a hundred world units, so a hostile within `110` units of
the tapped point captures the shot, pulled by up to `85%` and falling off
linearly with distance. Outside that radius nothing is captured, so tapping
empty page stays a shot at empty page. Mouse aiming is unassisted.

Movement is a **permanent, drawn stick** anchored to the bottom-left corner: a
dashed ring of `--stick-size: clamp(96px, 17vmin, 132px)` with a labelled `MOVE`
caption, visible from the first frame of a run rather than summoned by a touch.
THROW takes the reachable lower-right corner at `clamp(76px, 13vmin, 104px)`.
There is no FIRE button: the page is the trigger.

**Drawing the stick is what makes the split honest.** When the whole page fires,
the player needs to see the one place that does not, and an invisible pad cannot
tell them where it ends. So the stick's hit area is exactly the ring plus a
`30px` halo — `--stick-hit` — and nothing else. It takes under 5% of a phone
screen where the old hidden pad took a fifth. Touching it steers instantly from
the ring's own centre, with knob travel capped at the rendered radius, so what
the player sees is what the simulation is given. Everything outside that circle,
right up to its edge, is a shot.

The stick keeps the corner because that is where a left thumb rests, so on touch
the ammunition readout stacks above it instead of being scribbled over.

**Touch names the control it cannot show.** The stick and THROW are objects on
screen; the firing surface is the entire page, which is invisible by nature and
therefore the one control that most needs saying. A standing
`TAP THE PAGE TO SHOOT` label sits low-centre whenever touch controls are up —
permanently, not only during onboarding, because an affordance a player needs in
their first five seconds cannot be gated behind a lesson they reach at twenty.

**Desktop gets the same two answers in the same two corners.** Touch play shows
a MOVE stick bottom-left and a THROW button bottom-right; desktop showed
nothing there, so a keyboard player had no standing reminder of either. A
permanent `#key-legend` prints `WASD / MOVE` and `F / THROW` in those exact
positions, hidden on touch where the real controls already occupy them. The
ammo readout stacks above whichever of the two owns the corner.

The firing surface sits under the HUD, the stick, and THROW in the layer
order, so a tap on PAUSE is never swallowed by it.

Under `460px` of height the HUD, ammo pips, booster chips, sheets, and draft
cards all step down a size so a phone never renders a desktop layout.

## 11. Art direction — "Field Ledger Ink"

| Role | Colour |
| --- | --- |
| Page | `#f4eee1` |
| Page shade | `#e6dcc8` |
| Ink | `#14100c` |
| Hostile | `#c8382a` |
| Player mark / positive | `#12766c` |
| Ammo / reward | `#c8891a` |
| Ghost line | `#b8ab90` |

- Every stroke is a wobbled polyline. Wobble is regenerated on a `9 fps` boil
  for living lines; reduced motion freezes the boil but keeps the wobble.
- Figures are 5-stroke stick figures: head circle, spine, two legs, two arms,
  plus a 6-stroke gun silhouette.
- The page has faint rules and speckle and runs clean to the screen edge. It
  carries no drawn border: a frame turned the arena into a picture and cost
  every margin a thick band the HUD had to stand clear of. No glow, no
  gradients, no bloom, ever.
- Every booster carries an ink-line glyph on a 24×24 grid, drawn in the same
  pen: open strokes, round caps, fills only where a mark must survive chip
  size. `src/ui/boosterIcons.ts` is the single source for all three surfaces
  that name a booster — the HUD chip, the draft card, the kit card — and it is
  keyed to `BoosterId`, so a new booster without a glyph will not compile.
- Deaths ink a pool, a splatter, and a chalk outline that draws itself in over
  `0.55s` and persists for the level. A kill also holds the world for `55ms`
  (`100ms` for a styled kill or a blast) while the renderer keeps running.
- A new level inks its floor plan in block by block rather than snapping it on.
- The page carries a static wash of tooth and a soft edge burn, leans slightly
  toward the aim, and kicks against every shot. Heavy weapons, blasts, a
  cleared level, and death each wash the screen with a single frame of colour.
- Moving bodies leave dry-brush smears. Rounds striking cover kick ink chips.
  While the page is held, walkers show a faint ghost of where they are heading.
- The HUD is hand-lettered: score struck across the top edge, level stamped top
  right, weapon and round pips bottom left, the TIME bar bottom centre.

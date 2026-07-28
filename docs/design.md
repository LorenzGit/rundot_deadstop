# DEADSTOP design brief

`DESIGN.md` at the repository root is canon for numbers. This file is the
product brief behind those numbers.

- **Player fantasy / audience / orientation / session length:** be the one
  person on the page who decides when time moves; arcade and action-puzzle
  players 12+; landscape only; runs of one to four minutes that end on a single
  hit.
- **One-sentence core loop:** read a frozen lattice of rounds and sight lines,
  spend clock to step through it and fire, take the next gun off the body, clear
  the level, and pick one of three boosters before the next page is drawn.
- **First meaningful action:** the first step. It is also the first lesson,
  because the whole page visibly starts moving with it.
- **First 10-minute path:** the menu states the promise in one line; level 1 is
  always the clean OPEN FLOOR plan with one rusher and one grunt on an almost
  frozen page, so the first shot is nearly free; the first cleared level inks an
  SMG at the player's feet and immediately offers the first booster draft, which
  is where the run starts to feel personal; a first death is fast and legible,
  with the killing round still on screen and the chalk outline drawing itself
  where the player fell; retry is one button.
- **Controls, accessibility, comfort:** mouse and WASD on desktop, two thumbs on
  touch, with THROW as a dedicated control rather than a gesture. On touch the
  page itself is the trigger: tap a spot and the round goes there, which is the
  most direct mapping available and needs no explanation beyond one line of
  onboarding. The input scheme is adaptive rather than sniffed once at boot, and
  `TOUCH CONTROLS = ALWAYS ON` makes the game playable with no keyboard on any
  device, including a desktop mouse driving the same surface.
  Reduced motion removes camera shake, the line boil, and most specks while
  keeping every readability cue. Every state change is carried by shape and text
  as well as motion and sound. Haptics are capability-gated and can be turned
  off. Portrait shows an honest rotate nudge instead of a squashed arena.
- **Difficulty, pacing, RNG policy:** level composition is a pure function of the
  level number, so difficulty is a monotonic curve rather than a dice roll. The
  seed decides the floor plan, the twist, spawn bearings, burst cadence, spread,
  and the draft. Enemy families unlock at fixed levels (tank 4, sniper 6,
  rocketeer 9). Every fifth level is an elite page: heavier, always twisted, and
  worth double. Nothing about a run is hidden: sight lines, charge state,
  remaining rounds, boosters in play, the floor plan name, the twist, and the
  clock are all on screen.
- **Roguelike shape:** the run is the unit of play, boosters are the memory
  inside it, and ink is the memory across runs. A draft is deliberately a
  one-way door so a run develops a character the player did not plan.
- **Failure and recovery:** one hit kills, which is the genre contract and the
  reason standing still is safe. The recovery pressure valve is the optional
  rewarded Second Wind, capped at once per run, and clearly labelled as an
  assisted run in the results.
- **Anti-frustration rules:** every wave fields at least one grunt, whose sidearm
  can be taken off the body; an empty-handed player is resupplied with a 5-round
  pistol after five world-seconds; a wave clear always drops a fresh gun; walking
  over a loaded gun while holding an empty one swaps automatically.
- **Skill expression:** where you stand when you stop, which round you thread
  first, whether you spend the clock on aim or on distance, and whether you throw
  a loaded gun for the `x3`.
- **Content cadence:** the level curve is endless; the reward ladder repeats with
  more rounds per cycle; floor plans and twists recombine. Pages and the kit are
  the only things ink buys, and pages never change play.

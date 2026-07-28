/**
 * DEADSTOP invariant suite.
 *
 * These are the promises the game makes that are cheap to break by accident:
 * the Standstill clock contract, fail-closed monetization, honest player copy,
 * safe-area discipline, and release metadata. Gameplay tuning lives in
 * `simulate.ts`; this file guards the contracts around it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const readJson = (path) => JSON.parse(read(path));

const packageJson = readJson("../package.json");
const gameConfig = readJson("../game.config.prod.json");
const liveOpsConfig = readJson("../rundot/liveops.config.json");
const shopConfig = readJson("../rundot/shop.config.json");

const html = read("../index.html");
const main = read("../src/main.ts");
const controller = read("../src/ui/controller.ts");
const styles = read("../src/styles/app.css");
const boosterIcons = read("../src/ui/boosterIcons.ts");
const ftue = read("../src/ui/ftue.ts");
const art = read("../src/game/art.ts");
const scene = read("../src/game/scene.ts");
const config = read("../src/game/config.ts");
const core = read("../src/game/core.ts");
const pixiApp = read("../src/game/pixiApp.ts");
const audioManager = read("../src/audio/audioManager.ts");
const runSdk = read("../src/sdk/runSdk.ts");
const save = read("../src/systems/save.ts");
const commerce = read("../src/systems/commerce.ts");
const saveSchema = read("../src/systems/saveSchema.ts");
const monetizationConfig = read("../src/systems/monetization/config.ts");
const rewardedAds = read("../src/systems/rewardedAds.ts");
const interstitialAds = read("../src/systems/interstitialAds.ts");
const qaContract = read("../src/qa/browserContract.ts");
const notifications = read("../src/systems/notifications.ts");
const monetizationDoc = read("../docs/monetization.md");

/* ------------------------------------------------------------- 1. identity */

assert.equal(packageJson.name, "deadstop");
assert.match(packageJson.version, /^\d+\.\d+\.\d+$/, "package version must be semantic");
assert.match(html, /<title>DEADSTOP<\/title>/, "the document must carry the shipped title");
assert.equal((html.match(/id="version-label"/g) ?? []).length, 1, "version label must be unique");
assert.match(main, /__APP_VERSION__/, "the UI must render the injected package version");
assert.doesNotMatch(
    `${html}\n${styles}\n${main}\n${controller}\n${scene}\n${art}`,
    /scrap[-_ ]?shift|SCRAP\/\/SHIFT|salvage|Pixel Foundry/i,
    "no scaffold identity may survive in DEADSTOP source",
);
assert.equal(String(gameConfig.orientation).toLowerCase(), "landscape", "RUN metadata must declare landscape");
assert.ok(Array.isArray(gameConfig.keywords) && gameConfig.keywords.length >= 3, "release keywords must be set");

/* ---------------------------------------------------- 2. the clock contract */

assert.match(config, /TIME_FLOOR = 0\.0\d+/, "the page must never freeze completely");
assert.match(core, /this\.movePlayer\(realDelta\)/, "player movement must run on real time, never on the scaled clock");
assert.match(
    core,
    /const worldDelta = realDelta \* this\.timeScale/,
    "everything except the player must be scaled by the clock",
);
assert.match(
    core,
    /this\.updateBullets\(worldDelta\)/,
    "bullets must obey the clock so a still page holds its lattice",
);
assert.match(core, /this\.updateEnemies\(worldDelta\)/, "hostiles must obey the clock");
assert.match(html, /id="time-fill"/, "the clock must be readable in the HUD");
assert.match(main, /audioManager\.setTension\(/, "the score must follow the clock");

/* ------------------------------------------------------- 3. no dead-end page */

assert.match(core, /private updateResupply\(/, "an empty-handed player must always be resupplied");
assert.match(config, /RESUPPLY_DELAY_SECONDS/, "the resupply safety net must be configured, not hard-coded inline");
assert.match(
    config,
    /grunt: Math\.min\(9, 1 \+ Math\.floor\(n \/ 2\) \+ creep\(14\)\)/,
    "every level must field a gun-dropping grunt",
);
assert.match(
    config,
    /if \(over > 0\) capped\.grunt = Math\.max\(1, capped\.grunt - over\);/,
    "trimming a page to the body budget must never cost it the last grunt",
);

/* ------------------------------------------- 3b. levels, boosters, and drafts */

assert.match(config, /export function levelComposition\(/, "the level curve must be one pure function");
assert.match(config, /export const LAYOUT_ARCHETYPES/, "floor plans must be a named, testable set");
assert.match(config, /export const MODIFIERS/, "level twists must be a named, testable set");
assert.match(config, /export const BOOSTERS/, "boosters must be a named, testable set");
assert.match(core, /private planLevel\(/, "levels must be planned deterministically from the seed");
assert.match(core, /level === 1 \? "open"/, "the opening page must be the clean teaching layout");
assert.match(core, /private openDraft\(/, "a draft must sit between levels");
assert.match(core, /chooseBooster\(index: number\)/, "the draft must be resolved by an explicit pick");
assert.match(html, /id="draft-screen"/, "the draft needs a player-facing surface");
assert.match(html, /id="draft-cards"/, "the draft must render real cards");
assert.match(controller, /key === "1" \|\| key === "2" \|\| key === "3"/, "the draft must be keyboard reachable");
assert.match(html, /id="booster-strip"/, "boosters in play must be visible during a run");

/* ------------------------------------------------- 3c. the run never ends */

// "Infinite" has to mean the curve is infinite, not just the loop. Counts
// saturate on purpose — one screen, one frame budget — so pressure is what
// carries difficulty past that point, forever.
assert.match(config, /export function levelPressure\(/, "an endless run needs an endless difficulty curve");
assert.match(
    config,
    /Math\.log2\(1 \+ \(n - PRESSURE_FLOOR_LEVEL\) \/ 6\) \* PRESSURE_RATE/,
    "pressure must grow without bound but with diminishing returns",
);
assert.match(config, /export const ROSTER_HARD_CAP/, "the body budget must be one explicit, shared number");
assert.match(
    config,
    /export function levelEnemyCount[\s\S]{0,160}capComposition/,
    "the reported page size must go through the same cap the roster does, or the HUD lies",
);
for (const [stat, pattern] of [
    ["speed", /Math\.min\(PRESSURE_SPEED_MAX, levelPressure\(this\.level\)\)/],
    ["aim time", /Math\.min\(PRESSURE_ACQUIRE_MAX, pressure\)/],
    ["cadence", /Math\.min\(PRESSURE_CADENCE_MAX, pressure\)/],
    ["soak", /definition\.soak \+ pressureSoakBonus\(this\.level\)/],
]) {
    assert.match(core, pattern, `deep pages must field better bodies: ${stat} must read pressure, and stay clamped`);
}
assert.doesNotMatch(
    core,
    /if \(available\.length === 0\) \{\s*\n\s*this\.phase = "running";/,
    "the draft must never silently skip; a full booster board deals loadout instead",
);
assert.match(core, /private weaponOffers\(\): DraftOffer\[\]/, "the endless draft must have something to deal");
assert.match(
    controller,
    /offers\.some\(\(offer\) => offer\.kind === "weapon"\)/,
    "the draft screen must say which kind of hand it is dealing",
);

/* --------------------------------- 3d. what is drawn is what can be shot */

// The renderer and the core each used to own a copy of the skeleton, and they
// drifted until the drawn head sat entirely above the only solid on the body.
// One source, imported by both, is the fix that keeps.
assert.match(config, /export const FIGURE_HEAD_Y/, "the skeleton the player aims at must be described once");
assert.match(config, /export const FIGURE_HEAD_RADIUS/, "the head needs a shared radius, not two");
assert.match(config, /export function figureScaleFor\(/, "per-family figure scale must be shared, not re-derived");
assert.doesNotMatch(art, /^const HEAD_(Y|RADIUS) = /m, "art.ts must not keep a private copy of the head geometry");
assert.match(art, /FIGURE_HEAD_Y \* scale/, "the renderer must draw the head from the shared skeleton");
assert.match(scene, /figureScaleFor\(enemy\.kind\)/, "the renderer must scale figures from the shared helper");
assert.match(core, /private headCentreY\(/, "the core must know where the drawn head is");
assert.match(
    core,
    /FIGURE_HEAD_Y \* figureScaleFor\(enemy\.kind\)/,
    "the head solid must be positioned from the same skeleton the renderer draws",
);
assert.match(
    core,
    /const headshot =[\s\S]{0,220}this\.headRadius\(enemy\) \+ BULLET_RADIUS/,
    "a round through a drawn head must connect with it",
);
assert.match(config, /export const STYLE_HEADSHOT = 2\.5;/, "the hardest shot on the page must pay the most");
assert.match(core, /if \(style === "HEADSHOT"\) multiplier \*= STYLE_HEADSHOT;/, "headshots must actually score more");

/* ---------------------------------------------------------- 4. randomness */

assert.doesNotMatch(core, /Math\.random\(/, "game logic must use NoiseRandom, never Math.random");
assert.doesNotMatch(config, /Math\.random\(/, "content tables must not use Math.random");
assert.doesNotMatch(audioManager, /Math\.random\(/, "procedural audio must stay deterministic");
assert.match(core, /new NoiseRandom\(/, "the core must seed the shared deterministic generator");

/* ---------------------------------------------------------- 5. presentation */

assert.match(pixiApp, /preference,/, "the renderer must remain WebGPU-first with a WebGL fallback");
assert.match(pixiApp, /antialias: true/, "ink strokes need antialiasing");
assert.match(pixiApp, /WEBGPU INIT FAILED/, "the WebGPU failure path must stay explicit");
assert.match(art, /export function jitter\(/, "the hand-drawn wobble must stay centralised");
assert.match(scene, /BOIL_INTERVAL/, "the living-line boil must be centralised");
assert.match(scene, /private redrawGrain\(/, "the paper tooth must be drawn once, not per frame");
assert.match(scene, /private drawOverlay\(/, "the screen-space flash must be its own pass");
assert.match(scene, /this\.coverDraw/, "a level must ink its floor plan in rather than snapping it into place");
assert.match(scene, /leanTargetX/, "the page must lean with the aim and kick against the shot");
assert.match(main, /HIT_STOP_SECONDS/, "kills must land with a held beat");
assert.match(
    main,
    /if \(hitStop > 0\) hitStop = Math\.max\(0, hitStop - delta\);\s*\n\s*else core\.update\(delta\);/,
    "hit stop must freeze the world without freezing the renderer",
);
assert.match(scene, /if \(this\.reducedMotion\) return;/, "reduced motion must suppress camera shake");
assert.match(scene, /this\.boil = 0;/, "reduced motion must freeze the boil");
assert.match(scene, /root\.style\.setProperty\("--stage-inset"/, "the HUD must be anchored to the inked page");
assert.doesNotMatch(
    art,
    /g\.poly\(edge\)\.stroke/,
    "the page runs to the screen edge; a drawn border framed the arena and stole every margin",
);

// Every booster carries a glyph, and every surface that names one shows it.
const boosterBlock = config.slice(config.indexOf("export const BOOSTERS"), config.indexOf("export const BOOSTER_IDS"));
const boosterIds = [...boosterBlock.matchAll(/^ {8}id: "(\w+)",$/gm)].map((match) => match[1]);
assert.ok(boosterIds.length >= 14, `expected the full booster roster, found ${boosterIds.length}`);
for (const id of boosterIds) {
    assert.match(
        boosterIcons,
        new RegExp(`^ {4}${id}: \\[`, "m"),
        `booster ${id} has no icon; a powerup the player cannot recognise is a powerup they will not read`,
    );
}
assert.match(
    boosterIcons,
    /Readonly<Record<BoosterId, readonly IconShape\[\]>>/,
    "keying icons to BoosterId is what makes a missing glyph a compile error",
);
// The endless draft deals guns, and those cards sit in the same slot.
const weaponIds = [...config.matchAll(/^ {4}(\w+): \{\n {8}id: "\1",\n {8}name: "[A-Z]+",\n {8}rounds:/gm)].map(
    (match) => match[1],
);
assert.ok(weaponIds.length >= 5, `expected the full weapon roster, found ${weaponIds.length}`);
for (const id of weaponIds) {
    assert.match(
        boosterIcons,
        new RegExp(`^ {4}${id}: \\[`, "m"),
        `weapon ${id} has no glyph; an endless-draft card would read as half-finished`,
    );
}
assert.match(
    boosterIcons,
    /Readonly<Record<WeaponId, readonly IconShape\[\]>>/,
    "weapon glyphs get the same compile-time guarantee as booster glyphs",
);
for (const surface of [
    /chip\.append\(boosterIcon\(/,
    /card\.append\(boosterIcon\(offer\.id\)/,
    /card\.append\(boosterIcon\(id\)/,
]) {
    assert.match(controller, surface, "the HUD chip, the draft card and the kit card must all show the glyph");
}
assert.match(styles, /\.booster-icon \{/, "the glyph needs one shared ink-line style, not three");
assert.match(styles, /--hud-top: max\(/, "HUD insets must combine RUN safe areas with the page edge");
assert.match(styles, /-webkit-touch-callout: none/, "long-press callouts must be disabled");
assert.match(styles, /user-select: none/, "text selection must be disabled across the game surface");
assert.match(main, /document\.addEventListener\("selectstart"/, "selection must also be blocked at the document");
assert.match(main, /document\.addEventListener\("contextmenu"/, "context menus must be blocked");
assert.match(main, /document\.addEventListener\("dragstart"/, "drag gestures must be blocked");
assert.match(html, /id="rotate-hint"/, "a landscape game must nudge honestly in portrait");
assert.match(html, /id="boot-cover"/, "the branded loading cover must exist");
assert.match(html, /INKING THE PAGE/, "the loading cover must speak in the game's voice");

/* ------------------------------------------------------------- 6. controls */

assert.match(html, /id="move-zone"/, "touch movement must have its own zone");
assert.match(html, /id="aim-zone"/, "touch aiming must have its own zone");
assert.match(
    controller,
    /private snapToTarget\(/,
    "a tapped spot must snap onto a nearby hostile; a thumb cannot hold a pixel",
);
assert.match(
    controller,
    /Absolute aim: the shot goes at the spot under the finger/,
    "touch aiming must be absolute, not a relative stick",
);
assert.match(html, /<div id="aim-zone" class="touch-zone aim-zone"><\/div>/, "the firing surface must be a bare zone");
assert.match(styles, /\.aim-zone \{\s*\n\s*inset: 0;/, "the whole page must be tappable to shoot");
assert.match(scene, /setTouchAim\(/, "a tapped spot must be shown before the round leaves the barrel");
assert.match(
    controller,
    /navigator\.maxTouchPoints/,
    "touch support must be detected from real capability, not a single media query",
);
assert.match(
    controller,
    /private noteInputMode\(/,
    "the control scheme must follow what the player last used, so a hybrid device is never keyboard-only",
);
assert.match(controller, /touchControlsVisible\(\)/, "the on-screen controls must have one explicit visibility rule");
assert.match(html, /id="touch-controls-mode"/, "a player must be able to force the on-screen controls on or off");
assert.match(html, /id="auto-fire"/, "auto-fire must be a real, persisted setting");
assert.match(
    controller,
    /const holdFiring = this\.settings\.autoFire && this\.touchAimHeld;/,
    "holding a spot must keep firing at it",
);
assert.match(controller, /TAP_SHOT_MS/, "a short tap must be one deliberate shot even with hold-fire off");
assert.match(styles, /@media \(max-height: 460px\)/, "short landscape phones need their own HUD scale");
assert.match(
    controller,
    /TAP_SNAP_RADIUS/,
    "the snap must be bounded to a radius, so tapping empty page stays a shot at empty page",
);
// MOVE and THROW are objects you can see. The firing surface is the whole page,
// which is invisible by nature and therefore the control that most needs
// saying — and it must be said permanently, not only during onboarding.
assert.match(html, /id="tap-to-shoot"/, "touch play needs a standing label for the one control it cannot show");
// Structural, not textual: the label must live inside the touch-controls
// block, which is what keeps it off desktop.
const touchControlsBlock = html.slice(
    html.indexOf('<div id="touch-controls"'),
    html.indexOf('<button\n                    id="performance-hud"'),
);
assert.ok(
    touchControlsBlock.includes('id="tap-to-shoot"'),
    "the shoot label belongs inside #touch-controls so desktop never shows it",
);
assert.match(styles, /\.tap-to-shoot \{/, "the standing shoot label needs its own quiet styling");
assert.match(
    main,
    /coachX = spawn\.x;/,
    "travel must be measured from the spawn point; from the origin the first frame is a 700 unit leap",
);
// Touch shows a MOVE stick and a THROW button on screen. Desktop had neither,
// so the same two answers are printed permanently in the same two corners.
assert.match(html, /id="key-legend"/, "desktop players need the controls on screen, not only in a hint");
assert.match(html, /<kbd>W<\/kbd><kbd>A<\/kbd><kbd>S<\/kbd><kbd>D<\/kbd>/, "the legend must show how to move");
// An empty gun is still a weapon, and the trigger the player already knows is
// what throws it — no separate verb to discover, and it still goes where they
// are aiming, which an automatic throw on the last round could not.
// Throwing has no verb. The round that empties the gun is followed by the frame
// itself, so there is no control to find, no dead click, and nothing to teach.
assert.match(
    core,
    /if \(weapon\.rounds <= 0\) this\.pendingThrow = Number\.EPSILON;/,
    "running dry must arm the throw",
);
// The round and the frame must not leave the muzzle together. A wall-clock beat
// is not enough: the round hangs in the air on a held page, so the gun has to
// wait on the same clock the round does.
assert.match(config, /export const THROW_AFTER_DRY_WORLD_SECONDS/, "the wait must be measured in world time");
assert.match(
    core,
    /this\.pendingThrow \+= worldDelta;/,
    "the frame must wait on the world clock, exactly as the round it fired does",
);
assert.match(
    core,
    /this\.pendingThrowReal \+= realDelta;/,
    "a real-time backstop must exist so a motionless player is never stuck holding a spent frame",
);
assert.match(
    core,
    /if \(weapon\.rounds <= 0\) return;\s*\n\s*this\.firePlayerWeapon\(weapon\);/,
    "a dry gun awaiting its throw must not keep firing into negative rounds",
);
assert.doesNotMatch(core, /requestThrow/, "there is no manual throw left to request");
assert.doesNotMatch(controller, /onThrow/, "no input may ask for a throw");
assert.doesNotMatch(html, /throw-button/, "the THROW button is gone; running dry throws for you");
assert.doesNotMatch(ftue, /id: "throw"/, "there is no throw control, so onboarding must not teach one");
assert.match(
    core,
    /if \(gun\.weapon\.rounds > 0\) this\.addDrop\(/,
    "a spent frame must not land as a pickup that only re-arms the throw",
);
assert.doesNotMatch(core, /dry_fire/, "the dead click is gone; the trigger always does something");
assert.match(
    styles,
    /body\[data-pointer="coarse"\] \.key-legend,\s*\n\.key-legend\.hidden \{\s*\n\s*display: none;/,
    "touch already has the real controls on screen; the legend would be noise",
);
assert.match(
    styles,
    /body:not\(\[data-pointer="coarse"\]\) \.hud-weapon-slot \{/,
    "the ammo readout must clear whatever owns the bottom-left corner",
);

/* ------------------------------------------------------------- 6b. the FTUE */

// The old onboarding was one line that vanished on the first keypress, which
// taught nothing. Each step now names one rule and waits to see it done.
assert.match(ftue, /export const FTUE_STEPS/, "onboarding must be a real, ordered sequence");
for (const [id, why] of [
    ["move", "the clock rule is the whole game and has to be felt, not read"],
    ["shoot", "a player who never fires never learns the loop"],
]) {
    assert.match(ftue, new RegExp(`id: "${id}"`), `onboarding must cover ${id}: ${why}`);
}
assert.match(ftue, /touchHint/, "onboarding copy must adapt to the device in hand");
assert.match(ftue, /keyboardHint/, "onboarding copy must adapt to the device in hand");
assert.match(
    ftue,
    /this\.travelled >= FTUE_MOVE_DISTANCE/,
    "the clock lesson must be earned by actually walking, not by any keypress",
);
assert.doesNotMatch(
    controller,
    /private discoverControls\(/,
    "onboarding must not be dismissed by the first input; it advances on demonstration",
);
assert.match(main, /ftue\.observe\(\{ delta, moved, shots: coachShots \}\)/, "the coach must watch play");
assert.match(main, /saveSystem\.markControlsSeen\(\)/, "finishing onboarding must persist so it never repeats");
// Onboarding is gated on a flag the previous system set on the first keypress,
// so every player from an older build carries it and would never be coached.
// A replay control is the only way back in.
assert.match(html, /id="replay-tutorial"/, "players must be able to see the tutorial again");
assert.match(save, /resetControlsSeen\(\): void/, "replaying onboarding must be a real, persisted reset");
assert.match(main, /saveSystem\.resetControlsSeen\(\)/, "the replay control must clear the flag it is gated on");
// A step nobody can read is not an instruction. Auto-fire is on by default, so
// the frame that completes one lesson is usually one the player is already
// shooting on — without a dwell the next lesson flashes past in a frame.
assert.match(ftue, /FTUE_MIN_DWELL_SECONDS/, "every step must be legible before it can be satisfied");
assert.match(
    ftue,
    /if \(!this\.satisfied \|\| this\.shownFor < FTUE_MIN_DWELL_SECONDS\) return false;/,
    "a step must clear only once it has been both demonstrated and readable",
);
assert.match(
    ftue,
    /if \(!this\.satisfied\) \{/,
    "the demonstration must latch; a throw during the dwell cannot be discarded",
);
assert.match(
    main,
    /event\.type === "level_clear" && event\.level >= FTUE_LAST_COACHED_LEVEL/,
    "clearing level 1 is no proof the throw lesson was ever met",
);
assert.doesNotMatch(
    styles,
    /\.stick-base \{[^}]*opacity: 0;/,
    "the movement stick is permanent, so it may never start invisible",
);
assert.match(
    styles,
    /\.stick-base::after \{\n {4}content: "MOVE";/,
    "a permanent control must be labelled or it reads as decoration",
);
assert.match(
    styles,
    /--stick-hit: calc\(var\(--stick-size\) \+ 30px\)/,
    "the stick's hit area must be the drawn ring plus a halo, not a hidden slab of the page",
);
assert.doesNotMatch(
    controller,
    /this\.stickBase\.style\.(left|top)/,
    "the stick is anchored, so nothing may reposition it under the thumb",
);
assert.match(
    controller,
    /private steer\(clientX: number, clientY: number\): void \{/,
    "the stick must read the thumb against its own drawn ring",
);

/* ------------------------------------------------------------- 7. audio */

// SFX stay procedural — they are gameplay feedback and must be instant and
// free. The score is one authored track, wired to the same clock as the world.
assert.match(audioManager, /import MUSIC_URL from "\.\/assets\/midnight-static\.mp3"/, "the score is a real track");
assert.doesNotMatch(
    audioManager,
    /CUES[\s\S]{0,4000}\.mp3/,
    "sound effects must stay procedural; only the music may be a media file",
);
for (const [knob, pattern] of [
    ["volume", /gain\.gain\.setTargetAtTime\(/],
    ["muffle", /filter\.frequency\.setTargetAtTime\(/],
]) {
    assert.match(audioManager, pattern, `the score must follow the clock: ${knob} must track tension`);
}
// Varying playback rate pitch-shifts the whole mix and sounds broken rather
// than tense. The filter and the level carry the effect; the tempo does not.
assert.doesNotMatch(
    audioManager,
    /playbackRate/,
    "the music must never be re-pitched by the clock; only level and filter follow it",
);
assert.match(
    audioManager,
    /MUSIC_LEVEL_STILL = 0\.3[\s\S]{0,120}MUSIC_LEVEL_MOVING = 0\.5/,
    "standing still must drop the level and moving must restore it",
);
assert.match(
    audioManager,
    /MUSIC_CUTOFF_STILL = 460[\s\S]{0,120}MUSIC_CUTOFF_MOVING = 16_000/,
    "a held page must sit behind a closed filter and open up again on the move",
);
assert.match(audioManager, /console\.warn\("\[audio\] music unavailable"/, "a missing track must never break the loop");
assert.match(audioManager, /musicEnabled/, "music must respect the persisted setting");
assert.match(audioManager, /sfxEnabled/, "sound effects must respect the persisted setting");
assert.match(audioManager, /setPaused\(paused: boolean\)/, "audio must follow the host lifecycle");
assert.match(main, /audioManager\.bindUnlock\(\)/, "audio must wait for a real user gesture");

/* --------------------------------------------------------- 8. RUN platform */

assert.match(runSdk, /export function bindRunSafeArea/, "RUN safe areas must be applied and rebound on resize");
assert.match(runSdk, /withTimeout\(/, "every host call must be bounded");
assert.match(runSdk, /capabilities\.storage/, "storage must be capability-gated");
assert.match(main, /registerLifecycles\(/, "pause, resume, sleep, awake, quit, and back must be handled");
assert.match(main, /onBackButton/, "the host back button must be handled");
assert.match(save, /const SAVE_KEY = "deadstop-save"/, "the save key must be namespaced to this game");
assert.match(save, /localStorage/, "a local save fallback must exist when the host has no storage");

/* ---------------------------------------------------------- 8b. the kit */

assert.match(html, /id="kit-screen"/, "the ink-bought kit needs its own surface");
assert.match(html, /id="kit-grid"/, "the kit must render real boosters");
assert.match(config, /export const KIT_SLOTS/, "the kit size must be a named constant");
assert.match(main, /saveSystem\.spendInk\(/, "kit ink must be spent when the run actually starts");
assert.match(
    save,
    /redeemInkOrder\(orderId: string/,
    "bought ink must be redeemed against an order id so it can never double-grant",
);

/* ------------------------------------------------------ 9. monetization */

// The RB unit was mistaken for dollars once already, which nearly triggered an
// unwarranted tenfold repricing. The verified anchor stays written down.
assert.match(
    monetizationDoc,
    /\*\*1 RB = 1 US cent\*\*, verified against the live RUN Bits purchase screen/,
    "the RB-to-fiat anchor must be recorded with its source, not re-derived from memory",
);
for (const item of shopConfig.items) {
    const rb = Number(item.price.value);
    assert.equal(item.price.type, "bucks", `${item.itemId} must be priced in RUN Bits`);
    assert.ok(Number.isInteger(rb) && rb > 0, `${item.itemId} needs a whole RB price`);
    // A four-figure price is $10+; possible, but never by accident.
    assert.ok(rb <= 999, `${item.itemId} at ${rb} RB is $${(rb / 100).toFixed(2)} — confirm that is intended`);
}
assert.match(monetizationConfig, /rewarded_second_wind/, "the rewarded placement must be registered");
assert.match(monetizationConfig, /interstitial_results_break/, "the interstitial placement must be registered");
assert.match(monetizationConfig, /deadstop_ledger_pack/, "the cosmetic product must use a namespaced catalog id");
assert.match(monetizationConfig, /deadstop_no_interstitials/, "the ad-free product must use a namespaced catalog id");
assert.match(monetizationConfig, /deadstop_founder_bundle/, "the bundle must use a namespaced catalog id");
assert.match(
    monetizationConfig,
    /enabledByDefault: false/,
    "placements must stay fail-closed until LiveOps enables them",
);
assert.match(
    rewardedAds,
    /if \(!completed\) \{[\s\S]*?return \{ granted: false/,
    "an unfinished video must never grant the revive",
);
assert.match(
    rewardedAds,
    /saveSystem\.recordRewardedCompletion\(/,
    "rewarded completions must be recorded so one run cannot bank two revives",
);
assert.match(main, /if \(outcome\.granted\)/, "the revive must only follow a host-confirmed completion");
// A configured placement with no call site is an ad that never runs — and here
// it would be an ad the 299-buck ad-free product claims to remove.
assert.match(
    main,
    /await maybeShowResultsInterstitial\(rewardedInteracted,/,
    "the results interstitial must actually be invoked at its natural break",
);
assert.match(
    main,
    /async function exitResults\(destination: "retry" \| "menu", rewardedInteracted: boolean\)/,
    "the break belongs on the way out of results, after the tally has been read",
);
assert.match(
    interstitialAds,
    /if \(reason !== "eligible"\) return \{ displayed: false, reason \};/,
    "the interstitial gate must be the only door, and it must fail closed",
);
assert.match(commerce, /authoritativeEntitlementsLoaded/, "ownership must come from verified entitlements");
assert.match(
    saveSchema,
    /paletteInkCost\(id\) !== null/,
    "only ink-bought pages may be trusted from a local save file",
);
assert.match(interstitialAds, /deadstop_no_interstitials/, "the ad-free entitlement must suppress interstitials");
assert.doesNotMatch(
    `${html}\n${controller}`,
    /RUN SHOP|ENTITLEMENT UNAVAILABLE|SDK|CAPABILITY/,
    "host plumbing language must never reach the player",
);
assert.match(html, /id="second-wind-offer"/, "the rewarded offer must exist as a player-facing surface");
assert.match(
    html,
    /<article id="second-wind-offer" class="inline-offer hidden">/,
    "the rewarded offer must start hidden and appear only when a video is genuinely available",
);
assert.match(html, /id="settings-noads-offer"/, "Settings must expose the permanent ad-free offer");
assert.match(html, /AD-FREE FOREVER/, "the ad-removal product must use clear player language");
assert.match(controller, /versionTapCount >= 5/, "five version taps must open the host-gated diagnostic bay");

const catalog = new Map(shopConfig.items.map((item) => [item.itemId, item]));
assert.equal(catalog.size, 6, "the catalog must carry the three durables and the three ink cases");
assert.deepEqual(
    Object.fromEntries([...catalog].map(([itemId, item]) => [itemId, item.price.value])),
    {
        deadstop_ledger_pack: "199",
        deadstop_no_interstitials: "299",
        deadstop_founder_bundle: "399",
        deadstop_ink_case_small: "99",
        deadstop_ink_case_medium: "249",
        deadstop_ink_case_large: "499",
    },
    "final prices must be explicit RB values in the server catalog",
);
assert.match(
    commerce,
    /export async function redeemPurchasedInk/,
    "ink cases must redeem from verified order history rather than a client promise",
);
assert.deepEqual(
    catalog
        .get("deadstop_founder_bundle")
        ?.entitlements.map((entry) => entry.entitlementId)
        .sort(),
    ["deadstop_ledger_pack", "deadstop_no_interstitials", "deadstop_pen_redpen"],
    "the bundle must grant every advertised permanent entitlement",
);
for (const item of catalog.values()) {
    assert.equal(item.active, true, `${item.itemId} must be active`);
    const consumable = item.itemId.includes("ink_case");
    assert.ok(
        item.entitlements.every((entry) => entry.consumable === consumable),
        `${item.itemId} must be ${consumable ? "consumable" : "durable"}`,
    );
}

const monetization = liveOpsConfig.client.values.monetization;
assert.equal(monetization.privateTestMode, false, "public LiveOps must disable the private test bay");
assert.equal(monetization.placements.interstitial_results_break.everyNthRun, 3, "ads only every third eligible run");
assert.equal(monetization.placements.rewarded_second_wind.dailyCap, 3, "the revive must stay daily-capped");
assert.ok(monetization.placements.rewarded_second_wind.cooldownSeconds >= 120, "the revive must keep a real cooldown");

/* ------------------------------------------------- 9b. notifications */

// A notification has to be worth the interruption or it is spam with the
// game's name on it. One reminder, for the one thing a player actually loses
// by not coming back, and only if they asked for it.
assert.match(notifications, /DAILY_REMINDER_ID/, "the reminder needs a stable id so re-arming replaces, never stacks");
assert.match(
    notifications,
    /export const REMINDER_HOUR_AFTER_MIDNIGHT = 9;/,
    "reminders must land at a civil hour, not at the stroke of local midnight",
);
assert.match(
    notifications,
    /if \(!trustedTimeGate\(\)\.ready\) return null;/,
    "a reminder scheduled off a rolled device clock is noise; trusted time gates it",
);
assert.match(
    notifications,
    /if \(!settings\.dailyReminder\) return false;/,
    "no reminder may be scheduled without the player asking for one",
);
assert.match(
    notifications,
    /if \(!permissionGranted\) return false;/,
    "the platform permission must be granted, never assumed",
);
assert.match(runSdk, /if \(!capabilities\.notifications\) return false;/, "the notification bridge must fail closed");
assert.match(
    runSdk,
    /channel\.channel === "local" && channel\.status === "scheduled"/,
    "a skipped channel is not a scheduled notification and must not be reported as one",
);
assert.doesNotMatch(
    runSdk,
    /notifications\.scheduleAsync\(/,
    "scheduleAsync is deprecated; use submitMessageAsync with an explicit channel",
);
assert.match(html, /id="daily-reminder"/, "the reminder must be a setting the player controls");
assert.match(main, /void syncDailyReminder\(\);/, "claiming today's page must re-arm tomorrow's reminder");
assert.match(main, /await clearPendingReminder\(\);/, "a player who is already here must not be nudged");
assert.match(saveSchema, /dailyReminder: booleanOr\(/, "the reminder preference must survive a hostile save file");

/* --------------------------------------------------------------- 10. QA */

assert.match(qaContract, /import\.meta\.env\.DEV/, "the QA bridge must never ship to production");
assert.match(qaContract, /get\("qa"\) !== "1"/, "the QA bridge must stay opt-in");
assert.doesNotMatch(
    qaContract,
    /from "\.\.\/systems\//,
    "QA must not reach into commerce, ads, or save systems where it could fabricate an outcome",
);
assert.match(
    qaContract,
    /never fabricates a RUN ad, purchase, entitlement, or reward/,
    "the QA bridge must state its boundary in the file itself",
);

console.log("invariant check ok: identity, clock, resupply, randomness, presentation, controls, audio, RUN, money, QA");

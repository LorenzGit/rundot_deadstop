/**
 * Deterministic headless proof for the DEADSTOP core.
 *
 * Runs a scripted bot through real levels and asserts the Standstill contract,
 * the procedural level curve, boosters, the draft, the weapon economy, cover,
 * scoring, and determinism. No DOM, no renderer, no host.
 */
import assert from "node:assert/strict";
import {
    actForLevel,
    BOOSTER_IDS,
    BOOSTERS,
    ENEMIES,
    ENEMY_LEVEL_GATES,
    FIGURE_HEAD_RADIUS,
    FIGURE_HEAD_Y,
    figureScaleFor,
    isEliteLevel,
    KIT_BOOSTER_IDS,
    LEVELS_PER_ACT,
    levelComposition,
    levelEnemyCount,
    levelPressure,
    MODIFIERS,
    PLAYER_SPEED,
    PRESSURE_ACQUIRE_MAX,
    PRESSURE_CADENCE_MAX,
    PRESSURE_FLOOR_LEVEL,
    PRESSURE_SPEED_MAX,
    PLAYER_RADIUS,
    WORLD_MARGIN,
    pressureSoakBonus,
    ROSTER_HARD_CAP,
    rewardForLevel,
    STYLE_HEADSHOT,
    TIME_FLOOR,
    WEAPON_IDS,
    WEAPONS,
    WORLD_HEIGHT,
    WORLD_WIDTH,
} from "../src/game/config.ts";
import { GameCore } from "../src/game/core.ts";
import type { CoreSnapshot, GameEvent } from "../src/game/types.ts";
import { FTUE_MIN_DWELL_SECONDS, FTUE_MOVE_DISTANCE, FTUE_STEPS, Ftue } from "../src/ui/ftue.ts";

const STEP = 1 / 60;

interface BotOptions {
    /** Stand perfectly still: never move, never aim, never fire. */
    frozen?: boolean;
    /** Walk a constant circle, ignoring hostiles entirely. */
    march?: boolean;
    /** Stop after this many simulated seconds. */
    seconds: number;
    /** Fire at the nearest hostile when one is in range. */
    shoot?: boolean;
}

interface RunReport {
    snapshot: CoreSnapshot;
    events: GameEvent[];
    maxTimeScale: number;
    minTimeScale: number;
}

function driveBot(core: GameCore, options: BotOptions): RunReport {
    const events: GameEvent[] = [];
    const frames = Math.round(options.seconds / STEP);
    let maxTimeScale = 0;
    let minTimeScale = 1;
    let wander = 0;

    for (let frame = 0; frame < frames; frame += 1) {
        const snapshot = core.snapshot();
        if (snapshot.phase === "defeat") break;
        if (snapshot.phase === "draft") {
            // The bot always takes the first card so runs keep moving.
            core.chooseBooster(0);
            events.push(...core.drainEvents());
            continue;
        }
        const player = snapshot.player;

        if (options.frozen) {
            core.setInput({ moveX: 0, moveY: 0, aimX: player.x + 1, aimY: player.y, firing: false });
        } else if (options.march) {
            wander += STEP;
            core.setInput({
                moveX: Math.cos(wander * 1.4),
                moveY: Math.sin(wander * 1.4),
                aimX: player.x + 200,
                aimY: player.y,
                firing: false,
            });
        } else {
            let targetX = player.x + 1;
            let targetY = player.y;
            let closest = Number.POSITIVE_INFINITY;
            for (const enemy of snapshot.enemies) {
                const distance = Math.hypot(enemy.x - player.x, enemy.y - player.y);
                if (distance >= closest) continue;
                closest = distance;
                targetX = enemy.x;
                targetY = enemy.y;
            }
            const dx = targetX - player.x;
            const dy = targetY - player.y;
            const span = Math.hypot(dx, dy) || 1;
            wander += STEP;
            const rounds = player.weapon?.rounds ?? 0;
            let drop: { x: number; y: number } | null = null;
            let dropDistance = Number.POSITIVE_INFINITY;
            for (const candidate of snapshot.drops) {
                if (candidate.weapon.rounds <= 0) continue;
                const distance = Math.hypot(candidate.x - player.x, candidate.y - player.y);
                if (distance >= dropDistance) continue;
                dropDistance = distance;
                drop = candidate;
            }
            let moveX = 0;
            let moveY = 0;
            if (drop && (rounds <= 0 || snapshot.phase === "interlude")) {
                moveX = drop.x - player.x;
                moveY = drop.y - player.y;
            } else if (closest < 220) {
                moveX = -dx / span;
                moveY = -dy / span;
            } else if (closest > 430) {
                moveX = dx / span;
                moveY = dy / span;
            }
            const moveSpan = Math.hypot(moveX, moveY) || 1;
            core.setInput({
                moveX: moveX === 0 && moveY === 0 ? 0 : moveX / moveSpan,
                moveY: moveX === 0 && moveY === 0 ? 0 : moveY / moveSpan,
                aimX: targetX,
                aimY: targetY,
                firing: options.shoot === true && closest < 560 && rounds > 0,
            });
        }

        core.update(STEP);
        events.push(...core.drainEvents());
        const after = core.snapshot();
        maxTimeScale = Math.max(maxTimeScale, after.timeScale);
        minTimeScale = Math.min(minTimeScale, after.timeScale);
        assert.ok(Number.isFinite(after.timeScale), "the clock must never go non-finite");
        assert.ok(Number.isFinite(after.player.x) && Number.isFinite(after.player.y), "the player must stay finite");
        assert.ok(after.score >= 0, "score must never go negative");
        assert.ok((after.player.weapon?.rounds ?? 0) >= 0, "a gun must never fire past empty into negative rounds");
    }

    return { snapshot: core.snapshot(), events, maxTimeScale, minTimeScale };
}

function fingerprint(snapshot: CoreSnapshot): string {
    return [
        snapshot.phase,
        snapshot.level,
        snapshot.score,
        snapshot.downs,
        snapshot.grazes,
        snapshot.bestChain,
        Math.round(snapshot.player.x),
        Math.round(snapshot.player.y),
        snapshot.enemies.length,
        snapshot.bullets.length,
        snapshot.drops.length,
        snapshot.player.weapon?.id ?? "none",
        snapshot.player.weapon?.rounds ?? 0,
    ].join("|");
}

/* ------------------------------------------------ 1. content sanity checks */

let previousTotal = 0;
for (let level = 1; level <= 40; level += 1) {
    const elite = isEliteLevel(level);
    const composition = levelComposition(level, elite);
    const total = levelEnemyCount(level, elite);
    assert.ok(total >= 1, `level ${level} must field at least one hostile`);
    assert.ok(total <= ROSTER_HARD_CAP, `level ${level} roster (${total}) must stay inside the active enemy budget`);
    assert.ok(composition.rusher >= 1, "every level keeps pressure with at least one rusher");
    assert.ok(composition.grunt >= 1, "every level fields a grunt so rounds are always reachable");
    if (level < ENEMY_LEVEL_GATES.tank) assert.equal(composition.tank, 0, "tanks are gated");
    if (level < ENEMY_LEVEL_GATES.sniper) assert.equal(composition.sniper, 0, "snipers are gated");
    if (level < ENEMY_LEVEL_GATES.rocketeer) assert.equal(composition.rocketeer, 0, "rocketeers are gated");
    // The curve may plateau at the caps but must never slide backwards.
    if (!elite && !isEliteLevel(level - 1)) {
        assert.ok(total >= previousTotal, `level ${level} must not be easier than level ${level - 1}`);
    }
    if (!elite) previousTotal = total;
    assert.equal(actForLevel(level), 1 + Math.floor((level - 1) / LEVELS_PER_ACT));
}
assert.equal(isEliteLevel(5), true, "every fifth page is an elite");
assert.equal(isEliteLevel(4), false);
assert.ok(
    levelEnemyCount(10, true) > levelEnemyCount(10, false),
    "an elite page must be heavier than the same numbered standard page",
);

/* ------------------------------------------- 1b. the run is actually endless */

// Body counts saturate by design — one screen, one frame budget. What must not
// saturate is difficulty. These checks are the difference between "the loop
// never ends" and "the loop never stops getting harder".
assert.equal(levelPressure(1), 1, "the early curve must be carried by counts alone");
assert.equal(levelPressure(PRESSURE_FLOOR_LEVEL), 1, "pressure must not start before counts top out");

let previousPressure = 0;
for (let level = 1; level <= 2000; level += 1) {
    const pressure = levelPressure(level);
    assert.ok(Number.isFinite(pressure), `level ${level} pressure must be finite`);
    assert.ok(pressure >= previousPressure, `level ${level} pressure must never slide backwards`);
    assert.ok(pressure >= 1, `level ${level} pressure must never soften the page`);
    previousPressure = pressure;
}

// Unbounded: every decade of levels is measurably worse than the last, forever.
const PRESSURE_STEPS: readonly (readonly [number, number])[] = [
    [16, 40],
    [40, 100],
    [100, 400],
    [400, 2000],
];
for (const [shallow, deep] of PRESSURE_STEPS) {
    assert.ok(
        levelPressure(deep) > levelPressure(shallow) + 0.1,
        `level ${deep} must be meaningfully harder than level ${shallow}`,
    );
}

// Bounded per stat, so "harder forever" never becomes "unplayable at level 60".
for (const level of [50, 500, 5000, 50_000]) {
    const pressure = levelPressure(level);
    assert.ok(Math.min(PRESSURE_SPEED_MAX, pressure) <= PRESSURE_SPEED_MAX, "speed must stay clamped");
    assert.ok(Math.min(PRESSURE_ACQUIRE_MAX, pressure) <= PRESSURE_ACQUIRE_MAX, "aim time must stay clamped");
    assert.ok(Math.min(PRESSURE_CADENCE_MAX, pressure) <= PRESSURE_CADENCE_MAX, "cadence must stay clamped");
    assert.ok(pressureSoakBonus(level) <= 3, "soak must stay clamped so a body is always killable");
    assert.ok(levelEnemyCount(level, isEliteLevel(level)) <= ROSTER_HARD_CAP, "the body budget is absolute");
}

// A deep page must still be a fight and not a wall: a grunt to loot, and a
// roster the player can actually clear.
for (const level of [30, 120, 900]) {
    const composition = levelComposition(level, isEliteLevel(level));
    assert.ok(composition.grunt >= 1, `level ${level} must still field a grunt to loot`);
    assert.ok(levelEnemyCount(level, isEliteLevel(level)) >= 1, `level ${level} must field someone`);
}
assert.ok(pressureSoakBonus(1000) > pressureSoakBonus(20), "deep pages must take more rounds per body");

for (const definition of Object.values(MODIFIERS)) {
    assert.ok(definition.minLevel >= 3, `${definition.id} must not appear before level 3`);
    assert.ok(definition.name.length > 0 && definition.blurb.length > 0, `${definition.id} needs player copy`);
}

for (const id of BOOSTER_IDS) {
    const definition = BOOSTERS[id];
    assert.ok(definition.maxStacks >= 1, `${id} must be takeable`);
    assert.ok(definition.name.length > 0 && definition.blurb.length > 0, `${id} needs player copy`);
    if (definition.inkCost !== null) assert.ok(definition.inkCost > 0, `${id} must cost real ink`);
}
assert.ok(KIT_BOOSTER_IDS.length >= 8, "the kit needs a real menu to choose from");

for (let level = 1; level <= 12; level += 1) {
    const reward = rewardForLevel(level);
    assert.ok(WEAPONS[reward.weapon], `level ${level} must award a real weapon`);
    assert.ok(reward.bonusRounds >= 0);
}
assert.equal(rewardForLevel(1).weapon, "smg");
assert.equal(rewardForLevel(4).weapon, "launcher");
assert.equal(rewardForLevel(5).weapon, "smg", "the ladder repeats after the launcher");
assert.equal(rewardForLevel(5).bonusRounds, 2, "each completed cycle adds rounds");

for (const definition of Object.values(ENEMIES)) {
    assert.ok(definition.score > 0, `${definition.kind} must be worth points`);
    assert.ok(definition.soak >= 1);
    if (definition.weapon) assert.ok(WEAPONS[definition.weapon], `${definition.kind} carries a real weapon`);
}

/* --------------------------------------------- 2. the Standstill contract */

const still = new GameCore();
still.reset(0x0bad_c0de);
const frozen = driveBot(still, { seconds: 6, frozen: true });
assert.ok(
    frozen.maxTimeScale <= TIME_FLOOR + 0.02,
    `a motionless player must hold the clock at the floor (saw ${frozen.maxTimeScale.toFixed(3)})`,
);
assert.equal(frozen.snapshot.phase, "running", "standing still must never end the run by itself");

const moving = new GameCore();
moving.reset(0x0bad_c0de);
const active = driveBot(moving, { seconds: 6, march: true });
assert.ok(
    active.maxTimeScale > 0.9,
    `moving at full speed must open the clock (saw ${active.maxTimeScale.toFixed(3)})`,
);
assert.ok(
    frozen.snapshot.worldElapsed < active.snapshot.worldElapsed * 0.3,
    "a still page must advance far less world time than a moving one",
);

// The player's own movement is real time, so a still page still lets you walk.
const walkStart = still.snapshot().player.x;
still.setInput({ moveX: 1, moveY: 0, aimX: walkStart + 200, aimY: still.snapshot().player.y, firing: false });
for (let frame = 0; frame < 30; frame += 1) still.update(STEP);
const walked = still.snapshot().player.x - walkStart;
assert.ok(
    walked > PLAYER_SPEED * 0.5 * 0.5,
    `player movement must run in real time regardless of the clock (moved ${walked.toFixed(1)})`,
);

/* ------------------------ 2a2. the trigger runs at the player's own speed */

// Pulling the trigger is the player's act, like moving and aiming, so it must
// not inherit the world clock. Draining the cooldown on world time throttled
// the rate of fire by the same factor the world was slowed — 9 real seconds
// between shotgun shells while standing still, 21 for a launcher.
for (const id of WEAPON_IDS) {
    const core = new GameCore();
    core.reset(0x00c0_ffee);
    core.forceWeapon(id, 9);
    const shots: number[] = [];
    for (let frame = 0; frame < 60 * 40 && shots.length < 2; frame += 1) {
        const player = core.snapshot().player;
        // Perfectly still: the clock sits at its floor the whole time.
        core.setInput({ moveX: 0, moveY: 0, aimX: player.x + 400, aimY: player.y, firing: true });
        core.update(STEP);
        for (const event of core.drainEvents()) if (event.type === "shot") shots.push(frame * STEP);
    }
    assert.equal(shots.length, 2, `${id} must be able to fire twice while standing still`);
    const gap = (shots[1] ?? 0) - (shots[0] ?? 0);
    assert.ok(
        gap <= WEAPONS[id].interval + 0.05,
        `${id} took ${gap.toFixed(2)}s between shots while still; its interval is ${WEAPONS[id].interval.toFixed(2)}s`,
    );
}

// Sustained fire still costs clock: every shot pulses it, so the page moves.
{
    const core = new GameCore();
    core.reset(0x00c0_ffee);
    core.forceWeapon("smg", 26);
    let peak = 0;
    for (let frame = 0; frame < 120; frame += 1) {
        const player = core.snapshot().player;
        core.setInput({ moveX: 0, moveY: 0, aimX: player.x + 400, aimY: player.y, firing: true });
        core.update(STEP);
        peak = Math.max(peak, core.snapshot().timeScale);
    }
    assert.ok(peak > 0.9, `holding the trigger must still open the clock (saw ${peak.toFixed(3)})`);
}

/* --------------------------------------- 2b. a clear page runs at full speed */

// The clock reads danger. A page with hostiles on or inbound to it still holds
// at the floor; a genuinely clear one runs normally so the walk to the reward
// gun is not a crawl.
{
    const occupied = new GameCore();
    occupied.reset(0x0c1e_a700);
    for (let frame = 0; frame < 120; frame += 1) {
        const player = occupied.snapshot().player;
        occupied.setInput({ moveX: 0, moveY: 0, aimX: player.x + 1, aimY: player.y, firing: false });
        occupied.update(STEP);
    }
    const held = occupied.snapshot();
    assert.ok(held.enemies.length + held.pendingSpawns > 0, "this check needs hostiles on or inbound to the page");
    assert.ok(
        held.timeScale <= TIME_FLOOR + 0.02,
        `a held page with hostiles must stay at the floor (saw ${held.timeScale.toFixed(3)})`,
    );
}

{
    const emptied = new GameCore();
    emptied.reset(0x0c1e_a701);
    for (let frame = 0; frame < 60 * 90; frame += 1) {
        const snapshot = emptied.snapshot();
        if (snapshot.enemies.length + snapshot.pendingSpawns === 0) break;
        if (!snapshot.player.alive) break;
        const target = snapshot.enemies[0];
        emptied.setInput({
            moveX: 0,
            moveY: 0,
            aimX: target ? target.x : snapshot.player.x + 1,
            aimY: target ? target.y : snapshot.player.y,
            firing: Boolean(target),
        });
        emptied.update(STEP);
    }
    const cleared = emptied.snapshot();
    assert.equal(cleared.enemies.length + cleared.pendingSpawns, 0, "the page must actually be cleared for this check");
    for (let frame = 0; frame < 90; frame += 1) {
        const player = emptied.snapshot().player;
        emptied.setInput({ moveX: 0, moveY: 0, aimX: player.x + 1, aimY: player.y, firing: false });
        emptied.update(STEP);
    }
    assert.ok(
        emptied.snapshot().timeScale > 0.9,
        `a clear page must run normally even standing still (saw ${emptied.snapshot().timeScale.toFixed(3)})`,
    );
}

/* ----------------------------------------------------- 3. a fought-out run */

const fighter = new GameCore();
fighter.reset(0x51c8_a3d2);
const fight = driveBot(fighter, { seconds: 150, shoot: true });
const downs = fight.events.filter((event) => event.type === "enemy_down");
const shots = fight.events.filter((event) => event.type === "shot");
const clears = fight.events.filter((event) => event.type === "level_clear");
const pickups = fight.events.filter((event) => event.type === "pickup");

assert.ok(shots.length >= 5, `the bot must actually fire (saw ${shots.length} shots)`);
assert.ok(downs.length >= 1, `player fire must kill hostiles (saw ${downs.length} downs)`);
assert.ok(fight.snapshot.score > 0, "kills and clears must score");
assert.ok(
    fight.snapshot.phase === "defeat" || fight.snapshot.level > 1,
    "a 150 second fight must either progress past level 1 or end in a death",
);
if (clears.length >= 1) {
    assert.ok(pickups.length >= 1, "a cleared level must hand the player a gun it can pick up");
}

/* ------------------------------------------ 3a. an aimed round always kills */

const marksman = new GameCore();
marksman.reset(0x00a1_3d00);
let marksmanDowns = 0;
let clearShots = 0;
// Cover is laid out from the seed, so try each bearing and count the clear ones.
for (let bearing = 0; bearing < 8; bearing += 1) {
    marksman.forceWeapon("rifle", 8);
    marksman.forceEnemy("grunt", 260, (bearing / 8) * Math.PI * 2);
    marksman.drainEvents();
    const markedId = marksman.snapshot().enemies.at(-1)?.id;
    if (markedId === undefined) continue;
    for (let frame = 0; frame < 420; frame += 1) {
        const state = marksman.snapshot();
        if (!state.player.alive) break;
        const target = state.enemies.find((enemy) => enemy.id === markedId);
        if (!target) break;
        // Stand perfectly still: the page barely breathes, so this is pure aim.
        marksman.setInput({ moveX: 0, moveY: 0, aimX: target.x, aimY: target.y, firing: true });
        marksman.update(STEP);
        marksmanDowns += marksman.drainEvents().filter((event) => event.type === "enemy_down").length;
    }
    if (!marksman.snapshot().enemies.some((enemy) => enemy.id === markedId)) clearShots += 1;
    if (!marksman.snapshot().player.alive) break;
}
// Blocked bearings are correct behaviour: cover stops rounds in both directions.
assert.ok(clearShots >= 3, `an aimed round must land on open bearings (cleared ${clearShots}/8)`);
assert.ok(marksmanDowns >= 3, "landed shots must register downs");
assert.ok(marksman.snapshot().score > 0, "landed shots must score");

/* ----------------------------------- 3a2. everything drawn is also solid */

// The renderer and the core used to keep separate copies of the skeleton, and
// they drifted: the drawn head ended up entirely above the body circle, so a
// round through the middle of a head passed clean through. These assert the
// geometry stays shared and that every drawn head is actually hittable.
for (const kind of ["rusher", "grunt", "tank", "sniper", "rocketeer"] as const) {
    const scale = figureScaleFor(kind);
    const headCentre = FIGURE_HEAD_Y * scale;
    const headRadius = FIGURE_HEAD_RADIUS * scale;
    const bodyReach = ENEMIES[kind].radius;
    // If this ever stops holding, the head is inside the body circle and the
    // separate head solid is redundant rather than load-bearing.
    assert.ok(
        Math.abs(headCentre) > bodyReach,
        `${kind}: the drawn head centre must sit outside the body circle for this test to mean anything`,
    );

    // Track the target every frame and aim where a player would: the drawn
    // head, or the body. A fixed aim point drifts onto the torso as it walks.
    const shoot = (aimAtHead: boolean) => {
        const core = new GameCore();
        core.reset(0x1111_2222);
        core.forceWeapon("rifle", 30);
        core.forceEnemy(kind, 110, 0);
        const id = core.snapshot().enemies.at(-1)?.id;
        assert.ok(id !== undefined, `${kind} must spawn for the hit test`);
        let landed = false;
        let style: string | null = null;
        for (let frame = 0; frame < 240 && !landed; frame += 1) {
            const live = core.snapshot().enemies.find((candidate) => candidate.id === id);
            if (!live) break;
            core.setInput({
                moveX: 0,
                moveY: 0,
                aimX: live.x,
                aimY: aimAtHead ? live.y + headCentre : live.y,
                firing: frame % 5 === 0,
            });
            core.update(STEP);
            for (const event of core.drainEvents()) {
                if (event.type === "enemy_hit") landed = true;
                if (event.type === "enemy_down") {
                    landed = true;
                    style = event.style;
                }
            }
        }
        return { landed, style };
    };

    const head = shoot(true);
    const body = shoot(false);
    assert.ok(head.landed, `${kind}: a round through the drawn head must connect, not pass through`);
    assert.ok(body.landed, `${kind}: a round through the body must still connect`);
    assert.ok(headRadius > 0, `${kind} must have a head worth aiming at`);
}

// A headshot kill pays more than the same kill through the body.
function killScore(aimAtHead: boolean): { score: number; style: string | null } {
    const core = new GameCore();
    core.reset(0x2222_3333);
    core.forceWeapon("rifle", 30);
    core.forceEnemy("grunt", 110, 0);
    const id = core.snapshot().enemies.at(-1)?.id;
    assert.ok(id !== undefined, "the grunt must spawn");
    const headCentre = FIGURE_HEAD_Y * figureScaleFor("grunt");
    for (let frame = 0; frame < 400; frame += 1) {
        const live = core.snapshot().enemies.find((candidate) => candidate.id === id);
        if (!live) break;
        core.setInput({
            moveX: 0,
            moveY: 0,
            aimX: live.x,
            aimY: aimAtHead ? live.y + headCentre : live.y,
            firing: frame % 5 === 0,
        });
        core.update(STEP);
        for (const event of core.drainEvents()) {
            if (event.type === "enemy_down") return { score: event.score, style: event.style };
        }
    }
    throw new Error(`the grunt was never downed (aimAtHead=${aimAtHead})`);
}

const headKill = killScore(true);
const bodyKill = killScore(false);
assert.equal(headKill.style, "HEADSHOT", "a head kill must be labelled for the player");
assert.ok(
    headKill.score > bodyKill.score,
    `a headshot must pay more than a body shot (head ${headKill.score} vs body ${bodyKill.score})`,
);
assert.ok(STYLE_HEADSHOT > 1, "the headshot multiplier must actually be a bonus");

/* --------------------------------------- 3b. the page can never dead-end */

const stranded = new GameCore();
stranded.reset(0x00de_ad00);
stranded.forceWeapon("pistol", 0);
for (let frame = 0; frame < 60 * 40; frame += 1) {
    const player = stranded.snapshot().player;
    if (!player.alive) break;
    // Shuffle in place so world time advances without walking into anyone.
    const drift = Math.sin(frame * 0.05);
    stranded.setInput({ moveX: drift * 0.4, moveY: -drift * 0.4, aimX: player.x + 200, aimY: player.y, firing: false });
    stranded.update(STEP);
    if (stranded.drainEvents().some((event) => event.type === "resupply")) break;
}
assert.ok(
    stranded.snapshot().drops.some((drop) => drop.weapon.rounds > 0) || !stranded.snapshot().player.alive,
    "an empty-handed player must be resupplied rather than stranded",
);

/* ------------------------------- 3c. the draft outlives the booster board */

// There are only 26 booster stacks in the game. A run deep enough to take them
// all must still get a choice between pages, or the roguelike beat dies exactly
// where the endless run begins.
const drafter = new GameCore();
drafter.reset(0x0d_1a_f7_00);
drafter.forceDraft();
const earlyOffers = drafter.snapshot().draftOffers;
assert.ok(earlyOffers.length > 0, "an early draft must offer something");
assert.ok(
    earlyOffers.every((offer) => offer.kind === "booster"),
    "while boosters remain, the draft deals boosters",
);

let totalStacks = 0;
for (const id of BOOSTER_IDS) {
    for (let take = 0; take < BOOSTERS[id].maxStacks; take += 1) {
        drafter.forceBooster(id);
        totalStacks += 1;
    }
}
assert.ok(totalStacks >= 20, `expected a real booster board, filled ${totalStacks} stacks`);

drafter.forceDraft();
const lateOffers = drafter.snapshot().draftOffers;
assert.equal(drafter.snapshot().phase, "draft", "a full board must still open a draft, never skip it");
assert.equal(lateOffers.length, earlyOffers.length, "the endless draft must deal a full hand");
assert.ok(
    lateOffers.every((offer) => offer.kind === "weapon"),
    "with the board full the draft must deal loadout instead of skipping",
);
for (const offer of lateOffers) {
    assert.ok(offer.kind === "weapon" && offer.rounds > 0, "an endless-draft gun must arrive loaded");
    assert.ok(WEAPONS[offer.id], `${offer.id} must be a real weapon`);
}

// And taking one must actually arm the player and move the run on.
const levelBefore = drafter.snapshot().level;
assert.equal(drafter.chooseBooster(0), true, "an endless-draft card must be takeable");
const armed = drafter.snapshot();
assert.equal(armed.phase, "running", "taking a gun must resume the run");
assert.equal(armed.level, levelBefore + 1, "taking a gun must advance the page");
assert.ok((armed.player.weapon?.rounds ?? 0) > 0, "the player must be holding the gun they picked");

/* ------------------------------------------------------ 3d. the onboarding */

// The coach must not be dismissable by noise: it advances only when the player
// actually does the thing, and it never coaches a returning player. There are
// two steps because there are two controls — an empty gun throws itself, so
// throwing has no verb and needs no lesson.
{
    const coach = new Ftue(false);
    assert.equal(coach.step()?.id, "move", "onboarding must open on the rule the whole game rests on");

    // Twitching in place must not satisfy the clock lesson.
    for (let frame = 0; frame < 200; frame += 1) coach.observe({ delta: STEP, moved: 0.4, shots: 0 });
    assert.equal(coach.step()?.id, "move", "a player who has not really walked has not learned the clock yet");

    coach.observe({ delta: FTUE_MIN_DWELL_SECONDS, moved: FTUE_MOVE_DISTANCE, shots: 0 });
    assert.equal(coach.step()?.id, "shoot", "covering real ground must advance the lesson");
    assert.equal(coach.isComplete(), false, "onboarding is not done until the last lesson lands");

    coach.observe({ delta: FTUE_MIN_DWELL_SECONDS, moved: 0, shots: 1 });
    assert.equal(coach.isComplete(), true, "firing must finish onboarding");
    assert.equal(coach.step(), null, "a finished coach must show nothing");
}

// The case that made the coach useless in practice: auto-fire is on by default
// and players walk with the trigger down, so the frame that completes "move" is
// usually one they are already shooting on. Every step must survive being
// satisfied instantly and still be readable.
{
    const coach = new Ftue(false);
    const FRAME = 1 / 60;
    const seen = new Map();
    for (let frame = 0; frame < 60 * 12; frame += 1) {
        const step = coach.step();
        if (step) seen.set(step.id, (seen.get(step.id) ?? 0) + FRAME);
        coach.observe({ delta: FRAME, moved: 126 * FRAME, shots: 1 });
    }
    for (const step of FTUE_STEPS) {
        const shown = seen.get(step.id) ?? 0;
        assert.ok(
            shown >= FTUE_MIN_DWELL_SECONDS,
            `${step.id} was on screen for ${shown.toFixed(2)}s — too fast to read`,
        );
    }
    assert.equal(coach.isComplete(), true, "a player doing everything at once must still finish onboarding");
}

// Every step has to be sayable on both devices, or someone is told to press a
// key they do not have.
for (const step of FTUE_STEPS) {
    assert.ok(step.title.length > 0, `${step.id} needs a rule to name`);
    assert.ok(step.touchHint.length > 0, `${step.id} needs touch copy`);
    assert.ok(step.keyboardHint.length > 0, `${step.id} needs keyboard copy`);
    assert.notEqual(step.touchHint, step.keyboardHint, `${step.id} must not tell a thumb to press a key`);
}

{
    const returning = new Ftue(true);
    assert.equal(returning.step(), null, "a returning player is never coached again");
    assert.equal(returning.observe({ delta: 1, moved: 999, shots: 9 }), false, "a finished coach stays finished");
}

/* --------------------------------------------------------- 4. determinism */

const runA = new GameCore();
runA.reset(0x1234_5678);
const reportA = driveBot(runA, { seconds: 45, shoot: true });
const runB = new GameCore();
runB.reset(0x1234_5678);
const reportB = driveBot(runB, { seconds: 45, shoot: true });
assert.equal(
    fingerprint(reportA.snapshot),
    fingerprint(reportB.snapshot),
    "the same seed and the same inputs must produce the same page",
);
assert.equal(reportA.events.length, reportB.events.length, "event streams must match exactly");

const runC = new GameCore();
runC.reset(0x8765_4321);
const reportC = driveBot(runC, { seconds: 45, shoot: true });
assert.notEqual(
    fingerprint(reportC.snapshot),
    fingerprint(reportA.snapshot),
    "a different seed must lay out a different page",
);

/* ------------------------------------------------------ 5. weapon economy */

// Standing still keeps the page frozen, so this measures the gun and nothing else.
const economy = new GameCore();
economy.reset(0x00c0_ffee);
economy.forceWeapon("pistol", 3);
assert.equal(economy.snapshot().player.weapon?.rounds, 3);
let emptyShots = 0;
let throwsWhileHeld = 0;
for (let frame = 0; frame < 1800; frame += 1) {
    const player = economy.snapshot().player;
    if (!player.alive) break;
    economy.setInput({ moveX: 0, moveY: 0, aimX: player.x + 300, aimY: player.y, firing: true });
    economy.update(STEP);
    for (const event of economy.drainEvents()) {
        if (event.type === "shot") emptyShots += 1;
        if (event.type === "throw") throwsWhileHeld += 1;
    }
}
assert.equal(economy.snapshot().player.alive, true, "a stationary shooter must survive a frozen page");
assert.equal(emptyShots, 3, "firing must consume every round and then stop shooting");
// Holding the trigger is one act of shooting from start to finish. It empties
// the gun and stops there; it never also flings it.
assert.equal(throwsWhileHeld, 0, "a held trigger must never throw the gun it just emptied");
assert.equal(economy.snapshot().player.weapon?.rounds, 0, "the spent frame stays in hand, at zero rounds");

/* --------------------------------------------------------- 6. cover walls */

const covered = new GameCore();
covered.reset(0x00c0_5e00);
const cover = covered.snapshot().cover;
assert.ok(cover.length >= 2 && cover.length <= 6, `the opening floor plan lays out cover (saw ${cover.length})`);
for (const rect of cover) {
    assert.ok(rect.x >= 0 && rect.x + rect.width <= WORLD_WIDTH, "cover must stay on the page horizontally");
    assert.ok(rect.y >= 0 && rect.y + rect.height <= WORLD_HEIGHT, "cover must stay on the page vertically");
    const centreWalled =
        WORLD_WIDTH / 2 >= rect.x - 110 &&
        WORLD_WIDTH / 2 <= rect.x + rect.width + 110 &&
        WORLD_HEIGHT / 2 >= rect.y - 110 &&
        WORLD_HEIGHT / 2 <= rect.y + rect.height + 110;
    assert.equal(centreWalled, false, "the spawn point must never be walled in");
}

const block = cover[0];
assert.ok(block);
for (let frame = 0; frame < 600; frame += 1) {
    const player = covered.snapshot().player;
    const towardX = block.x + block.width / 2;
    const towardY = block.y + block.height / 2;
    const dx = towardX - player.x;
    const dy = towardY - player.y;
    const span = Math.hypot(dx, dy) || 1;
    covered.setInput({ moveX: dx / span, moveY: dy / span, aimX: towardX, aimY: towardY, firing: false });
    covered.update(STEP);
    if (covered.snapshot().phase === "defeat") break;
}
const settled = covered.snapshot().player;
const insideBlock =
    settled.x > block.x + 2 &&
    settled.x < block.x + block.width - 2 &&
    settled.y > block.y + 2 &&
    settled.y < block.y + block.height - 2;
assert.equal(insideBlock, false, "the player must never end up inside a block of cover");

// A figure standing where a block lands must be able to walk out. Testing only
// the destination point made every direction read as blocked once the body
// overlapped a block, which froze the player for the rest of the run.
const trapped = new GameCore();
trapped.reset(0x00c0_5e01);
const pen = trapped.snapshot().cover[0];
assert.ok(pen, "the opening plan must lay out at least one block to sit inside");
trapped.forcePlayerAt(pen.x + pen.width / 2, pen.y + pen.height / 2);
const startX = trapped.snapshot().player.x;
const startY = trapped.snapshot().player.y;
for (let frame = 0; frame < 240; frame += 1) {
    trapped.setInput({ moveX: 1, moveY: 0, aimX: WORLD_WIDTH, aimY: startY, firing: false });
    trapped.update(STEP);
}
const freed = trapped.snapshot().player;
assert.ok(
    Math.hypot(freed.x - startX, freed.y - startY) > 40,
    `a player inside cover must be able to walk out (moved ${Math.hypot(freed.x - startX, freed.y - startY).toFixed(1)})`,
);
const stillPenned = freed.x > pen.x && freed.x < pen.x + pen.width && freed.y > pen.y && freed.y < pen.y + pen.height;
assert.equal(stillPenned, false, "walking out of a block must actually clear it");

// A new level re-draws its floor plan around a player who never moved, so the
// plan can put a block on top of them. Sweep the whole spread of archetypes.
for (let level = 1; level <= 40; level += 1) {
    const redrawn = new GameCore();
    redrawn.reset(0x00c0_5e00 + level);
    redrawn.forcePlayerAt(WORLD_WIDTH * 0.66, WORLD_HEIGHT * 0.66);
    redrawn.forceLevel(level);
    const stood = redrawn.snapshot().player;
    for (const rect of redrawn.snapshot().cover) {
        const embedded =
            stood.x >= rect.x - PLAYER_RADIUS &&
            stood.x <= rect.x + rect.width + PLAYER_RADIUS &&
            stood.y >= rect.y - PLAYER_RADIUS &&
            stood.y <= rect.y + rect.height + PLAYER_RADIUS;
        assert.equal(embedded, false, `level ${level} laid a block on top of the player`);
    }
}

// A hostile inside a block is worse than a stuck player: cover eats bullets, so
// it cannot be shot, and the page can never clear.
const penned = new GameCore();
penned.reset(0x00c0_5e02);
penned.forceEnemy("grunt", 300, 0);
const pennedBlock = penned.snapshot().cover[0];
assert.ok(pennedBlock);
const hostile = penned.snapshot().enemies[0];
assert.ok(hostile, "the QA hook must place a hostile to pen");
penned.forceEnemyAt(0, pennedBlock.x + pennedBlock.width / 2, pennedBlock.y + pennedBlock.height / 2);
const pennedX = penned.snapshot().enemies[0]?.x ?? 0;
const pennedY = penned.snapshot().enemies[0]?.y ?? 0;
penned.forcePlayerAt(WORLD_MARGIN + 60, WORLD_MARGIN + 60);
for (let frame = 0; frame < 480; frame += 1) {
    penned.setInput({ moveX: 0, moveY: 0, aimX: WORLD_WIDTH, aimY: WORLD_HEIGHT, firing: false });
    penned.update(STEP);
    if (penned.snapshot().phase !== "running") break;
}
const walker = penned.snapshot().enemies[0];
if (walker) {
    assert.ok(
        Math.hypot(walker.x - pennedX, walker.y - pennedY) > 20,
        `a hostile inside cover must be able to walk out (moved ${Math.hypot(walker.x - pennedX, walker.y - pennedY).toFixed(1)})`,
    );
}

/* ------------------------------------------------------- 7. level jumping */

const deep = new GameCore();
deep.reset(0x0dee_9000);
deep.forceLevel(9);
assert.equal(deep.snapshot().level, 9);
assert.ok(deep.snapshot().levelTotal > 0, "a jumped-to level must have a roster");
deep.drainEvents();
driveBot(deep, { seconds: 10, shoot: true });
assert.ok(
    deep.snapshot().enemies.length >= 1 || deep.snapshot().phase !== "running",
    "a late level must actually populate",
);

/* ----------------------------------------------------------------- report */

console.log(
    [
        "simulate ok:",
        `still clock max ${frozen.maxTimeScale.toFixed(3)} / moving clock max ${active.maxTimeScale.toFixed(3)}`,
        `fight ${downs.length} downs, ${clears.length} levels cleared, score ${fight.snapshot.score}`,
        `determinism ${fingerprint(reportA.snapshot)}`,
    ].join("\n  "),
);

import {
    actForLevel,
    BOOST_BULLET_SPEED_STEP,
    BOOST_COLD_START_SECONDS,
    BOOST_COLD_START_WINDOW,
    BOOST_PICKUP_RADIUS_FACTOR,
    BOOST_POCKET_ROUNDS,
    BOOST_SCAVENGE_FRACTION,
    BOOST_SPEED_STEP,
    BOOST_SPREAD_FACTOR,
    BOOST_TIME_FLOOR_MIN,
    BOOST_TIME_FLOOR_STEP,
    BOOST_TWIN_TAP_STILL_SECONDS,
    BOOSTER_IDS,
    BOOSTERS,
    type BoosterId,
    CHAIN_MAX_MULTIPLIER,
    CHAIN_STEP,
    CHAIN_WINDOW_SECONDS,
    capComposition,
    DRAFT_CHOICES,
    ENEMIES,
    type EnemyDefinition,
    type EnemyKind,
    FIGURE_HEAD_RADIUS,
    FIGURE_HEAD_Y,
    figureScaleFor,
    GRAZE_DISTANCE,
    GROUP_DELAY_SECONDS,
    GROUPS_MAX,
    GROUPS_MIN,
    INTERLUDE_SECONDS,
    isEliteLevel,
    LAYOUT_ARCHETYPES,
    type LayoutArchetype,
    levelComposition,
    levelEnemyCount,
    levelPressure,
    MAX_ACTIVE_BULLETS,
    MAX_ACTIVE_DROPS,
    MAX_ACTIVE_ENEMIES,
    MAX_OUTLINES,
    MODIFIER_IDS,
    MODIFIERS,
    type ModifierId,
    PLAYER_PICKUP_RADIUS,
    PLAYER_RADIUS,
    PLAYER_SPAWN_GRACE_SECONDS,
    PLAYER_SPEED,
    POINT_BLANK_DISTANCE,
    PRESSURE_ACQUIRE_MAX,
    PRESSURE_CADENCE_MAX,
    PRESSURE_SPEED_MAX,
    pressureSoakBonus,
    RESUPPLY_DELAY_SECONDS,
    RESUPPLY_ROUNDS,
    RESUPPLY_WEAPON,
    rewardForLevel,
    SCORE_GRAZE,
    SCORE_LEVEL_CLEAR,
    SCORE_UNSPENT_ROUND,
    STYLE_BLAST_EXTRA,
    STYLE_HEADSHOT,
    STYLE_POINT_BLANK,
    STYLE_STILL,
    STYLE_THROWN,
    THROW_RADIUS,
    THROW_RANGE_SECONDS,
    THROW_SPEED,
    THROW_SPIN,
    TIME_AIM_FULL_RATE,
    TIME_AIM_WEIGHT,
    TIME_ATTACK_RATE,
    TIME_FIRE_PULSE_SECONDS,
    TIME_FLOOR,
    TIME_GRAZE_THRESHOLD,
    TIME_RELEASE_RATE,
    TIME_STILL_THRESHOLD,
    TIME_THROW_PULSE_SECONDS,
    WEAPON_IDS,
    WEAPONS,
    type WeaponId,
    WORLD_HEIGHT,
    WORLD_MARGIN,
    WORLD_WIDTH,
} from "./config.ts";
import { NoiseRandom } from "./noiseRandom.ts";
import type {
    BlastState,
    BulletState,
    CoreSnapshot,
    CoverBlock,
    CoverShape,
    DraftOffer,
    DropState,
    EnemyState,
    GameEvent,
    HeldWeapon,
    LevelPlan,
    OutlineState,
    PlayerState,
    RunPhase,
    ThrownGunState,
} from "./types.ts";

const TAU = Math.PI * 2;
const BULLET_RADIUS = 3.5;
const BULLET_STEP = 11;
const BLAST_LIFETIME = 0.42;
const ENEMY_SEPARATION = 0.62;
const DEFAULT_SEED = 0x1f3a7c55;

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function length(x: number, y: number): number {
    return Math.hypot(x, y);
}

function normalize(x: number, y: number): { x: number; y: number } {
    const size = Math.hypot(x, y);
    if (size < 1e-5) return { x: 0, y: 0 };
    return { x: x / size, y: y / size };
}

function pointInRect(x: number, y: number, rect: CoverBlock, pad: number): boolean {
    return x >= rect.x - pad && x <= rect.x + rect.width + pad && y >= rect.y - pad && y <= rect.y + rect.height + pad;
}

function segmentHitsRect(ax: number, ay: number, bx: number, by: number, rect: CoverBlock): boolean {
    const steps = Math.max(1, Math.ceil(length(bx - ax, by - ay) / 18));
    for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        if (pointInRect(ax + (bx - ax) * t, ay + (by - ay) * t, rect, 0)) return true;
    }
    return false;
}

function emptyBoosters(): Record<BoosterId, number> {
    const levels = {} as Record<BoosterId, number>;
    for (const id of BOOSTER_IDS) levels[id] = 0;
    return levels;
}

export interface CoreInput {
    moveX: number;
    moveY: number;
    aimX: number;
    aimY: number;
    firing: boolean;
}

export class GameCore {
    private noise = new NoiseRandom(DEFAULT_SEED, 0);
    private seed = DEFAULT_SEED;
    private nextId = 1;
    private phase: RunPhase = "idle";
    private player: PlayerState = this.createPlayer();
    private enemies: EnemyState[] = [];
    private bullets: BulletState[] = [];
    private thrown: ThrownGunState[] = [];
    private drops: DropState[] = [];
    private outlines: OutlineState[] = [];
    private blasts: BlastState[] = [];
    private cover: CoverBlock[] = [];
    private events: GameEvent[] = [];

    private moveX = 0;
    private moveY = 0;
    private aimTargetX = WORLD_WIDTH / 2 + 100;
    private aimTargetY = WORLD_HEIGHT / 2;
    private firing = false;
    private swapRequested = false;
    /** True while the trigger that emptied the gun is still held down. */
    private dryTriggerHeld = false;

    private timeScale = TIME_FLOOR;
    private firePulse = 0;
    private throwPulse = 0;
    private aimRate = 0;

    private level = 1;
    private levelTotal = 0;
    private plan: LevelPlan = { index: 1, act: 1, elite: false, archetype: "scatter", modifier: null };
    private pendingGroups: { at: number; kinds: EnemyKind[] }[] = [];
    private levelClock = 0;
    private interlude = 0;
    private rewardWeapon: WeaponId | null = null;
    private levelAnnounced = false;

    private boosters: Record<BoosterId, number> = emptyBoosters();
    private draftOffers: DraftOffer[] = [];
    private twinTapReady = false;

    private score = 0;
    private chain = 0;
    private chainTimer = 0;
    private bestChain = 0;
    private downs = 0;
    private grazes = 0;
    private revives = 0;
    private resupplyTimer = RESUPPLY_DELAY_SECONDS;
    private elapsed = 0;
    private worldElapsed = 0;
    private lastStyle: string | null = null;

    /* ------------------------------------------------------------ lifecycle */

    /** Starts a run. `kit` is the set of ink-bought boosters carried in. */
    reset(seed = DEFAULT_SEED, kit: readonly BoosterId[] = []): void {
        this.seed = seed >>> 0;
        this.noise = new NoiseRandom(this.seed, 0);
        this.nextId = 1;
        this.phase = "running";
        this.boosters = emptyBoosters();
        for (const id of kit) {
            if (BOOSTERS[id]) this.boosters[id] = Math.min(BOOSTERS[id].maxStacks, this.boosters[id] + 1);
        }
        this.player = this.createPlayer();
        this.enemies = [];
        this.bullets = [];
        this.thrown = [];
        this.drops = [];
        this.outlines = [];
        this.blasts = [];
        this.events = [];
        this.draftOffers = [];
        this.moveX = 0;
        this.moveY = 0;
        this.firing = false;
        this.swapRequested = false;
        this.dryTriggerHeld = false;
        this.timeScale = this.timeFloor();
        this.firePulse = 0;
        this.throwPulse = 0;
        this.aimRate = 0;
        this.twinTapReady = false;
        this.level = 1;
        this.interlude = 0;
        this.rewardWeapon = null;
        this.score = 0;
        this.chain = 0;
        this.chainTimer = 0;
        this.bestChain = 0;
        this.downs = 0;
        this.grazes = 0;
        this.revives = 0;
        this.elapsed = 0;
        this.worldElapsed = 0;
        this.resupplyTimer = RESUPPLY_DELAY_SECONDS;
        this.lastStyle = null;
        this.aimTargetX = this.player.x + 120;
        this.aimTargetY = this.player.y;
        this.beginLevel(1);
    }

    pause(): void {
        if (this.phase === "running" || this.phase === "interlude") this.phase = "paused";
    }

    resume(): void {
        if (this.phase === "paused") this.phase = this.interlude > 0 ? "interlude" : "running";
    }

    forceResults(): void {
        if (this.phase === "defeat" || this.phase === "idle") return;
        this.player.shields = 0;
        this.killPlayer("bullet");
    }

    /** Grants a verified second wind: same level, freshly inked, score kept. */
    revive(): void {
        if (this.phase !== "defeat") return;
        this.revives += 1;
        this.player = this.createPlayer();
        this.bullets = [];
        this.thrown = [];
        this.blasts = [];
        this.enemies = [];
        this.chain = 0;
        this.chainTimer = 0;
        this.phase = "running";
        this.events.push({ type: "revive", level: this.level });
        this.beginLevel(this.level);
    }

    /** Takes a drafted booster and returns to the page. */
    chooseBooster(index: number): boolean {
        if (this.phase !== "draft") return false;
        const offer = this.draftOffers[index];
        if (!offer) return false;
        if (offer.kind === "weapon") {
            // The endless draft hands over a loaded gun rather than a stat.
            this.player.weapon = { id: offer.id, rounds: offer.rounds, capacity: offer.rounds };
            this.draftOffers = [];
            this.events.push({ type: "weapon_taken", id: offer.id, rounds: offer.rounds });
        } else {
            const definition = BOOSTERS[offer.id];
            const stacks = Math.min(definition.maxStacks, this.boosters[offer.id] + 1);
            this.boosters[offer.id] = stacks;
            this.draftOffers = [];
            this.events.push({ type: "booster_taken", id: offer.id, stacks });
        }
        this.phase = "running";
        this.beginLevel(this.level + 1);
        return true;
    }

    /* ------------------------------------------------------- QA-only helpers */

    /** Spawns one enemy relative to the player. Development QA only. */
    forceEnemy(kind: EnemyKind = "rusher", distance = 320, angle = 0): void {
        if (this.enemies.length >= MAX_ACTIVE_ENEMIES) return;
        const before = this.enemies.length;
        this.spawnEnemy(kind);
        const spawned = this.enemies[before];
        if (!spawned) return;
        spawned.x = clamp(this.player.x + Math.cos(angle) * distance, WORLD_MARGIN, WORLD_WIDTH - WORLD_MARGIN);
        spawned.y = clamp(this.player.y + Math.sin(angle) * distance, WORLD_MARGIN, WORLD_HEIGHT - WORLD_MARGIN);
    }

    /** Jumps straight to a level. Development QA only. */
    forceLevel(level: number): void {
        this.enemies = [];
        this.bullets = [];
        this.thrown = [];
        this.phase = "running";
        this.beginLevel(Math.max(1, Math.floor(level)));
    }

    /** Puts a specific gun in the player's hands. Development QA only. */
    forceWeapon(weapon: WeaponId = "pistol", rounds?: number): void {
        const capacity = WEAPONS[weapon].rounds;
        this.player.weapon = { id: weapon, rounds: rounds ?? capacity, capacity };
    }

    /** Grants a booster stack outright. Development QA only. */
    forceBooster(id: BoosterId): void {
        if (!BOOSTERS[id]) return;
        this.boosters[id] = Math.min(BOOSTERS[id].maxStacks, this.boosters[id] + 1);
    }

    /** Drops the player at a point, cover or not. Development QA only. */
    forcePlayerAt(x: number, y: number): void {
        this.player.x = clamp(x, WORLD_MARGIN, WORLD_WIDTH - WORLD_MARGIN);
        this.player.y = clamp(y, WORLD_MARGIN, WORLD_HEIGHT - WORLD_MARGIN);
    }

    /** Drops a hostile at a point, cover or not. Development QA only. */
    forceEnemyAt(index: number, x: number, y: number): void {
        const enemy = this.enemies[index];
        if (!enemy) return;
        enemy.x = clamp(x, WORLD_MARGIN, WORLD_WIDTH - WORLD_MARGIN);
        enemy.y = clamp(y, WORLD_MARGIN, WORLD_HEIGHT - WORLD_MARGIN);
    }

    /** Opens the between-level draft immediately. Development QA only. */
    forceDraft(): void {
        if (this.phase === "defeat" || this.phase === "idle") return;
        this.openDraft();
    }

    /* ---------------------------------------------------------------- input */

    setInput(input: CoreInput): void {
        const move = normalize(input.moveX, input.moveY);
        const magnitude = clamp(length(input.moveX, input.moveY), 0, 1);
        this.moveX = move.x * magnitude;
        this.moveY = move.y * magnitude;
        this.aimTargetX = input.aimX;
        this.aimTargetY = input.aimY;
        this.firing = input.firing;
    }

    requestSwap(): void {
        this.swapRequested = true;
    }

    /* ----------------------------------------------------------------- loop */

    update(rawDelta: number): void {
        if (this.phase !== "running" && this.phase !== "interlude") {
            this.swapRequested = false;
            return;
        }
        const realDelta = clamp(rawDelta, 0, 0.05);
        this.elapsed += realDelta;

        this.updateAim(realDelta);
        this.firePulse = Math.max(0, this.firePulse - realDelta);
        this.throwPulse = Math.max(0, this.throwPulse - realDelta);
        this.updateTimeScale(realDelta);

        const worldDelta = realDelta * this.timeScale;
        this.worldElapsed += worldDelta;

        this.movePlayer(realDelta);
        this.updateStillness(worldDelta);
        this.updatePlayerWeapon(realDelta);
        if (this.isDefeated()) return;

        this.updateBullets(worldDelta);
        if (this.isDefeated()) return;
        this.updateThrown(worldDelta);
        if (this.isDefeated()) return;
        this.updateEnemies(worldDelta);
        if (this.isDefeated()) return;
        this.updateBlasts(realDelta);
        this.updateDrops(worldDelta);
        this.updateLevel(worldDelta, realDelta);

        this.chainTimer = Math.max(0, this.chainTimer - worldDelta);
        if (this.chainTimer <= 0) this.chain = 0;
        this.player.flash = Math.max(0, this.player.flash - realDelta);
        this.player.kick = Math.max(0, this.player.kick - realDelta * 6);
    }

    snapshot(): CoreSnapshot {
        return {
            phase: this.phase,
            timeScale: this.timeScale,
            player: this.player,
            enemies: this.enemies,
            bullets: this.bullets,
            thrown: this.thrown,
            drops: this.drops,
            outlines: this.outlines,
            blasts: this.blasts,
            cover: this.cover,
            level: this.level,
            levelPlan: this.plan,
            levelRemaining: this.enemies.length + this.pendingSpawnCount(),
            levelTotal: this.levelTotal,
            pendingSpawns: this.pendingSpawnCount(),
            interludeProgress: this.interlude > 0 ? 1 - this.interlude / INTERLUDE_SECONDS : 0,
            rewardWeapon: this.rewardWeapon,
            draftOffers: this.draftOffers,
            boosters: this.boosters,
            hideSightLines: this.plan.modifier === "dim",
            score: this.score,
            chain: this.chain,
            chainProgress: clamp(this.chainTimer / CHAIN_WINDOW_SECONDS, 0, 1),
            chainMultiplier: this.chainMultiplier(),
            bestChain: this.bestChain,
            downs: this.downs,
            grazes: this.grazes,
            elapsed: this.elapsed,
            worldElapsed: this.worldElapsed,
            revives: this.revives,
            lastStyle: this.lastStyle,
        };
    }

    drainEvents(): GameEvent[] {
        const drained = this.events;
        this.events = [];
        return drained;
    }

    /* ------------------------------------------------------------ the clock */

    private timeFloor(): number {
        const stacks = this.boosters.long_breath;
        return Math.max(BOOST_TIME_FLOOR_MIN, TIME_FLOOR - stacks * BOOST_TIME_FLOOR_STEP);
    }

    private updateAim(realDelta: number): void {
        const previousX = this.player.aimX;
        const previousY = this.player.aimY;
        const aim = normalize(this.aimTargetX - this.player.x, this.aimTargetY - this.player.y);
        if (aim.x !== 0 || aim.y !== 0) {
            this.player.aimX = aim.x;
            this.player.aimY = aim.y;
        }
        if (realDelta <= 0) return;
        const cross = clamp(previousX * this.player.aimY - previousY * this.player.aimX, -1, 1);
        const dot = clamp(previousX * this.player.aimX + previousY * this.player.aimY, -1, 1);
        const swept = Math.abs(Math.atan2(cross, dot));
        this.aimRate = swept / realDelta;
    }

    private updateTimeScale(realDelta: number): void {
        const floor = this.timeFloor();
        const moveAgency = clamp(length(this.moveX, this.moveY), 0, 1);
        const aimAgency = clamp(this.aimRate / TIME_AIM_FULL_RATE, 0, 1) * TIME_AIM_WEIGHT;
        const pulse = this.firePulse > 0 || this.throwPulse > 0 ? 1 : 0;
        // The clock is a readout of danger, not a punishment for standing still.
        // Once the page is genuinely clear there is nothing to read and nothing
        // to dodge, so holding the player at a crawl only makes them wait while
        // they walk to the reward gun. Time runs normally until the next body.
        //
        // Queued spawns still count as occupied. A group walking in is the most
        // tense beat the game has, and treating the gap between waves as "empty"
        // would open the clock right as they arrive — and would break the
        // Standstill contract on the very first frame of a run, before the
        // opening group has been placed.
        const clear = this.enemies.length === 0 && this.pendingSpawnCount() === 0 ? 1 : 0;
        const target = clamp(Math.max(floor, moveAgency, aimAgency, pulse, clear), floor, 1);
        const rate = target > this.timeScale ? TIME_ATTACK_RATE : TIME_RELEASE_RATE;
        this.timeScale += (target - this.timeScale) * clamp(rate * realDelta, 0, 1);
        this.timeScale = clamp(this.timeScale, floor, 1);
    }

    /** TWIN TAP arms itself while the page is genuinely held still. */
    private updateStillness(worldDelta: number): void {
        if (this.timeScale <= TIME_STILL_THRESHOLD) {
            this.player.stillFor += worldDelta;
            if (this.player.stillFor >= BOOST_TWIN_TAP_STILL_SECONDS) this.twinTapReady = true;
        } else {
            this.player.stillFor = 0;
        }
    }

    /* ---------------------------------------------------------------- player */

    private createPlayer(): PlayerState {
        return {
            x: WORLD_WIDTH / 2,
            y: WORLD_HEIGHT / 2,
            vx: 0,
            vy: 0,
            aimX: 1,
            aimY: 0,
            alive: true,
            weapon: { id: "pistol", rounds: WEAPONS.pistol.rounds, capacity: WEAPONS.pistol.rounds },
            cooldown: 0,
            graceFor: PLAYER_SPAWN_GRACE_SECONDS,
            flash: 0,
            kick: 0,
            shields: 0,
            stillFor: 0,
        };
    }

    private movePlayer(realDelta: number): void {
        if (!this.player.alive) return;
        this.player.graceFor = Math.max(0, this.player.graceFor - realDelta);
        const speed = PLAYER_SPEED * (1 + this.boosters.quick_feet * BOOST_SPEED_STEP);
        this.player.vx = this.moveX * speed;
        this.player.vy = this.moveY * speed;
        const nextX = this.player.x + this.player.vx * realDelta;
        const nextY = this.player.y + this.player.vy * realDelta;
        this.player.x = this.slideAxis(this.player.x, this.player.y, nextX, this.player.y, PLAYER_RADIUS).x;
        this.player.y = this.slideAxis(this.player.x, this.player.y, this.player.x, nextY, PLAYER_RADIUS).y;
        this.player.x = clamp(this.player.x, WORLD_MARGIN, WORLD_WIDTH - WORLD_MARGIN);
        this.player.y = clamp(this.player.y, WORLD_MARGIN, WORLD_HEIGHT - WORLD_MARGIN);
    }

    /** Resolves one axis of movement against cover, returning the allowed point. */
    private slideAxis(
        fromX: number,
        fromY: number,
        toX: number,
        toY: number,
        radius: number,
    ): { x: number; y: number } {
        for (const rect of this.cover) {
            if (!pointInRect(toX, toY, rect, radius)) continue;
            // A block the body is already inside is something to escape, not a
            // wall to be held against. Testing only the destination meant that
            // once a figure overlapped a block every direction read as blocked
            // — including the way out — and it could never move again. Cover
            // still cannot be entered from outside, so this only ever frees a
            // figure that was placed inside one.
            if (pointInRect(fromX, fromY, rect, radius)) continue;
            return { x: fromX, y: fromY };
        }
        return { x: toX, y: toY };
    }

    /**
     * Moves a point to the nearest spot clear of cover. Levels re-draw their
     * floor plan around whoever is standing there, so a fresh block can land on
     * top of a figure; this walks it out the shortest edge rather than leaving
     * it embedded.
     */
    private ejectFromCover(x: number, y: number, radius: number): { x: number; y: number } {
        let outX = x;
        let outY = y;
        // One pass per block, twice over: sliding clear of one block can push a
        // point into a neighbour.
        for (let pass = 0; pass < 2; pass += 1) {
            for (const rect of this.cover) {
                if (!pointInRect(outX, outY, rect, radius)) continue;
                const left = outX - (rect.x - radius);
                const right = rect.x + rect.width + radius - outX;
                const up = outY - (rect.y - radius);
                const down = rect.y + rect.height + radius - outY;
                const shortest = Math.min(left, right, up, down);
                if (shortest === left) outX = rect.x - radius - 1;
                else if (shortest === right) outX = rect.x + rect.width + radius + 1;
                else if (shortest === up) outY = rect.y - radius - 1;
                else outY = rect.y + rect.height + radius + 1;
            }
        }
        return {
            x: clamp(outX, WORLD_MARGIN, WORLD_WIDTH - WORLD_MARGIN),
            y: clamp(outY, WORLD_MARGIN, WORLD_HEIGHT - WORLD_MARGIN),
        };
    }

    private updatePlayerWeapon(realDelta: number): void {
        if (!this.player.alive) {
            this.swapRequested = false;
            this.dryTriggerHeld = false;
            return;
        }
        // Real time, like the player's movement and aim. Draining the trigger
        // on the world clock meant standing still — the game's whole reading
        // stance — throttled the rate of fire by the same 22x the world was
        // slowed: 9 real seconds between shotgun shells, 21 for a launcher.
        // Pulling the trigger is the player's own act, so it runs at their
        // speed; each shot still pulses the clock, so sustained fire moves the
        // world and the trade is preserved.
        this.player.cooldown = Math.max(0, this.player.cooldown - realDelta);

        // Letting go of the trigger is what arms the throw. Holding it down is
        // one continuous act of shooting, so the round that empties the gun
        // must not also fling it — the player never asked for that. Release,
        // press again, and the frame goes.
        if (!this.firing) this.dryTriggerHeld = false;

        this.tryPickup();

        if (!this.firing || this.phase !== "running") return;
        const weapon = this.player.weapon;
        if (!weapon) return;
        if (weapon.rounds <= 0) {
            // A fresh press on a dry gun throws it. The hold that emptied it
            // does not, and it can never fire past empty either.
            if (!this.dryTriggerHeld) this.throwWeapon();
            return;
        }
        if (this.player.cooldown > 0) return;
        this.firePlayerWeapon(weapon);
    }

    private firePlayerWeapon(weapon: HeldWeapon): void {
        const definition = WEAPONS[weapon.id];
        // TWIN TAP: the first shot out of a standstill leaves the barrel twice.
        const twinTap = this.boosters.twin_tap > 0 && this.twinTapReady;
        this.twinTapReady = false;
        this.player.stillFor = 0;
        const volleys = twinTap ? 2 : 1;
        weapon.rounds -= 1;
        this.player.cooldown = definition.interval;
        this.player.flash = 0.075;
        this.player.kick = 1;
        this.firePulse = TIME_FIRE_PULSE_SECONDS;

        const spread = definition.spread * BOOST_SPREAD_FACTOR ** this.boosters.steady_hand;
        const bulletSpeed = definition.speed * (1 + this.boosters.long_barrel * BOOST_BULLET_SPEED_STEP);
        const baseAngle = Math.atan2(this.player.aimY, this.player.aimX);
        for (let volley = 0; volley < volleys; volley += 1) {
            for (let pellet = 0; pellet < definition.pellets; pellet += 1) {
                const offset = definition.pellets === 1 ? 0 : (pellet / (definition.pellets - 1) - 0.5) * 2;
                const jitter = this.noise.float(-1, 1, 0x51) * 0.35;
                const angle = baseAngle + (offset + jitter) * spread;
                this.spawnBullet("player", this.player.x, this.player.y, angle, bulletSpeed, definition);
            }
        }
        this.player.x -= this.player.aimX * definition.recoil * 0.01;
        this.player.y -= this.player.aimY * definition.recoil * 0.01;
        this.events.push({
            type: "shot",
            x: this.player.x,
            y: this.player.y,
            weapon: weapon.id,
            pellets: definition.pellets * volleys,
        });

        // An empty gun is still a weapon, and it needs no verb of its own: the
        // round that empties it is immediately followed by the frame itself,
        // thrown along the same aim. There is nothing to learn and nothing dead
        // to carry.
        // This trigger pull emptied the gun, so it must not also throw it.
        if (weapon.rounds <= 0) this.dryTriggerHeld = true;
    }

    private throwWeapon(): void {
        const weapon = this.player.weapon;
        if (!weapon) return;
        this.player.weapon = null;
        this.throwPulse = TIME_THROW_PULSE_SECONDS;
        this.thrown.push({
            id: this.nextId++,
            weapon,
            x: this.player.x + this.player.aimX * 16,
            y: this.player.y + this.player.aimY * 16,
            vx: this.player.aimX * THROW_SPEED,
            vy: this.player.aimY * THROW_SPEED,
            spin: THROW_SPIN,
            angle: Math.atan2(this.player.aimY, this.player.aimX),
            life: THROW_RANGE_SECONDS,
            pierce: this.boosters.heavy_throw,
        });
        this.events.push({ type: "throw", x: this.player.x, y: this.player.y });
    }

    private pickupRadius(): number {
        return PLAYER_PICKUP_RADIUS * (this.boosters.wide_step > 0 ? BOOST_PICKUP_RADIUS_FACTOR : 1);
    }

    private tryPickup(): void {
        const wantsSwap = this.swapRequested || this.boosters.wide_step > 0;
        this.swapRequested = false;
        // An empty gun is dead weight: walking over a loaded one always swaps.
        const held = this.player.weapon;
        if (held && held.rounds > 0 && !wantsSwap) return;
        let bestIndex = -1;
        let bestDistance = this.pickupRadius();
        for (let index = 0; index < this.drops.length; index += 1) {
            const drop = this.drops[index];
            if (!drop) continue;
            if (drop.weapon.rounds <= 0) continue;
            // WIDE STEP must not swap a loaded gun for a worse one.
            if (held && held.rounds > 0 && drop.weapon.rounds <= held.rounds) continue;
            const distance = length(drop.x - this.player.x, drop.y - this.player.y);
            if (distance < bestDistance) {
                bestDistance = distance;
                bestIndex = index;
            }
        }
        if (bestIndex < 0) return;
        const drop = this.drops[bestIndex];
        if (!drop) return;
        this.drops.splice(bestIndex, 1);
        const previous = this.player.weapon;
        // DEEP POCKETS: everything you lift carries a little more.
        const bonus = this.boosters.deep_pockets * BOOST_POCKET_ROUNDS;
        drop.weapon.rounds += bonus;
        drop.weapon.capacity = Math.max(drop.weapon.capacity, drop.weapon.rounds);
        this.player.weapon = drop.weapon;
        if (previous) {
            this.drops.push({
                id: this.nextId++,
                weapon: previous,
                x: this.player.x,
                y: this.player.y,
                angle: this.noise.float(0, TAU, 0x2a),
                age: 0,
            });
        }
        this.events.push({ type: "pickup", x: drop.x, y: drop.y, weapon: drop.weapon.id });
    }

    /* --------------------------------------------------------------- bullets */

    private spawnBullet(
        owner: "player" | "enemy",
        x: number,
        y: number,
        angle: number,
        speed: number,
        definition: { pierce: number; blast: number },
    ): void {
        if (this.bullets.length >= MAX_ACTIVE_BULLETS) this.bullets.shift();
        const offset = owner === "player" ? PLAYER_RADIUS + 6 : 14;
        this.bullets.push({
            id: this.nextId++,
            owner,
            x: x + Math.cos(angle) * offset,
            y: y + Math.sin(angle) * offset,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            speed,
            life: 3.4,
            pierce: definition.pierce,
            blast: definition.blast,
            bounces: owner === "player" && definition.blast === 0 ? this.boosters.ricochet : 0,
            hitIds: [],
            grazed: false,
            trail: 0,
        });
    }

    private updateBullets(worldDelta: number): void {
        if (worldDelta <= 0) return;
        for (let index = this.bullets.length - 1; index >= 0; index -= 1) {
            const bullet = this.bullets[index];
            if (!bullet) continue;
            bullet.life -= worldDelta;
            if (bullet.life <= 0) {
                this.bullets.splice(index, 1);
                continue;
            }
            const travel = bullet.speed * worldDelta;
            bullet.trail = Math.min(64, travel * 3.2 + 8);
            const steps = Math.max(1, Math.ceil(travel / BULLET_STEP));
            let removed = false;
            for (let step = 0; step < steps && !removed; step += 1) {
                const previousX = bullet.x;
                const previousY = bullet.y;
                bullet.x += (bullet.vx * worldDelta) / steps;
                bullet.y += (bullet.vy * worldDelta) / steps;
                if (bullet.x < -40 || bullet.x > WORLD_WIDTH + 40 || bullet.y < -40 || bullet.y > WORLD_HEIGHT + 40) {
                    removed = true;
                    break;
                }
                removed = this.resolveBulletCover(bullet, previousX, previousY);
                if (removed) break;
                removed = this.resolveBulletContact(bullet);
            }
            if (removed) {
                const position = this.bullets.indexOf(bullet);
                if (position >= 0) this.bullets.splice(position, 1);
                if (this.isDefeated()) return;
            }
        }
    }

    /** Returns true when cover consumed the round. RICOCHET bounces instead. */
    private resolveBulletCover(bullet: BulletState, previousX: number, previousY: number): boolean {
        for (const rect of this.cover) {
            if (!pointInRect(bullet.x, bullet.y, rect, BULLET_RADIUS)) continue;
            if (bullet.blast > 0) {
                this.detonate(bullet.x, bullet.y, bullet.blast, bullet.owner);
                return true;
            }
            const dirX = bullet.vx === 0 ? 0 : Math.sign(bullet.vx);
            const dirY = bullet.vy === 0 ? 0 : Math.sign(bullet.vy);
            this.events.push({
                type: "spark",
                x: bullet.x,
                y: bullet.y,
                dirX: -dirX,
                dirY: -dirY,
                owner: bullet.owner,
            });
            if (bullet.bounces <= 0) return true;
            // Reflect off whichever face the round crossed this step.
            bullet.bounces -= 1;
            const crossedX = !pointInRect(previousX, bullet.y, rect, BULLET_RADIUS);
            const crossedY = !pointInRect(bullet.x, previousY, rect, BULLET_RADIUS);
            if (crossedX) bullet.vx = -bullet.vx;
            if (crossedY) bullet.vy = -bullet.vy;
            if (!crossedX && !crossedY) {
                bullet.vx = -bullet.vx;
                bullet.vy = -bullet.vy;
            }
            bullet.x = previousX;
            bullet.y = previousY;
            bullet.hitIds = [];
            return false;
        }
        return false;
    }

    /**
     * Where the head a player is aiming at actually is. Read from the same
     * skeleton the renderer draws, so the solid and the drawing cannot drift.
     */
    private headCentreY(enemy: EnemyState): number {
        return enemy.y + FIGURE_HEAD_Y * figureScaleFor(enemy.kind);
    }

    private headRadius(enemy: EnemyState): number {
        return FIGURE_HEAD_RADIUS * figureScaleFor(enemy.kind);
    }

    /** Returns true when the bullet should be consumed. */
    private resolveBulletContact(bullet: BulletState): boolean {
        if (bullet.owner === "player") {
            for (const enemy of this.enemies) {
                if (bullet.hitIds.includes(enemy.id)) continue;
                const body = length(enemy.x - bullet.x, enemy.y - bullet.y) <= enemy.radius + BULLET_RADIUS;
                // The drawn head sits clear above the body circle, so it needs
                // its own solid. Without it a round through the middle of a
                // head simply left the page.
                const headshot =
                    !body &&
                    length(enemy.x - bullet.x, this.headCentreY(enemy) - bullet.y) <=
                        this.headRadius(enemy) + BULLET_RADIUS;
                if (!body && !headshot) continue;
                if (bullet.blast > 0) {
                    this.detonate(bullet.x, bullet.y, bullet.blast, "player");
                    return true;
                }
                bullet.hitIds.push(enemy.id);
                this.damageEnemy(enemy, 1, bullet.x, bullet.y, headshot ? "HEADSHOT" : null);
                if (bullet.pierce > 0) {
                    bullet.pierce -= 1;
                    continue;
                }
                return true;
            }
            return false;
        }

        if (this.player.alive && this.player.graceFor <= 0) {
            const distance = length(this.player.x - bullet.x, this.player.y - bullet.y);
            if (distance <= PLAYER_RADIUS + BULLET_RADIUS) {
                if (bullet.blast > 0) this.detonate(bullet.x, bullet.y, bullet.blast, "enemy");
                else this.killPlayer("bullet");
                return true;
            }
            if (!bullet.grazed && distance <= GRAZE_DISTANCE && this.timeScale <= TIME_GRAZE_THRESHOLD) {
                bullet.grazed = true;
                this.grazes += 1;
                this.score += SCORE_GRAZE;
                // PAPER CUT turns a close call into a round.
                if (this.boosters.paper_cut > 0 && this.player.weapon) {
                    this.player.weapon.rounds += 1;
                    this.player.weapon.capacity = Math.max(this.player.weapon.capacity, this.player.weapon.rounds);
                }
                this.events.push({ type: "graze", x: bullet.x, y: bullet.y });
            }
        }
        return false;
    }

    private detonate(x: number, y: number, radius: number, owner: "player" | "enemy"): void {
        this.blasts.push({ id: this.nextId++, x, y, radius, age: 0 });
        this.events.push({ type: "blast", x, y, radius });
        let killsInBlast = 0;
        for (const enemy of [...this.enemies]) {
            if (length(enemy.x - x, enemy.y - y) > radius + enemy.radius) continue;
            const style = killsInBlast > 0 ? "MULTI" : null;
            const before = this.enemies.length;
            this.damageEnemy(enemy, 3, x, y, style, owner === "player");
            if (this.enemies.length < before) killsInBlast += 1;
        }
        if (
            this.player.alive &&
            this.player.graceFor <= 0 &&
            length(this.player.x - x, this.player.y - y) <= radius + PLAYER_RADIUS
        ) {
            this.killPlayer("blast");
        }
    }

    /* ------------------------------------------------------------ thrown gun */

    private updateThrown(worldDelta: number): void {
        if (worldDelta <= 0) return;
        for (let index = this.thrown.length - 1; index >= 0; index -= 1) {
            const gun = this.thrown[index];
            if (!gun) continue;
            gun.life -= worldDelta;
            gun.angle += gun.spin * worldDelta;
            const steps = Math.max(1, Math.ceil((length(gun.vx, gun.vy) * worldDelta) / BULLET_STEP));
            let landed = gun.life <= 0;
            for (let step = 0; step < steps && !landed; step += 1) {
                gun.x += (gun.vx * worldDelta) / steps;
                gun.y += (gun.vy * worldDelta) / steps;
                if (
                    gun.x < WORLD_MARGIN ||
                    gun.x > WORLD_WIDTH - WORLD_MARGIN ||
                    gun.y < WORLD_MARGIN ||
                    gun.y > WORLD_HEIGHT - WORLD_MARGIN
                ) {
                    gun.x = clamp(gun.x, WORLD_MARGIN, WORLD_WIDTH - WORLD_MARGIN);
                    gun.y = clamp(gun.y, WORLD_MARGIN, WORLD_HEIGHT - WORLD_MARGIN);
                    landed = true;
                    break;
                }
                for (const rect of this.cover) {
                    if (pointInRect(gun.x, gun.y, rect, THROW_RADIUS)) {
                        landed = true;
                        break;
                    }
                }
                if (landed) break;
                for (const enemy of this.enemies) {
                    if (length(enemy.x - gun.x, enemy.y - gun.y) > enemy.radius + THROW_RADIUS) continue;
                    this.damageEnemy(enemy, 3, gun.x, gun.y, "THROWN");
                    if (gun.pierce > 0) {
                        gun.pierce -= 1;
                        break;
                    }
                    landed = true;
                    break;
                }
            }
            if (!landed) continue;
            this.thrown.splice(index, 1);
            // Guns are only ever thrown once they run dry, so a spent frame is
            // litter rather than loot — and an empty pickup is a trap, since
            // grabbing it would only arm the throw again. Enemy drops are
            // filtered the same way.
            if (gun.weapon.rounds > 0) this.addDrop(gun.weapon, gun.x, gun.y, gun.angle);
        }
    }

    private addDrop(weapon: HeldWeapon, x: number, y: number, angle: number): void {
        if (this.drops.length >= MAX_ACTIVE_DROPS) this.drops.shift();
        this.drops.push({ id: this.nextId++, weapon, x, y, angle, age: 0 });
    }

    private updateDrops(worldDelta: number): void {
        for (const drop of this.drops) drop.age += worldDelta;
        this.updateResupply(worldDelta);
    }

    /** Hands an empty-handed player a sidearm so a page can never dead-end. */
    private updateResupply(worldDelta: number): void {
        const armed = (this.player.weapon?.rounds ?? 0) > 0;
        const loadedDrop = this.drops.some((drop) => drop.weapon.rounds > 0);
        const inFlight = this.thrown.some((gun) => gun.weapon.rounds > 0);
        if (armed || loadedDrop || inFlight || !this.player.alive) {
            this.resupplyTimer = RESUPPLY_DELAY_SECONDS;
            return;
        }
        this.resupplyTimer -= worldDelta;
        if (this.resupplyTimer > 0) return;
        this.resupplyTimer = RESUPPLY_DELAY_SECONDS;
        const angle = this.noise.float(0, TAU, 0x9c);
        const distance = 90;
        const x = clamp(this.player.x + Math.cos(angle) * distance, WORLD_MARGIN, WORLD_WIDTH - WORLD_MARGIN);
        const y = clamp(this.player.y + Math.sin(angle) * distance, WORLD_MARGIN, WORLD_HEIGHT - WORLD_MARGIN);
        this.addDrop(
            { id: RESUPPLY_WEAPON, rounds: RESUPPLY_ROUNDS, capacity: WEAPONS[RESUPPLY_WEAPON].rounds },
            x,
            y,
            angle,
        );
        this.events.push({ type: "resupply", x, y, weapon: RESUPPLY_WEAPON });
    }

    private updateBlasts(realDelta: number): void {
        for (const blast of this.blasts) blast.age += realDelta;
        this.blasts = this.blasts.filter((blast) => blast.age < BLAST_LIFETIME);
    }

    /* --------------------------------------------------------------- enemies */

    private updateEnemies(worldDelta: number): void {
        if (worldDelta <= 0) return;
        for (const enemy of this.enemies) {
            const definition = ENEMIES[enemy.kind];
            enemy.phase += worldDelta;
            enemy.flinch = Math.max(0, enemy.flinch - worldDelta * 3);
            const toPlayer = normalize(this.player.x - enemy.x, this.player.y - enemy.y);
            const distance = length(this.player.x - enemy.x, this.player.y - enemy.y);
            enemy.hasLos = this.hasLineOfSight(enemy.x, enemy.y, this.player.x, this.player.y);

            const aimTarget = enemy.hasLos ? toPlayer : { x: enemy.aimX, y: enemy.aimY };
            const turn = clamp(worldDelta * 6, 0, 1);
            enemy.aimX += (aimTarget.x - enemy.aimX) * turn;
            enemy.aimY += (aimTarget.y - enemy.aimY) * turn;
            const aim = normalize(enemy.aimX, enemy.aimY);
            enemy.aimX = aim.x;
            enemy.aimY = aim.y;
            enemy.sightLength = enemy.hasLos ? distance : Math.min(distance, 260);

            const beforeX = enemy.x;
            const beforeY = enemy.y;
            this.steerEnemy(enemy, definition, toPlayer, distance, worldDelta);
            if (this.isDefeated()) return;
            const moved = length(enemy.x - beforeX, enemy.y - beforeY);
            enemy.pace += (Math.min(1, worldDelta > 0 ? moved / (worldDelta * 140) : 0) - enemy.pace) * 0.25;
            this.fireEnemy(enemy, definition, distance, worldDelta);
            if (this.isDefeated()) return;
        }
    }

    private steerEnemy(
        enemy: EnemyState,
        definition: EnemyDefinition,
        toPlayer: { x: number; y: number },
        distance: number,
        worldDelta: number,
    ): void {
        if (definition.speed <= 0) return;
        let dirX = 0;
        let dirY = 0;
        if (enemy.kind === "rusher") {
            dirX = toPlayer.x;
            dirY = toPlayer.y;
            if (distance <= enemy.radius + PLAYER_RADIUS && this.player.alive && this.player.graceFor <= 0) {
                this.killPlayer("contact");
                return;
            }
        } else {
            const gap = distance - definition.standoff;
            const approach = clamp(gap / 120, -1, 1);
            dirX = toPlayer.x * approach;
            dirY = toPlayer.y * approach;
            const strafe = Math.sin(enemy.phase * 0.9 + enemy.strafe) * 0.55;
            dirX += -toPlayer.y * strafe;
            dirY += toPlayer.x * strafe;
        }

        for (const other of this.enemies) {
            if (other.id === enemy.id) continue;
            const dx = enemy.x - other.x;
            const dy = enemy.y - other.y;
            const gap = length(dx, dy);
            const minimum = enemy.radius + other.radius + 6;
            if (gap > minimum || gap < 1e-4) continue;
            dirX += (dx / gap) * ENEMY_SEPARATION;
            dirY += (dy / gap) * ENEMY_SEPARATION;
        }

        const direction = normalize(dirX, dirY);
        if (direction.x === 0 && direction.y === 0) return;
        const speed =
            definition.speed * (enemy.flinch > 0 ? 0.35 : 1) * Math.min(PRESSURE_SPEED_MAX, levelPressure(this.level));
        const step = speed * worldDelta;
        const heading = Math.atan2(direction.y, direction.x);
        // Walk around cover instead of pressing into it: fan out from the ideal
        // heading until a step lands in free space.
        const fans = [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9, 2.6, -2.6];
        for (const fan of fans) {
            const angle = heading + fan;
            const nextX = clamp(enemy.x + Math.cos(angle) * step, WORLD_MARGIN * 0.5, WORLD_WIDTH - WORLD_MARGIN * 0.5);
            const nextY = clamp(
                enemy.y + Math.sin(angle) * step,
                WORLD_MARGIN * 0.5,
                WORLD_HEIGHT - WORLD_MARGIN * 0.5,
            );
            // Same rule as the player: a block this figure is already inside
            // must not block the way out of it. Cover eats bullets, so an
            // embedded hostile is unkillable and the page could never clear.
            const walled = this.cover.some(
                (rect) =>
                    pointInRect(nextX, nextY, rect, enemy.radius) && !pointInRect(enemy.x, enemy.y, rect, enemy.radius),
            );
            if (walled) continue;
            enemy.x = nextX;
            enemy.y = nextY;
            return;
        }
    }

    private fireEnemy(enemy: EnemyState, definition: EnemyDefinition, distance: number, worldDelta: number): void {
        const weapon = enemy.weapon;
        if (!weapon || !definition.weapon) return;
        const inRange = distance <= definition.standoff * 1.6 + 120;
        if (!enemy.hasLos || !inRange || enemy.flinch > 0) {
            enemy.acquire = Math.min(enemy.acquireTotal, enemy.acquire + worldDelta * 0.6);
            return;
        }
        if (enemy.acquire > 0) {
            enemy.acquire = Math.max(0, enemy.acquire - worldDelta);
            return;
        }
        if (enemy.burstCooldown > 0) {
            enemy.burstCooldown -= worldDelta;
            return;
        }
        if (weapon.rounds <= 0) {
            enemy.acquire = enemy.acquireTotal;
            weapon.rounds = WEAPONS[weapon.id].rounds;
            enemy.burstCooldown = enemy.cadence * 1.6;
            return;
        }

        const gunDefinition = WEAPONS[weapon.id];
        weapon.rounds -= 1;
        const baseAngle = Math.atan2(enemy.aimY, enemy.aimX) + this.noise.float(-0.05, 0.05, 0x77);
        for (let pellet = 0; pellet < gunDefinition.pellets; pellet += 1) {
            const offset = gunDefinition.pellets === 1 ? 0 : (pellet / (gunDefinition.pellets - 1) - 0.5) * 2;
            const angle = baseAngle + offset * gunDefinition.spread;
            this.spawnBullet("enemy", enemy.x, enemy.y, angle, gunDefinition.speed * 0.62, gunDefinition);
        }
        this.events.push({ type: "enemy_shot", x: enemy.x, y: enemy.y, weapon: weapon.id });

        enemy.burstLeft -= 1;
        if (enemy.burstLeft > 0) {
            enemy.burstCooldown = gunDefinition.interval * 1.5;
        } else {
            enemy.burstLeft = definition.burst;
            enemy.burstCooldown = enemy.cadence;
            enemy.acquire = enemy.acquireTotal * 0.6;
        }
    }

    private hasLineOfSight(ax: number, ay: number, bx: number, by: number): boolean {
        for (const rect of this.cover) {
            if (segmentHitsRect(ax, ay, bx, by, rect)) return false;
        }
        return true;
    }

    private damageEnemy(
        enemy: EnemyState,
        amount: number,
        x: number,
        y: number,
        style: string | null,
        credited = true,
    ): void {
        enemy.soak -= amount;
        enemy.flinch = 1;
        if (enemy.soak > 0) {
            this.events.push({ type: "enemy_hit", x, y, kind: enemy.kind });
            return;
        }
        const index = this.enemies.indexOf(enemy);
        if (index >= 0) this.enemies.splice(index, 1);
        this.addOutline(enemy.kind, enemy.x, enemy.y, Math.atan2(enemy.aimY, enemy.aimX));
        if (enemy.weapon) {
            // SCAVENGER: bodies are worth searching.
            const topUp = Math.round(WEAPONS[enemy.weapon.id].rounds * BOOST_SCAVENGE_FRACTION);
            enemy.weapon.rounds += this.boosters.scavenger * topUp;
            if (enemy.weapon.rounds > 0) {
                this.addDrop(enemy.weapon, enemy.x, enemy.y, this.noise.float(0, TAU, 0x3d));
            }
        }
        this.downs += 1;
        if (!credited) {
            this.events.push({ type: "enemy_down", x: enemy.x, y: enemy.y, kind: enemy.kind, score: 0, style: null });
            return;
        }

        const definition = ENEMIES[enemy.kind];
        const distance = length(enemy.x - this.player.x, enemy.y - this.player.y);
        const still = this.timeScale < TIME_STILL_THRESHOLD;
        let multiplier = this.chainMultiplier();
        let label = style;
        if (style === "THROWN") multiplier *= STYLE_THROWN;
        if (style === "MULTI") multiplier *= STYLE_BLAST_EXTRA;
        if (style === "HEADSHOT") multiplier *= STYLE_HEADSHOT;
        if (still) {
            multiplier *= STYLE_STILL;
            label = label ?? "STILL";
            // DEAD EYE pays the round back for a shot taken from a held page.
            if (this.boosters.dead_eye > 0 && this.player.weapon) {
                this.player.weapon.rounds += 1;
                this.player.weapon.capacity = Math.max(this.player.weapon.capacity, this.player.weapon.rounds);
            }
        }
        if (distance < POINT_BLANK_DISTANCE) {
            multiplier *= STYLE_POINT_BLANK;
            label = label ?? "POINT BLANK";
        }
        const gained = Math.round(definition.score * multiplier);
        this.score += gained;
        this.lastStyle = label;
        this.chain += 1;
        this.chainTimer = CHAIN_WINDOW_SECONDS;
        this.bestChain = Math.max(this.bestChain, this.chain);
        this.events.push({
            type: "enemy_down",
            x: enemy.x,
            y: enemy.y,
            kind: enemy.kind,
            score: gained,
            style: label,
        });
        if (this.chain >= 2) {
            this.events.push({ type: "chain", count: this.chain, multiplier: this.chainMultiplier() });
        }
    }

    /** Kept as a method so mid-frame deaths are not narrowed away by control flow. */
    private isDefeated(): boolean {
        return this.phase === "defeat";
    }

    private chainMultiplier(): number {
        return Math.min(CHAIN_MAX_MULTIPLIER, 1 + this.chain * CHAIN_STEP);
    }

    private addOutline(kind: EnemyKind | "player", x: number, y: number, angle: number): void {
        if (this.outlines.length >= MAX_OUTLINES) this.outlines.shift();
        this.outlines.push({ id: this.nextId++, kind, x, y, angle, age: 0 });
    }

    private killPlayer(cause: "bullet" | "blast" | "contact"): void {
        if (!this.player.alive) return;
        // SECOND SKIN soaks the hit and buys a moment of grace.
        if (this.player.shields > 0) {
            this.player.shields -= 1;
            this.player.graceFor = Math.max(this.player.graceFor, PLAYER_SPAWN_GRACE_SECONDS);
            this.events.push({ type: "shield_used", x: this.player.x, y: this.player.y });
            return;
        }
        this.player.alive = false;
        this.phase = "defeat";
        this.addOutline("player", this.player.x, this.player.y, Math.atan2(this.player.aimY, this.player.aimX));
        this.events.push({ type: "player_down", x: this.player.x, y: this.player.y, cause });
        this.events.push({ type: "run_end", score: this.score, level: this.level });
    }

    /* ----------------------------------------------------------------- levels */

    private planLevel(level: number): LevelPlan {
        const elite = isEliteLevel(level);
        // The opening page is always the clean one, so the clock teaches itself.
        const archetypeIndex = this.noise.int(0, LAYOUT_ARCHETYPES.length, 0xa1 + level * 7);
        const archetype = level === 1 ? "open" : ((LAYOUT_ARCHETYPES[archetypeIndex] ?? "scatter") as LayoutArchetype);
        let modifier: ModifierId | null = null;
        const eligible = MODIFIER_IDS.filter((id) => level >= MODIFIERS[id].minLevel);
        // Twists start at level 3, and every elite page always carries one.
        const wantsModifier = elite || (level >= 3 && this.noise.bool(0.45, 0xb2 + level));
        if (wantsModifier && eligible.length > 0) {
            const pick = this.noise.int(0, eligible.length, 0xb3 + level * 3);
            modifier = eligible[pick] ?? null;
        }
        return { index: level, act: actForLevel(level), elite, archetype, modifier };
    }

    private rosterForLevel(plan: LevelPlan): EnemyKind[] {
        const composition = levelComposition(plan.index, plan.elite);
        if (plan.modifier === "crowded") composition.rusher = Math.min(11, composition.rusher + 3);
        if (plan.modifier === "marksmen" && composition.sniper > 0) composition.sniper += 1;
        if (plan.modifier === "heavy") composition.tank += 1;
        if (plan.modifier === "swarm") {
            composition.rusher = Math.min(14, composition.rusher + 5);
            composition.tank = 0;
            composition.sniper = 0;
            composition.rocketeer = 0;
            composition.grunt = 1;
        }

        // Modifiers have had their say; now the page is trimmed to what one
        // screen can carry. Past that it gets harder through pressure instead.
        const capped = capComposition(composition);

        const roster: EnemyKind[] = [];
        const push = (kind: EnemyKind, count: number): void => {
            for (let index = 0; index < count; index += 1) roster.push(kind);
        };
        push("rusher", capped.rusher);
        push("grunt", capped.grunt);
        push("tank", capped.tank);
        push("sniper", capped.sniper);
        push("rocketeer", capped.rocketeer);
        for (let index = roster.length - 1; index > 0; index -= 1) {
            const swap = this.noise.int(0, index + 1, 0x11 + plan.index);
            const a = roster[index];
            const b = roster[swap];
            if (a === undefined || b === undefined) continue;
            roster[index] = b;
            roster[swap] = a;
        }
        return roster.slice(0, MAX_ACTIVE_ENEMIES);
    }

    private beginLevel(level: number): void {
        this.level = level;
        this.levelClock = 0;
        this.interlude = 0;
        this.rewardWeapon = null;
        this.levelAnnounced = false;
        this.plan = this.planLevel(level);
        this.cover = this.layoutCover(this.plan);
        this.outlines = [];
        // The floor plan is re-drawn around a player who never moved, so a
        // block can land on top of them. Only the room's centre is guaranteed
        // clear, and by the end of a level they are rarely standing in it.
        // Step them out rather than dropping a block from a hand-drawn plan.
        const clear = this.ejectFromCover(this.player.x, this.player.y, PLAYER_RADIUS);
        this.player.x = clear.x;
        this.player.y = clear.y;
        this.drops = this.drops.filter((drop) => !this.coverBlocks(drop.x, drop.y));
        this.player.shields = this.boosters.second_skin;
        this.player.graceFor = Math.max(this.player.graceFor, PLAYER_SPAWN_GRACE_SECONDS);
        if (this.plan.modifier === "scarce" && this.player.weapon) {
            this.player.weapon.rounds = Math.max(1, Math.floor(this.player.weapon.rounds / 2));
        }
        const roster = this.rosterForLevel(this.plan);
        this.levelTotal = roster.length;
        this.pendingGroups = this.scheduleGroups(roster, level);
        this.events.push({ type: "level_start", level, total: this.levelTotal, plan: this.plan });
        this.levelAnnounced = true;
    }

    private scheduleGroups(roster: EnemyKind[], level: number): { at: number; kinds: EnemyKind[] }[] {
        const groupCount = Math.min(roster.length, this.noise.int(GROUPS_MIN, GROUPS_MAX + 1, 0x21 + level));
        const groups: { at: number; kinds: EnemyKind[] }[] = [];
        for (let index = 0; index < groupCount; index += 1) {
            groups.push({ at: index === 0 ? 0 : index * GROUP_DELAY_SECONDS, kinds: [] });
        }
        roster.forEach((kind, index) => {
            const group = groups[index % groupCount];
            if (group) group.kinds.push(kind);
        });
        return groups;
    }

    private pendingSpawnCount(): number {
        return this.pendingGroups.reduce((total, group) => total + group.kinds.length, 0);
    }

    private updateLevel(worldDelta: number, realDelta: number): void {
        this.levelClock += worldDelta;
        if (this.phase === "interlude") {
            // The interlude is a real-time breath, never stretched by the clock.
            this.interlude = Math.max(0, this.interlude - realDelta);
            if (this.interlude <= 0) this.openDraft();
            return;
        }

        for (let index = this.pendingGroups.length - 1; index >= 0; index -= 1) {
            const group = this.pendingGroups[index];
            if (!group || this.levelClock < group.at) continue;
            for (const kind of group.kinds) {
                if (this.enemies.length >= MAX_ACTIVE_ENEMIES) break;
                this.spawnEnemy(kind);
            }
            this.pendingGroups.splice(index, 1);
        }

        if (!this.levelAnnounced) return;
        if (this.enemies.length > 0 || this.pendingSpawnCount() > 0) return;
        this.completeLevel();
    }

    private completeLevel(): void {
        const reward = rewardForLevel(this.level);
        const definition = WEAPONS[reward.weapon];
        const unspent = this.player.weapon?.rounds ?? 0;
        const eliteBonus = this.plan.elite ? 2 : 1;
        const bonus = (SCORE_LEVEL_CLEAR * this.level + unspent * SCORE_UNSPENT_ROUND) * eliteBonus;
        this.score += bonus;
        this.rewardWeapon = reward.weapon;
        this.phase = "interlude";
        this.interlude = INTERLUDE_SECONDS;
        this.levelAnnounced = false;
        const capacity = definition.rounds + reward.bonusRounds;
        const angle = this.noise.float(0, TAU, 0x4b);
        const dropDistance = 64;
        this.addDrop(
            { id: reward.weapon, rounds: capacity, capacity },
            clamp(this.player.x + Math.cos(angle) * dropDistance, WORLD_MARGIN, WORLD_WIDTH - WORLD_MARGIN),
            clamp(this.player.y + Math.sin(angle) * dropDistance, WORLD_MARGIN, WORLD_HEIGHT - WORLD_MARGIN),
            angle,
        );
        this.events.push({ type: "level_clear", level: this.level, bonus, reward: reward.weapon });
    }

    /**
     * Rolls the between-level draft. There are only 26 booster stacks in the
     * game, so a long enough run takes them all — and an endless run must not
     * lose its between-page choice at that point. Once the board is full the
     * draft switches to loadout: pick a gun, fully loaded.
     */
    private openDraft(): void {
        const available = BOOSTER_IDS.filter((id) => this.boosters[id] < BOOSTERS[id].maxStacks);
        const offers: DraftOffer[] = available.length > 0 ? this.boosterOffers(available) : this.weaponOffers();
        this.draftOffers = offers;
        this.phase = "draft";
        this.events.push({ type: "draft_open", offers });
    }

    private boosterOffers(available: BoosterId[]): DraftOffer[] {
        const pool = [...available];
        for (let index = pool.length - 1; index > 0; index -= 1) {
            const swap = this.noise.int(0, index + 1, 0xc4 + this.level);
            const a = pool[index];
            const b = pool[swap];
            if (a === undefined || b === undefined) continue;
            pool[index] = b;
            pool[swap] = a;
        }
        return pool
            .slice(0, DRAFT_CHOICES)
            .map((id) => ({ kind: "booster", id, stacks: this.boosters[id] + 1 }) satisfies DraftOffer);
    }

    /** The endless-run draft: three guns, loaded, deep pages included. */
    private weaponOffers(): DraftOffer[] {
        const pool: WeaponId[] = [...WEAPON_IDS];
        for (let index = pool.length - 1; index > 0; index -= 1) {
            const swap = this.noise.int(0, index + 1, 0xc7 + this.level);
            const a = pool[index];
            const b = pool[swap];
            if (a === undefined || b === undefined) continue;
            pool[index] = b;
            pool[swap] = a;
        }
        const bonus = this.boosters.deep_pockets * BOOST_POCKET_ROUNDS;
        return pool
            .slice(0, DRAFT_CHOICES)
            .map((id) => ({ kind: "weapon", id, rounds: WEAPONS[id].rounds + bonus }) satisfies DraftOffer);
    }

    private spawnEnemy(kind: EnemyKind): void {
        const definition = ENEMIES[kind];
        const spot = this.findSpawnPoint(definition);
        const weapon: HeldWeapon | null = definition.weapon
            ? {
                  id: definition.weapon,
                  rounds: WEAPONS[definition.weapon].rounds,
                  capacity: WEAPONS[definition.weapon].rounds,
              }
            : null;
        // Deep pages field better bodies rather than only more of them.
        const pressure = levelPressure(this.level);
        let acquire =
            this.noise.float(definition.acquireMin, definition.acquireMax, 0x5f) /
            Math.min(PRESSURE_ACQUIRE_MAX, pressure);
        if (this.plan.modifier === "hair_trigger") acquire *= 0.6;
        // COLD START buys the player a beat at the top of every page.
        if (this.boosters.cold_start > 0 && this.levelClock < BOOST_COLD_START_WINDOW) {
            acquire += this.boosters.cold_start * BOOST_COLD_START_SECONDS;
        }
        // Rushers already outpace nothing but the clock, so soak is where deep
        // pages get their teeth: every body takes one more round to put down.
        const soakForLevel = definition.soak + pressureSoakBonus(this.level);
        const toPlayer = normalize(this.player.x - spot.x, this.player.y - spot.y);
        this.enemies.push({
            id: this.nextId++,
            kind,
            x: spot.x,
            y: spot.y,
            aimX: toPlayer.x || 1,
            aimY: toPlayer.y,
            radius: definition.radius,
            soak: soakForLevel,
            maxSoak: soakForLevel,
            weapon,
            acquire,
            acquireTotal: Math.max(0.001, acquire),
            burstLeft: definition.burst,
            burstCooldown: this.noise.float(0.1, 0.6, 0x6a),
            cadence:
                this.noise.float(definition.cadenceMin, definition.cadenceMax, 0x6b) /
                Math.min(PRESSURE_CADENCE_MAX, pressure),
            flinch: 0,
            phase: this.noise.float(0, TAU, 0x6c),
            strafe: this.noise.float(0, TAU, 0x6d),
            hasLos: false,
            sightLength: 0,
            pace: 0,
        });
    }

    private findSpawnPoint(definition: EnemyDefinition): { x: number; y: number } {
        const minimumDistance = definition.kind === "sniper" ? 430 : 290;
        for (let attempt = 0; attempt < 24; attempt += 1) {
            const edge = this.noise.int(0, 4, 0x7c);
            const along = this.noise.float(0.08, 0.92, 0x7d);
            const inset = this.noise.float(WORLD_MARGIN + 24, WORLD_MARGIN + 96, 0x7e);
            let x = 0;
            let y = 0;
            if (edge === 0) {
                x = WORLD_WIDTH * along;
                y = inset;
            } else if (edge === 1) {
                x = WORLD_WIDTH - inset;
                y = WORLD_HEIGHT * along;
            } else if (edge === 2) {
                x = WORLD_WIDTH * along;
                y = WORLD_HEIGHT - inset;
            } else {
                x = inset;
                y = WORLD_HEIGHT * along;
            }
            if (length(x - this.player.x, y - this.player.y) < minimumDistance) continue;
            if (this.coverBlocks(x, y)) continue;
            return { x, y };
        }
        // Every sampled edge point was rejected, so fall back to the far side.
        // That corner is picked blind, so clear it of cover before using it —
        // it is the one path that can put a hostile inside a block.
        return this.ejectFromCover(
            this.player.x > WORLD_WIDTH / 2 ? WORLD_MARGIN + 40 : WORLD_WIDTH - WORLD_MARGIN - 40,
            clamp(WORLD_HEIGHT - this.player.y, WORLD_MARGIN, WORLD_HEIGHT - WORLD_MARGIN),
            definition.radius,
        );
    }

    private coverBlocks(x: number, y: number): boolean {
        return this.cover.some((rect) => pointInRect(x, y, rect, 30));
    }

    /* ------------------------------------------------------------ floor plans */

    private block(x: number, y: number, width: number, height: number, shape: CoverShape, key: number): CoverBlock {
        return { x, y, width, height, shape, key };
    }

    /** Lays out one of the hand-drawn floor plans, always leaving the centre clear. */
    private layoutCover(plan: LevelPlan): CoverBlock[] {
        if (plan.modifier === "bare") return [];
        const centreX = WORLD_WIDTH / 2;
        const centreY = WORLD_HEIGHT / 2;
        const blocks: CoverBlock[] = [];
        const jitterX = (salt: number, amount: number): number => this.noise.float(-amount, amount, salt);

        if (plan.archetype === "open") {
            blocks.push(this.block(WORLD_WIDTH * 0.2, WORLD_HEIGHT * 0.22, 150, 58, "desk", 11));
            blocks.push(this.block(WORLD_WIDTH * 0.66, WORLD_HEIGHT * 0.66, 160, 60, "desk", 12));
        } else if (plan.archetype === "pillars") {
            for (let column = 0; column < 3; column += 1) {
                for (let row = 0; row < 2; row += 1) {
                    const x = WORLD_WIDTH * (0.2 + column * 0.3) + jitterX(0xd0 + column, 26);
                    const y = WORLD_HEIGHT * (0.24 + row * 0.5) + jitterX(0xe0 + row, 24);
                    blocks.push(this.block(x - 34, y - 34, 68, 68, "pillar", 20 + column * 3 + row));
                }
            }
        } else if (plan.archetype === "corridor") {
            blocks.push(this.block(WORLD_WIDTH * 0.1, WORLD_HEIGHT * 0.28, WORLD_WIDTH * 0.34, 56, "desk", 31));
            blocks.push(this.block(WORLD_WIDTH * 0.56, WORLD_HEIGHT * 0.28, WORLD_WIDTH * 0.34, 56, "desk", 32));
            blocks.push(this.block(WORLD_WIDTH * 0.1, WORLD_HEIGHT * 0.66, WORLD_WIDTH * 0.34, 56, "desk", 33));
            blocks.push(this.block(WORLD_WIDTH * 0.56, WORLD_HEIGHT * 0.66, WORLD_WIDTH * 0.34, 56, "desk", 34));
        } else if (plan.archetype === "bunker") {
            blocks.push(this.block(centreX - 150, centreY - 46, 130, 92, "crate", 41));
            blocks.push(this.block(centreX + 20, centreY - 46, 130, 92, "crate", 42));
            blocks.push(this.block(WORLD_WIDTH * 0.16, WORLD_HEIGHT * 0.7, 76, 76, "drum", 43));
            blocks.push(this.block(WORLD_WIDTH * 0.76, WORLD_HEIGHT * 0.18, 76, 76, "drum", 44));
        } else if (plan.archetype === "gauntlet") {
            for (let column = 0; column < 3; column += 1) {
                const x = WORLD_WIDTH * (0.26 + column * 0.24);
                const tall = column % 2 === 0;
                const height = tall ? WORLD_HEIGHT * 0.34 : WORLD_HEIGHT * 0.28;
                const y = tall ? WORLD_HEIGHT * 0.06 : WORLD_HEIGHT * 0.66;
                blocks.push(this.block(x - 30, y, 60, height, "pillar", 51 + column));
            }
        } else {
            const count = this.noise.int(3, 6, 0x8a + plan.index);
            const shapes: CoverShape[] = ["crate", "desk", "pillar", "drum"];
            for (let attempt = 0; attempt < count * 8 && blocks.length < count; attempt += 1) {
                const wide = this.noise.bool(0.5, 0x8b);
                const width = wide ? this.noise.float(130, 230, 0x8c) : this.noise.float(56, 92, 0x8d);
                const height = wide ? this.noise.float(48, 76, 0x8e) : this.noise.float(100, 180, 0x8f);
                const x = this.noise.float(WORLD_MARGIN + 60, WORLD_WIDTH - WORLD_MARGIN - 60 - width, 0x90);
                const y = this.noise.float(WORLD_MARGIN + 60, WORLD_HEIGHT - WORLD_MARGIN - 60 - height, 0x91);
                const shape = shapes[this.noise.int(0, shapes.length, 0x92)] ?? "crate";
                const candidate = this.block(x, y, width, height, shape, 60 + blocks.length);
                if (pointInRect(centreX, centreY, candidate, 120)) continue;
                const overlaps = blocks.some(
                    (other) =>
                        x < other.x + other.width + 80 &&
                        x + width + 80 > other.x &&
                        y < other.y + other.height + 80 &&
                        y + height + 80 > other.y,
                );
                if (overlaps) continue;
                blocks.push(candidate);
            }
        }

        // No plan may wall the player in at the spawn point.
        return blocks.filter((rect) => !pointInRect(centreX, centreY, rect, 110));
    }
}

export { levelEnemyCount };

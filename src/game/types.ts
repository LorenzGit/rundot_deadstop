import type { BoosterId, CoverRect, EnemyKind, LayoutArchetype, ModifierId, WeaponId } from "./config.ts";

export type RunPhase = "idle" | "running" | "interlude" | "draft" | "paused" | "defeat";

export type BulletOwner = "player" | "enemy";

export type CoverShape = "crate" | "desk" | "pillar" | "drum";

export interface CoverBlock extends CoverRect {
    shape: CoverShape;
    key: number;
}

export interface HeldWeapon {
    id: WeaponId;
    rounds: number;
    capacity: number;
}

export interface PlayerState {
    x: number;
    y: number;
    vx: number;
    vy: number;
    aimX: number;
    aimY: number;
    alive: boolean;
    weapon: HeldWeapon | null;
    cooldown: number;
    graceFor: number;
    /** Real-time seconds since the last shot, used for muzzle flash. */
    flash: number;
    kick: number;
    /** Lethal hits this page can still soak, from SECOND SKIN. */
    shields: number;
    /** World seconds the player has held perfectly still. */
    stillFor: number;
}

export interface EnemyState {
    id: number;
    kind: EnemyKind;
    x: number;
    y: number;
    aimX: number;
    aimY: number;
    radius: number;
    soak: number;
    maxSoak: number;
    weapon: HeldWeapon | null;
    /** World seconds left before this enemy can fire. */
    acquire: number;
    acquireTotal: number;
    burstLeft: number;
    burstCooldown: number;
    cadence: number;
    flinch: number;
    /** Drives leg animation and strafe phase. */
    phase: number;
    strafe: number;
    hasLos: boolean;
    sightLength: number;
    /** Smoothed speed, used by the renderer for smears and stride. */
    pace: number;
}

export interface BulletState {
    id: number;
    owner: BulletOwner;
    x: number;
    y: number;
    vx: number;
    vy: number;
    speed: number;
    life: number;
    pierce: number;
    blast: number;
    /** Bounces left off cover, from RICOCHET. */
    bounces: number;
    hitIds: number[];
    grazed: boolean;
    /** Trail anchor, in world units behind the head. */
    trail: number;
}

export interface ThrownGunState {
    id: number;
    weapon: HeldWeapon;
    x: number;
    y: number;
    vx: number;
    vy: number;
    spin: number;
    angle: number;
    life: number;
    /** Bodies this gun can still go through. */
    pierce: number;
}

export interface DropState {
    id: number;
    weapon: HeldWeapon;
    x: number;
    y: number;
    angle: number;
    age: number;
}

export interface OutlineState {
    id: number;
    kind: EnemyKind | "player";
    x: number;
    y: number;
    angle: number;
    age: number;
}

export interface BlastState {
    id: number;
    x: number;
    y: number;
    radius: number;
    age: number;
}

export interface LevelPlan {
    index: number;
    act: number;
    elite: boolean;
    archetype: LayoutArchetype;
    modifier: ModifierId | null;
}

/**
 * The run is endless, so the draft has to be too. Boosters run out — there are
 * only 26 stacks in the game — and a run deep enough to take them all must
 * still get a choice between pages. Once the board is full the draft offers
 * loadout instead: a fresh gun, fully loaded, which only matters more as deep
 * pages add soak to every body.
 */
export type DraftOffer =
    | { kind: "booster"; id: BoosterId; stacks: number }
    | { kind: "weapon"; id: WeaponId; rounds: number };

export interface CoreSnapshot {
    phase: RunPhase;
    timeScale: number;
    player: Readonly<PlayerState>;
    enemies: readonly Readonly<EnemyState>[];
    bullets: readonly Readonly<BulletState>[];
    thrown: readonly Readonly<ThrownGunState>[];
    drops: readonly Readonly<DropState>[];
    outlines: readonly Readonly<OutlineState>[];
    blasts: readonly Readonly<BlastState>[];
    cover: readonly Readonly<CoverBlock>[];
    level: number;
    levelPlan: Readonly<LevelPlan>;
    levelRemaining: number;
    levelTotal: number;
    pendingSpawns: number;
    interludeProgress: number;
    rewardWeapon: WeaponId | null;
    draftOffers: readonly Readonly<DraftOffer>[];
    boosters: Readonly<Record<BoosterId, number>>;
    /** Enemy sight lines stay hidden until the shot locks on a dim page. */
    hideSightLines: boolean;
    score: number;
    chain: number;
    chainProgress: number;
    chainMultiplier: number;
    bestChain: number;
    downs: number;
    grazes: number;
    elapsed: number;
    worldElapsed: number;
    revives: number;
    lastStyle: string | null;
}

export type GameEvent =
    | { type: "shot"; x: number; y: number; weapon: WeaponId; pellets: number }
    | { type: "throw"; x: number; y: number }
    | { type: "pickup"; x: number; y: number; weapon: WeaponId }
    | { type: "resupply"; x: number; y: number; weapon: WeaponId }
    | { type: "graze"; x: number; y: number }
    | { type: "blast"; x: number; y: number; radius: number }
    | { type: "spark"; x: number; y: number; dirX: number; dirY: number; owner: BulletOwner }
    | { type: "enemy_shot"; x: number; y: number; weapon: WeaponId }
    | { type: "enemy_hit"; x: number; y: number; kind: EnemyKind }
    | { type: "enemy_down"; x: number; y: number; kind: EnemyKind; score: number; style: string | null }
    | { type: "chain"; count: number; multiplier: number }
    | { type: "shield_used"; x: number; y: number }
    | { type: "level_clear"; level: number; bonus: number; reward: WeaponId }
    | { type: "level_start"; level: number; total: number; plan: LevelPlan }
    | { type: "draft_open"; offers: readonly DraftOffer[] }
    | { type: "booster_taken"; id: BoosterId; stacks: number }
    | { type: "weapon_taken"; id: WeaponId; rounds: number }
    | { type: "revive"; level: number }
    | { type: "player_down"; x: number; y: number; cause: "bullet" | "blast" | "contact" }
    | { type: "run_end"; score: number; level: number };

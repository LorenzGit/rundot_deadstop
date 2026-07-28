export type GameOrientation = "landscape" | "portrait";

export interface DesignViewport {
    width: number;
    height: number;
    orientation: GameOrientation;
}

export const LANDSCAPE_VIEW: Readonly<DesignViewport> = {
    width: 800,
    height: 450,
    orientation: "landscape",
};

export const PORTRAIT_VIEW: Readonly<DesignViewport> = {
    width: 450,
    height: 800,
    orientation: "portrait",
};

export function designViewportForSize(width: number, height: number): Readonly<DesignViewport> {
    return height > width ? PORTRAIT_VIEW : LANDSCAPE_VIEW;
}

/** The page. Fixed, always fully visible, never scrolled. */
export const WORLD_WIDTH = 1280;
export const WORLD_HEIGHT = 720;
export const WORLD_MARGIN = 40;
/** Every figure is drawn at this multiple of its base skeleton. */
export const FIGURE_SCALE = 1.3;

/**
 * The drawn skeleton, in local figure units, and the only copy of it.
 *
 * The renderer draws heads from these numbers and the core hit-tests against
 * them. They used to live separately — art.ts owned the head position, core.ts
 * owned a single body circle — and they drifted until a round through the
 * middle of a drawn head passed nine units clear of anything solid. Anything
 * the player can aim at has to be described once.
 */
export const FIGURE_HEAD_Y = -21;
export const FIGURE_HEAD_RADIUS = 7.4;

/** Heavier families are drawn — and so hit — larger than the base skeleton. */
export function figureScaleFor(kind: EnemyKind): number {
    return FIGURE_SCALE * (kind === "tank" ? 1.22 : kind === "rocketeer" ? 1.1 : 1);
}

/* ------------------------------------------------------------------ clock */

export const TIME_FLOOR = 0.045;
export const TIME_AIM_WEIGHT = 0.35;
export const TIME_AIM_FULL_RATE = 4.2;
export const TIME_FIRE_PULSE_SECONDS = 0.14;
export const TIME_THROW_PULSE_SECONDS = 0.2;
export const TIME_ATTACK_RATE = 18;
export const TIME_RELEASE_RATE = 6;
export const TIME_STILL_THRESHOLD = 0.2;
export const TIME_GRAZE_THRESHOLD = 0.35;

/* ----------------------------------------------------------------- player */

export const PLAYER_SPEED = 126;
export const PLAYER_RADIUS = 13;
export const PLAYER_PICKUP_RADIUS = 38;
export const PLAYER_SPAWN_GRACE_SECONDS = 1.1;

/* ---------------------------------------------------------------- weapons */

export type WeaponId = "pistol" | "smg" | "shotgun" | "rifle" | "launcher";

export interface WeaponDefinition {
    id: WeaponId;
    name: string;
    rounds: number;
    /** Seconds of world time between shots. */
    interval: number;
    pellets: number;
    speed: number;
    spread: number;
    pierce: number;
    /** Blast radius, 0 for direct-fire weapons. */
    blast: number;
    /** Recoil push applied to the shooter, in world units per second. */
    recoil: number;
    /** Length of the muzzle in figure units, used by the renderer. */
    barrel: number;
}

export const WEAPONS: Readonly<Record<WeaponId, WeaponDefinition>> = {
    pistol: {
        id: "pistol",
        name: "PISTOL",
        rounds: 7,
        interval: 60 / 260,
        pellets: 1,
        speed: 620,
        spread: 0.012,
        pierce: 0,
        blast: 0,
        recoil: 26,
        barrel: 13,
    },
    smg: {
        id: "smg",
        name: "SMG",
        rounds: 26,
        interval: 60 / 700,
        pellets: 1,
        speed: 640,
        spread: 0.055,
        pierce: 0,
        blast: 0,
        recoil: 18,
        barrel: 17,
    },
    shotgun: {
        id: "shotgun",
        name: "SHOTGUN",
        rounds: 6,
        interval: 60 / 95,
        pellets: 6,
        speed: 560,
        spread: 0.2,
        pierce: 0,
        blast: 0,
        recoil: 96,
        barrel: 21,
    },
    rifle: {
        id: "rifle",
        name: "RIFLE",
        rounds: 8,
        interval: 60 / 135,
        pellets: 1,
        speed: 1150,
        spread: 0.004,
        pierce: 2,
        blast: 0,
        recoil: 44,
        barrel: 25,
    },
    launcher: {
        id: "launcher",
        name: "LAUNCHER",
        rounds: 3,
        interval: 60 / 50,
        pellets: 1,
        speed: 330,
        spread: 0.02,
        pierce: 0,
        blast: 104,
        recoil: 70,
        barrel: 23,
    },
};

export const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];

/** Reward ladder handed out at the end of each cleared level. */
export const REWARD_LADDER: readonly WeaponId[] = ["smg", "shotgun", "rifle", "launcher"];
export const REWARD_CYCLE_BONUS_ROUNDS = 2;

export function rewardForLevel(level: number): { weapon: WeaponId; bonusRounds: number } {
    const index = Math.max(0, level - 1);
    const cycle = Math.floor(index / REWARD_LADDER.length);
    return {
        weapon: REWARD_LADDER[index % REWARD_LADDER.length] as WeaponId,
        bonusRounds: cycle * REWARD_CYCLE_BONUS_ROUNDS,
    };
}

/**
 * When the spent frame follows its last round out.
 *
 * This runs on **world** time, like everything else the world does. A real-time
 * timer looked right in isolation and wrong in play: standing still holds the
 * clock at its floor, so the last round hangs in the air — and a gun thrown on
 * a wall-clock beat launched straight past it, two objects leaving the muzzle
 * together along one line. That is the thing that reads as shooting and
 * throwing at once.
 *
 * On world time the frame waits exactly as the round does. Hold the page and it
 * stays in your hand with everything else; move, and it follows the round out
 * with real distance between them. The real-time backstop only exists so a
 * player who empties a gun and then never moves again is not left holding it
 * forever.
 */
export const THROW_AFTER_DRY_WORLD_SECONDS = 0.3;
export const THROW_MAX_WAIT_SECONDS = 2.5;
export const THROW_SPEED = 520;
export const THROW_SPIN = 15;
export const THROW_RADIUS = 13;
export const THROW_RANGE_SECONDS = 0.85;

/* ---------------------------------------------------------------- enemies */

export type EnemyKind = "rusher" | "grunt" | "tank" | "sniper" | "rocketeer";

export interface EnemyDefinition {
    kind: EnemyKind;
    name: string;
    speed: number;
    soak: number;
    radius: number;
    score: number;
    weapon: WeaponId | null;
    /** Preferred engagement distance; rushers ignore it. */
    standoff: number;
    /** World seconds spent acquiring before the first shot. */
    acquireMin: number;
    acquireMax: number;
    /** World seconds between bursts. */
    cadenceMin: number;
    cadenceMax: number;
    burst: number;
}

export const ENEMIES: Readonly<Record<EnemyKind, EnemyDefinition>> = {
    rusher: {
        kind: "rusher",
        name: "RUSHER",
        speed: 168,
        soak: 1,
        radius: 15,
        score: 100,
        weapon: null,
        standoff: 0,
        acquireMin: 0,
        acquireMax: 0,
        cadenceMin: 0,
        cadenceMax: 0,
        burst: 0,
    },
    grunt: {
        kind: "grunt",
        name: "GRUNT",
        speed: 78,
        soak: 1,
        radius: 15,
        score: 150,
        weapon: "pistol",
        standoff: 260,
        acquireMin: 0.55,
        acquireMax: 0.85,
        cadenceMin: 1.1,
        cadenceMax: 1.9,
        burst: 3,
    },
    tank: {
        kind: "tank",
        name: "TANK",
        speed: 52,
        soak: 3,
        radius: 20,
        score: 300,
        weapon: "shotgun",
        standoff: 180,
        acquireMin: 0.5,
        acquireMax: 0.8,
        cadenceMin: 1.6,
        cadenceMax: 2.4,
        burst: 1,
    },
    sniper: {
        kind: "sniper",
        name: "SNIPER",
        speed: 0,
        soak: 1,
        radius: 15,
        score: 350,
        weapon: "rifle",
        standoff: 480,
        acquireMin: 1.4,
        acquireMax: 1.7,
        cadenceMin: 2.1,
        cadenceMax: 2.9,
        burst: 1,
    },
    rocketeer: {
        kind: "rocketeer",
        name: "ROCKETEER",
        speed: 62,
        soak: 2,
        radius: 18,
        score: 400,
        weapon: "launcher",
        standoff: 340,
        acquireMin: 0.9,
        acquireMax: 1.3,
        cadenceMin: 2.6,
        cadenceMax: 3.4,
        burst: 1,
    },
};

export const ENEMY_KINDS = Object.keys(ENEMIES) as EnemyKind[];

/* ------------------------------------------------------------------ levels */

export interface LevelComposition {
    rusher: number;
    grunt: number;
    tank: number;
    sniper: number;
    rocketeer: number;
}

export const LEVELS_PER_ACT = 5;
export const ENEMY_LEVEL_GATES: Readonly<Record<EnemyKind, number>> = {
    rusher: 1,
    grunt: 1,
    tank: 4,
    sniper: 6,
    rocketeer: 9,
};

/**
 * The run never ends, so the curve must never end either. Body counts alone
 * cannot carry that: the arena is one screen and the frame budget is finite,
 * so counts saturate by design. Past that point the page gets harder by
 * fielding *better* bodies instead of more of them.
 *
 * Pressure is 1 until counts start topping out, then grows without bound but
 * logarithmically, so level 40 is meaningfully worse than level 20 and level
 * 400 is still a fight rather than an instant loss. Every stat that reads it
 * clamps its own share (see PRESSURE_* below) — pressure sets the ambition,
 * the clamps keep it fair.
 */
export const PRESSURE_FLOOR_LEVEL = 12;
export const PRESSURE_RATE = 0.34;
/** Per-stat ceilings, so no single dimension runs away with the difficulty. */
export const PRESSURE_SPEED_MAX = 1.4;
export const PRESSURE_ACQUIRE_MAX = 1.85;
export const PRESSURE_CADENCE_MAX = 1.7;
export const PRESSURE_SOAK_STEP = 0.62;
export const PRESSURE_SOAK_MAX = 3;
/** Bodies alive plus queued on one page. Groups mean not all are on screen. */
export const ROSTER_HARD_CAP = 30;

export function levelPressure(level: number): number {
    const n = Math.max(1, Math.floor(level));
    if (n <= PRESSURE_FLOOR_LEVEL) return 1;
    return 1 + Math.log2(1 + (n - PRESSURE_FLOOR_LEVEL) / 6) * PRESSURE_RATE;
}

/** Extra soak every body carries once the page is deep enough to warrant it. */
export function pressureSoakBonus(level: number): number {
    return Math.min(PRESSURE_SOAK_MAX, Math.floor((levelPressure(level) - 1) / PRESSURE_SOAK_STEP));
}

export function levelComposition(level: number, elite = false): LevelComposition {
    const n = Math.max(1, Math.floor(level));
    const bonus = elite ? 1 : 0;
    // Counts keep creeping after the early curve, just slowly, so a deep page
    // still looks busier than a shallow one before pressure is accounted for.
    const creep = (per: number) => Math.floor(Math.max(0, n - PRESSURE_FLOOR_LEVEL) / per);
    return {
        rusher: Math.min(13, 1 + Math.floor(n * 0.6) + creep(9)),
        // A grunt is on every page: it is the guaranteed source of fresh rounds.
        grunt: Math.min(9, 1 + Math.floor(n / 2) + creep(14)),
        tank: n >= ENEMY_LEVEL_GATES.tank ? Math.min(4, Math.floor((n - 1) / 4) + bonus + creep(22)) : 0,
        sniper: n >= ENEMY_LEVEL_GATES.sniper ? Math.min(3, Math.floor((n - 2) / 5) + bonus + creep(18)) : 0,
        rocketeer: n >= ENEMY_LEVEL_GATES.rocketeer ? Math.min(3, Math.floor((n - 4) / 6) + bonus + creep(26)) : 0,
    };
}

export function compositionTotal(composition: LevelComposition): number {
    return composition.rusher + composition.grunt + composition.tank + composition.sniper + composition.rocketeer;
}

/**
 * Trims a page down to what one screen and one frame budget can carry. Rushers
 * give way first — they are the most numerous and the least individually
 * dangerous — and the page always keeps a grunt, because a grunt is the
 * guaranteed source of fresh rounds.
 *
 * Both the roster the core builds and the count the HUD and the sim read go
 * through here, so a capped page can never report a size it does not field.
 */
export function capComposition(composition: LevelComposition): LevelComposition {
    const capped = { ...composition };
    let over = compositionTotal(capped) - ROSTER_HARD_CAP;
    if (over > 0) {
        const shed = Math.min(over, Math.max(0, capped.rusher - 1));
        capped.rusher -= shed;
        over -= shed;
    }
    if (over > 0) capped.grunt = Math.max(1, capped.grunt - over);
    return capped;
}

export function levelEnemyCount(level: number, elite = false): number {
    return compositionTotal(capComposition(levelComposition(level, elite)));
}

/** Every page is laid out from one of these hand-drawn floor plans. */
export type LayoutArchetype = "open" | "pillars" | "corridor" | "bunker" | "scatter" | "gauntlet";

export const LAYOUT_ARCHETYPES: readonly LayoutArchetype[] = [
    "open",
    "pillars",
    "corridor",
    "bunker",
    "scatter",
    "gauntlet",
];

export const LAYOUT_NAMES: Readonly<Record<LayoutArchetype, string>> = {
    open: "OPEN FLOOR",
    pillars: "PILLAR HALL",
    corridor: "LONG DESKS",
    bunker: "THE BUNKER",
    scatter: "SCRAP ROOM",
    gauntlet: "THE GAUNTLET",
};

/** A twist stamped on the page. One per level from level 3 onward. */
export type ModifierId = "crowded" | "marksmen" | "bare" | "dim" | "hair_trigger" | "heavy" | "scarce" | "swarm";

export interface ModifierDefinition {
    id: ModifierId;
    name: string;
    blurb: string;
    /** Earliest level this twist may be stamped on. */
    minLevel: number;
}

export const MODIFIERS: Readonly<Record<ModifierId, ModifierDefinition>> = {
    crowded: { id: "crowded", name: "CROWDED", blurb: "More bodies through the door.", minLevel: 3 },
    marksmen: { id: "marksmen", name: "MARKSMEN", blurb: "An extra rifle at the back.", minLevel: 6 },
    bare: { id: "bare", name: "BARE PAGE", blurb: "Nothing to hide behind.", minLevel: 3 },
    dim: { id: "dim", name: "DIM LIGHT", blurb: "Sight lines stay hidden until they lock.", minLevel: 4 },
    hair_trigger: { id: "hair_trigger", name: "HAIR TRIGGER", blurb: "They aim faster.", minLevel: 5 },
    heavy: { id: "heavy", name: "HEAVY", blurb: "One more that soaks.", minLevel: 7 },
    scarce: { id: "scarce", name: "SCARCE", blurb: "You start the page half loaded.", minLevel: 4 },
    swarm: { id: "swarm", name: "SWARM", blurb: "Rushers, and almost nothing else.", minLevel: 8 },
};

export const MODIFIER_IDS = Object.keys(MODIFIERS) as ModifierId[];

export function actForLevel(level: number): number {
    return 1 + Math.floor((Math.max(1, Math.floor(level)) - 1) / LEVELS_PER_ACT);
}

export function isEliteLevel(level: number): boolean {
    return Math.max(1, Math.floor(level)) % LEVELS_PER_ACT === 0;
}

export const GROUPS_MIN = 2;
export const GROUPS_MAX = 3;
export const GROUP_DELAY_SECONDS = 2.6;
export const INTERLUDE_SECONDS = 1.6;
export const MAX_ACTIVE_ENEMIES = 26;
export const MAX_ACTIVE_BULLETS = 260;
export const MAX_ACTIVE_DROPS = 30;
export const MAX_OUTLINES = 34;

/* ---------------------------------------------------------------- boosters */

export type BoosterId =
    | "steady_hand"
    | "long_breath"
    | "quick_feet"
    | "deep_pockets"
    | "heavy_throw"
    | "ricochet"
    | "second_skin"
    | "scavenger"
    | "dead_eye"
    | "paper_cut"
    | "twin_tap"
    | "long_barrel"
    | "wide_step"
    | "cold_start";

export interface BoosterDefinition {
    id: BoosterId;
    name: string;
    blurb: string;
    /** How many times it can be taken in one run. */
    maxStacks: number;
    /** Ink price when bought from the kit before a run; null means draft-only. */
    inkCost: number | null;
}

export const BOOSTERS: Readonly<Record<BoosterId, BoosterDefinition>> = {
    steady_hand: {
        id: "steady_hand",
        name: "STEADY HAND",
        blurb: "Every gun shoots half as wide.",
        maxStacks: 2,
        inkCost: 90,
    },
    long_breath: {
        id: "long_breath",
        name: "LONG BREATH",
        blurb: "Standing still slows the page even further.",
        maxStacks: 2,
        inkCost: 140,
    },
    quick_feet: {
        id: "quick_feet",
        name: "QUICK FEET",
        blurb: "Move 14% faster without spending more clock.",
        maxStacks: 3,
        inkCost: 100,
    },
    deep_pockets: {
        id: "deep_pockets",
        name: "DEEP POCKETS",
        blurb: "Every gun you pick up carries 3 more rounds.",
        maxStacks: 3,
        inkCost: 110,
    },
    heavy_throw: {
        id: "heavy_throw",
        name: "HEAVY THROW",
        blurb: "A thrown gun goes through one more body.",
        maxStacks: 2,
        inkCost: 120,
    },
    ricochet: {
        id: "ricochet",
        name: "RICOCHET",
        blurb: "Your rounds bounce off cover once.",
        maxStacks: 2,
        inkCost: 160,
    },
    second_skin: {
        id: "second_skin",
        name: "SECOND SKIN",
        blurb: "Soak one hit, once per page.",
        maxStacks: 2,
        inkCost: 220,
    },
    scavenger: {
        id: "scavenger",
        name: "SCAVENGER",
        blurb: "Bodies drop their guns half full again.",
        maxStacks: 2,
        inkCost: 110,
    },
    dead_eye: {
        id: "dead_eye",
        name: "DEAD EYE",
        blurb: "A kill made while still gives the round back.",
        maxStacks: 1,
        inkCost: 170,
    },
    paper_cut: {
        id: "paper_cut",
        name: "PAPER CUT",
        blurb: "Every graze loads one round.",
        maxStacks: 1,
        inkCost: 150,
    },
    twin_tap: {
        id: "twin_tap",
        name: "TWIN TAP",
        blurb: "The first shot out of a standstill fires twice.",
        maxStacks: 1,
        inkCost: 150,
    },
    long_barrel: {
        id: "long_barrel",
        name: "LONG BARREL",
        blurb: "Rounds travel 30% faster.",
        maxStacks: 2,
        inkCost: 100,
    },
    wide_step: {
        id: "wide_step",
        name: "WIDE STEP",
        blurb: "Reach further for a gun, and swap while loaded.",
        maxStacks: 1,
        inkCost: 80,
    },
    cold_start: {
        id: "cold_start",
        name: "COLD START",
        blurb: "They need longer to find you at the top of a page.",
        maxStacks: 2,
        inkCost: 130,
    },
};

export const BOOSTER_IDS = Object.keys(BOOSTERS) as BoosterId[];

export function isBoosterId(value: unknown): value is BoosterId {
    return typeof value === "string" && (BOOSTER_IDS as string[]).includes(value);
}

/** Boosters that can be bought with ink before a run. */
export const KIT_BOOSTER_IDS: readonly BoosterId[] = BOOSTER_IDS.filter((id) => BOOSTERS[id].inkCost !== null);

/** How many kit boosters a player may carry into one run. */
export const KIT_SLOTS = 2;

/** How many cards a between-level draft offers. */
export const DRAFT_CHOICES = 3;

/* --------------------------------------------------- booster tuning values */

export const BOOST_SPREAD_FACTOR = 0.5;
export const BOOST_TIME_FLOOR_STEP = 0.014;
export const BOOST_TIME_FLOOR_MIN = 0.015;
export const BOOST_SPEED_STEP = 0.14;
export const BOOST_POCKET_ROUNDS = 3;
export const BOOST_SCAVENGE_FRACTION = 0.5;
export const BOOST_BULLET_SPEED_STEP = 0.3;
export const BOOST_PICKUP_RADIUS_FACTOR = 1.6;
export const BOOST_COLD_START_SECONDS = 0.55;
export const BOOST_COLD_START_WINDOW = 5;
export const BOOST_TWIN_TAP_STILL_SECONDS = 0.45;

/* ----------------------------------------------------------------- scoring */

export const SCORE_LEVEL_CLEAR = 250;
export const SCORE_UNSPENT_ROUND = 15;
export const SCORE_GRAZE = 25;
export const GRAZE_DISTANCE = 30;
export const CHAIN_WINDOW_SECONDS = 2.5;
export const CHAIN_STEP = 0.15;
export const CHAIN_MAX_MULTIPLIER = 3;
/** A round through the head is the hardest shot on the page, so it pays most. */
export const STYLE_HEADSHOT = 2.5;
export const STYLE_THROWN = 3;
export const STYLE_STILL = 1.5;
export const STYLE_BLAST_EXTRA = 2;
export const STYLE_POINT_BLANK = 1.25;
export const POINT_BLANK_DISTANCE = 80;
export const INK_PER_SCORE = 250;

/* ------------------------------------------------------------------ cover */

export interface CoverRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/* --------------------------------------------------------------- resupply */

/**
 * A page with no gun and no rounds is unplayable, so an empty-handed player is
 * always handed a fresh sidearm after a short wait. This is a safety net, not
 * an economy: it never fires while the player still has a loaded weapon.
 */
export const RESUPPLY_DELAY_SECONDS = 5;
export const RESUPPLY_WEAPON: WeaponId = "pistol";
export const RESUPPLY_ROUNDS = 5;

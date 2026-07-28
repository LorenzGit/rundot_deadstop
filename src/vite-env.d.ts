/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface Window {
    __deadstopQa?: {
        snapshot(): Record<string, unknown>;
        startRun(): void;
        setInput(input: { moveX?: number; moveY?: number; aimX?: number; aimY?: number; firing?: boolean }): void;
        step(seconds: number, steps?: number): void;
        forceEnemy(
            kind?: "rusher" | "grunt" | "tank" | "sniper" | "rocketeer",
            distance?: number,
            angle?: number,
        ): void;
        forceLevel(level: number): void;
        forceBooster(
            id:
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
                | "cold_start",
        ): void;
        forceDraft(): void;
        chooseBooster(index: number): boolean;
        forceWeapon(weapon?: "pistol" | "smg" | "shotgun" | "rifle" | "launcher", rounds?: number): void;
        forceResults(): void;
        openSettings(): void;
        openDailyRewards(): void;
        openLedger(): void;
        openKit(): void;
        pause(): void;
        resume(): void;
        freezeSimulation(): void;
        setPalette(id: "ledger" | "grid" | "nightshift" | "blueprint" | "carbon" | "redpen"): void;
        setReducedMotion(enabled: boolean): void;
        setPerformanceHud(enabled: boolean): void;
        showMilestone(kicker: string, title: string): void;
    };
}

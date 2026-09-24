import type { BoosterId } from "../game/config.ts";
import { getRunCapabilities, readAppStorage, writeAppStorage } from "../sdk/runSdk.ts";
import type { PaletteId } from "./cosmetics.ts";
import type { PendingPurchaseIntent } from "./monetization/purchaseCoordinator.ts";
import { analytics } from "./analytics/analyticsConfig.ts";
import {
    createDefaultGameSave,
    type GameSaveV1,
    type GameSettings,
    nonNegativeInteger,
    parseGameSave,
    SAVE_VERSION,
} from "./saveSchema.ts";

export {
    type DailyRewardSave,
    type GameProgress,
    type GameRecords,
    type GameSaveV1,
    type GameSettings,
    type InterstitialAdsSave,
    parseGameSave,
    type RewardedAdsSave,
    SAVE_VERSION,
    type TouchControlsMode,
} from "./saveSchema.ts";

const SAVE_KEY = "deadstop-save";
const LOCAL_SAVE_KEY = "deadstop.local-save";
/** "unavailable": RUN storage could not be read; defaults are in memory but never written to the cloud. */
export type SaveSource = "run" | "local" | "defaults" | "unavailable";

export const DEFAULT_SAVE = createDefaultGameSave(window.matchMedia("(prefers-reduced-motion: reduce)").matches);

let state: GameSaveV1 = structuredClone(DEFAULT_SAVE);
let lastSerialized = "";
let pendingSerialized: string | null = null;
let flushInFlight: Promise<boolean> | null = null;

function hostedStorage(): boolean {
    const capabilities = getRunCapabilities();
    return capabilities.host && !capabilities.mock && capabilities.storage;
}

/**
 * Remote-write guard. A failed or timed-out RUN storage read is not a new
 * player: writing defaults then would replace the real cloud save (and reset
 * redeemedOrderIds, so old ink orders would be credited again). Remote writes
 * stay blocked until one read has succeeded. "blocked" means the cloud holds a
 * save from a newer build, which this build must never overwrite.
 */
type RemoteState = "unverified" | "verified" | "blocked";
let remoteState: RemoteState = "unverified";
let verifyInFlight: Promise<void> | null = null;
let verifyRetryTimer = 0;
const VERIFY_RETRY_MS = [2_000, 4_000, 8_000, 15_000, 30_000] as const;

function isNewerSave(raw: string): boolean {
    try {
        const version = (JSON.parse(raw) as { version?: unknown } | null)?.version;
        return typeof version === "number" && version > SAVE_VERSION;
    } catch {
        return false;
    }
}

type RemoteRead = "found" | "empty" | "failed" | "newer";

async function readRemote(): Promise<RemoteRead> {
    const remote = await readAppStorage(SAVE_KEY);
    if (!remote.ok) return "failed";
    const save = parseGameSave(remote.value, DEFAULT_SAVE);
    if (save) {
        state = save;
        lastSerialized = remote.value ?? JSON.stringify(state);
        return "found";
    }
    if (remote.value !== null) {
        if (isNewerSave(remote.value)) return "newer";
        // Unreadable, not newer: keep a copy before it can be replaced.
        console.warn("[save] unreadable remote save; backing it up");
        await writeAppStorage(`${SAVE_KEY}-unreadable-backup`, remote.value);
    }
    return "empty";
}

function settleRemote(result: RemoteRead): void {
    if (result === "failed") return;
    remoteState = result === "newer" ? "blocked" : "verified";
    if (result === "newer") console.warn("[save] cloud save is from a newer build; cloud writes disabled");
}

/**
 * Retry the read in the background. flush() never awaits this: a caller that
 * reverts on a failed flush must not revert against a freshly applied save.
 */
function verifyRemote(attempt = 0): void {
    if (remoteState !== "unverified" || verifyInFlight || verifyRetryTimer) return;
    verifyInFlight = (async () => {
        if (hostedStorage()) settleRemote(await readRemote());
    })().finally(() => {
        verifyInFlight = null;
        if (remoteState !== "unverified" || attempt >= VERIFY_RETRY_MS.length) return;
        verifyRetryTimer = window.setTimeout(() => {
            verifyRetryTimer = 0;
            verifyRemote(attempt + 1);
        }, VERIFY_RETRY_MS[attempt]);
    });
}

function readLocal(): string | null {
    try {
        return window.localStorage.getItem(LOCAL_SAVE_KEY);
    } catch {
        return null;
    }
}

async function persist(serialized: string): Promise<boolean> {
    if (hostedStorage()) return writeAppStorage(SAVE_KEY, serialized);
    try {
        window.localStorage.setItem(LOCAL_SAVE_KEY, serialized);
        return true;
    } catch (error) {
        console.warn("[save] local fallback write failed", error);
        return false;
    }
}

export interface RunResult {
    score: number;
    level: number;
    downs: number;
    grazes: number;
    bestChain: number;
    boosters: number;
    ink: number;
}

export const saveSystem = {
    async load(): Promise<SaveSource> {
        if (hostedStorage()) {
            const result = await readRemote();
            settleRemote(result);
            if (result === "found") return "run";
            state = structuredClone(DEFAULT_SAVE);
            lastSerialized = JSON.stringify(state);
            if (result === "failed") {
                console.warn("[save] cloud save unreadable at boot; cloud writes paused until a read succeeds");
                verifyRemote();
                return "unavailable";
            }
            return "defaults";
        }
        const localRaw = readLocal();
        const local = parseGameSave(localRaw, DEFAULT_SAVE);
        state = local ?? structuredClone(DEFAULT_SAVE);
        lastSerialized = localRaw ?? JSON.stringify(state);
        return local ? "local" : "defaults";
    },

    get(): Readonly<GameSaveV1> {
        return state;
    },

    updateSettings(patch: Partial<GameSettings>): void {
        state = { ...state, settings: { ...state.settings, ...patch } };
    },

    markControlsSeen(): void {
        if (state.progress.controlsSeen) return;
        state = { ...state, progress: { ...state.progress, controlsSeen: true } };
    },

    /** Re-arms onboarding so the next run coaches again. */
    resetControlsSeen(): void {
        if (!state.progress.controlsSeen) return;
        state = { ...state, progress: { ...state.progress, controlsSeen: false } };
    },

    recordRun(result: RunResult): void {
        const ink = nonNegativeInteger(result.ink);
        // Milestones are read BEFORE the records are overwritten — afterwards
        // the previous best is gone and "was this a personal best?" is
        // unanswerable.
        if (Math.floor(result.score) > state.records.bestScore) {
            analytics.event("milestone_reached", {
                milestone: "best_score",
                value: Math.floor(result.score),
                previous: state.records.bestScore,
            });
        }
        if (Math.floor(result.level) > state.records.deepestLevel) {
            analytics.event("milestone_reached", {
                milestone: "deepest_level",
                value: Math.floor(result.level),
                previous: state.records.deepestLevel,
            });
        }
        state = {
            ...state,
            records: {
                bestScore: Math.max(state.records.bestScore, Math.floor(result.score)),
                deepestLevel: Math.max(state.records.deepestLevel, Math.floor(result.level)),
                bestChain: Math.max(state.records.bestChain, Math.floor(result.bestChain)),
                totalRuns: state.records.totalRuns + 1,
            },
            progress: {
                ...state.progress,
                lifetimeDowns: state.progress.lifetimeDowns + nonNegativeInteger(result.downs),
                lifetimeGrazes: state.progress.lifetimeGrazes + nonNegativeInteger(result.grazes),
                lifetimeBoosters: state.progress.lifetimeBoosters + nonNegativeInteger(result.boosters),
                lifetimeInk: state.progress.lifetimeInk + ink,
            },
            wallet: { ink: state.wallet.ink + ink },
        };
        // Canonical economy beats. Ink enters and leaves the wallet only through
        // this module, so instrumenting the accessors covers the whole economy.
        if (ink > 0)
            analytics.event("currency_earned", {
                currency: "ink",
                amount: ink,
                source: "run",
                balance_after: state.wallet.ink,
            });
    },

    setKit(kit: readonly BoosterId[]): void {
        state = { ...state, kit: [...kit] };
    },

    /** Spends the ink a kit costs. Returns false when the wallet cannot cover it. */
    spendInk(cost: number): boolean {
        const amount = nonNegativeInteger(cost);
        if (state.wallet.ink < amount) return false;
        state = { ...state, wallet: { ink: state.wallet.ink - amount } };
        analytics.event("currency_spent", { currency: "ink", amount, sink: "kit", balance_after: state.wallet.ink });
        return true;
    },

    /**
     * Turns one fulfilled consumable order into ink, exactly once. The order id
     * is the idempotency key, so a replayed history can never double-grant.
     */
    redeemInkOrder(orderId: string, ink: number): boolean {
        if (state.monetization.redeemedOrderIds.includes(orderId)) return false;
        const amount = nonNegativeInteger(ink);
        state = {
            ...state,
            wallet: { ink: state.wallet.ink + amount },
            progress: { ...state.progress, lifetimeInk: state.progress.lifetimeInk + amount },
            monetization: {
                ...state.monetization,
                redeemedOrderIds: [...state.monetization.redeemedOrderIds, orderId].slice(-90),
            },
        };
        analytics.event("currency_earned", {
            currency: "ink",
            amount,
            source: "iap_order",
            balance_after: state.wallet.ink,
        });
        return true;
    },

    setSelectedPalette(selectedPalette: PaletteId): void {
        state = { ...state, cosmetics: { ...state.cosmetics, selectedPalette } };
    },

    /** Spends ink for a page. Returns false when the wallet cannot cover it. */
    unlockPaletteWithInk(paletteId: PaletteId, cost: number): boolean {
        if (state.cosmetics.unlockedPaletteIds.includes(paletteId)) return true;
        if (state.wallet.ink < cost) return false;
        state = {
            ...state,
            wallet: { ink: state.wallet.ink - cost },
            cosmetics: {
                ...state.cosmetics,
                unlockedPaletteIds: [...state.cosmetics.unlockedPaletteIds, paletteId],
            },
        };
        analytics.event("currency_spent", {
            currency: "ink",
            amount: cost,
            sink: "palette",
            item_id: paletteId,
            balance_after: state.wallet.ink,
        });
        return true;
    },

    setPendingPurchaseIntent(pendingPurchaseIntent: PendingPurchaseIntent | null): void {
        state = { ...state, monetization: { ...state.monetization, pendingPurchaseIntent } };
    },

    /** Records a host-verified rewarded completion. The grant itself is a revive. */
    recordRewardedCompletion(input: { claimId: string; day: string; completedAtMs: number }): {
        ok: boolean;
        reason: "ready" | "already-claimed";
        previous: GameSaveV1;
    } {
        const previous = structuredClone(state);
        if (state.monetization.rewardedAds.claimIds.includes(input.claimId)) {
            return { ok: false, reason: "already-claimed", previous };
        }
        const completedToday =
            state.monetization.rewardedAds.day === input.day ? state.monetization.rewardedAds.completedToday : 0;
        state = {
            ...state,
            monetization: {
                ...state.monetization,
                rewardedAds: {
                    day: input.day,
                    completedToday: completedToday + 1,
                    lastCompletedAtMs: nonNegativeInteger(input.completedAtMs),
                    claimIds: [...state.monetization.rewardedAds.claimIds, input.claimId].slice(-90),
                },
            },
        };
        return { ok: true, reason: "ready", previous };
    },

    recordInterstitialShown(input: { day: string; shownAtMs: number }): void {
        const shownToday =
            state.monetization.interstitialAds.day === input.day ? state.monetization.interstitialAds.shownToday : 0;
        state = {
            ...state,
            monetization: {
                ...state.monetization,
                interstitialAds: {
                    day: input.day,
                    shownToday: shownToday + 1,
                    lastShownAtMs: nonNegativeInteger(input.shownAtMs),
                },
            },
        };
    },

    applyDailyReward(input: { day: string; ink: number }): {
        ok: boolean;
        reason: "ready" | "already-claimed";
        previous: GameSaveV1;
    } {
        const claimId = `daily-reward:${input.day}`;
        const previous = structuredClone(state);
        if (state.dailyRewards.claimIds.includes(claimId)) {
            return { ok: false, reason: "already-claimed", previous };
        }
        const ink = nonNegativeInteger(input.ink);
        state = {
            ...state,
            wallet: { ink: state.wallet.ink + ink },
            progress: { ...state.progress, lifetimeInk: state.progress.lifetimeInk + ink },
            dailyRewards: {
                lastClaimDay: input.day,
                totalClaims: state.dailyRewards.totalClaims + 1,
                claimIds: [...state.dailyRewards.claimIds, claimId].slice(-90),
            },
        };
        return { ok: true, reason: "ready", previous };
    },

    /**
     * Undo a granted-but-unsaved daily reward by DELTA against the current
     * state, not by restoring the pre-claim snapshot: anything else the player
     * earned between the grant and the failed flush must survive the rollback.
     */
    revertDailyReward(input: { day: string; ink: number; previousLastClaimDay: string | null }): void {
        const claimId = `daily-reward:${input.day}`;
        if (!state.dailyRewards.claimIds.includes(claimId)) return;
        const ink = nonNegativeInteger(input.ink);
        state = {
            ...state,
            wallet: { ink: Math.max(0, state.wallet.ink - ink) },
            progress: { ...state.progress, lifetimeInk: Math.max(0, state.progress.lifetimeInk - ink) },
            dailyRewards: {
                lastClaimDay: input.previousLastClaimDay,
                totalClaims: Math.max(0, state.dailyRewards.totalClaims - 1),
                claimIds: state.dailyRewards.claimIds.filter((id) => id !== claimId),
            },
        };
    },

    restore(snapshot: GameSaveV1): void {
        state = structuredClone(snapshot);
    },

    async flush(): Promise<boolean> {
        if (hostedStorage() && remoteState !== "verified") {
            // Never write over a cloud save this session has not read. A host
            // that attached after load() lands here too.
            verifyRemote();
            return false;
        }
        const serialized = JSON.stringify(state);
        if (serialized === lastSerialized && pendingSerialized === null) return true;
        pendingSerialized = serialized;
        if (flushInFlight) return flushInFlight;
        flushInFlight = (async () => {
            let succeeded = true;
            while (pendingSerialized !== null) {
                const next = pendingSerialized;
                pendingSerialized = null;
                if (next === lastSerialized) continue;
                if (await persist(next)) lastSerialized = next;
                else succeeded = false;
            }
            return succeeded;
        })().finally(() => {
            flushInFlight = null;
        });
        return flushInFlight;
    },
};

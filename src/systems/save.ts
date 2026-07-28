import type { BoosterId } from "../game/config.ts";
import { getRunCapabilities, readAppStorage, writeAppStorage } from "../sdk/runSdk.ts";
import type { PaletteId } from "./cosmetics.ts";
import type { PendingPurchaseIntent } from "./monetization/purchaseCoordinator.ts";
import {
    createDefaultGameSave,
    type GameSaveV1,
    type GameSettings,
    nonNegativeInteger,
    parseGameSave,
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
export type SaveSource = "run" | "local" | "defaults";

export const DEFAULT_SAVE = createDefaultGameSave(window.matchMedia("(prefers-reduced-motion: reduce)").matches);

let state: GameSaveV1 = structuredClone(DEFAULT_SAVE);
let lastSerialized = "";
let pendingSerialized: string | null = null;
let flushInFlight: Promise<boolean> | null = null;

function hostedStorage(): boolean {
    const capabilities = getRunCapabilities();
    return capabilities.host && !capabilities.mock && capabilities.storage;
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
            const remote = await readAppStorage(SAVE_KEY);
            if (remote.ok) {
                state = parseGameSave(remote.value, DEFAULT_SAVE) ?? structuredClone(DEFAULT_SAVE);
                lastSerialized = remote.value ?? JSON.stringify(state);
                return remote.value ? "run" : "defaults";
            }
            state = structuredClone(DEFAULT_SAVE);
            lastSerialized = JSON.stringify(state);
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
    },

    setKit(kit: readonly BoosterId[]): void {
        state = { ...state, kit: [...kit] };
    },

    /** Spends the ink a kit costs. Returns false when the wallet cannot cover it. */
    spendInk(cost: number): boolean {
        const amount = nonNegativeInteger(cost);
        if (state.wallet.ink < amount) return false;
        state = { ...state, wallet: { ink: state.wallet.ink - amount } };
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

    restore(snapshot: GameSaveV1): void {
        state = structuredClone(snapshot);
    },

    async flush(): Promise<boolean> {
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

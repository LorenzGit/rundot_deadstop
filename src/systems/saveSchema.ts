import { BOOSTERS, type BoosterId, isBoosterId, KIT_SLOTS } from "../game/config.ts";
import { DEFAULT_PALETTE, isPaletteId, type PaletteId, paletteInkCost } from "./cosmetics.ts";
import type { PendingPurchaseIntent } from "./monetization/purchaseCoordinator.ts";

export const SAVE_VERSION = 1;

/** How the on-screen thumb controls are surfaced. */
export type TouchControlsMode = "auto" | "on" | "off";

export interface GameSettings {
    musicEnabled: boolean;
    musicVolume: number;
    sfxEnabled: boolean;
    sfxVolume: number;
    hapticsEnabled: boolean;
    reducedMotion: boolean;
    touchControls: TouchControlsMode;
    /** Holding the aim stick also pulls the trigger. */
    autoFire: boolean;
    /** Whether the player wants a nudge when tomorrow's page is ready. */
    dailyReminder: boolean;
}

function touchModeOr(value: unknown, fallback: TouchControlsMode): TouchControlsMode {
    return value === "auto" || value === "on" || value === "off" ? value : fallback;
}

export interface GameRecords {
    bestScore: number;
    deepestLevel: number;
    bestChain: number;
    totalRuns: number;
}

export interface GameProgress {
    lifetimeDowns: number;
    lifetimeInk: number;
    lifetimeGrazes: number;
    lifetimeBoosters: number;
    controlsSeen: boolean;
}

export interface DailyRewardSave {
    lastClaimDay: string | null;
    totalClaims: number;
    claimIds: string[];
}

export interface RewardedAdsSave {
    day: string | null;
    completedToday: number;
    lastCompletedAtMs: number;
    claimIds: string[];
}

export interface InterstitialAdsSave {
    day: string | null;
    shownToday: number;
    lastShownAtMs: number;
}

export interface GameSaveV1 {
    version: 1;
    settings: GameSettings;
    records: GameRecords;
    progress: GameProgress;
    wallet: {
        ink: number;
    };
    /** The ink-bought loadout the player will carry into the next run. */
    kit: BoosterId[];
    cosmetics: {
        selectedPalette: PaletteId;
        unlockedPaletteIds: PaletteId[];
    };
    dailyRewards: DailyRewardSave;
    monetization: {
        pendingPurchaseIntent: PendingPurchaseIntent | null;
        /** Fulfilled consumable orders already turned into ink. */
        redeemedOrderIds: string[];
        rewardedAds: RewardedAdsSave;
        interstitialAds: InterstitialAdsSave;
    };
}

export function createDefaultGameSave(reducedMotion: boolean): GameSaveV1 {
    return {
        version: SAVE_VERSION,
        settings: {
            musicEnabled: true,
            musicVolume: 0.3,
            sfxEnabled: true,
            sfxVolume: 0.66,
            hapticsEnabled: true,
            reducedMotion,
            touchControls: "auto",
            autoFire: true,
            dailyReminder: false,
        },
        records: {
            bestScore: 0,
            deepestLevel: 1,
            bestChain: 0,
            totalRuns: 0,
        },
        progress: {
            lifetimeDowns: 0,
            lifetimeInk: 0,
            lifetimeGrazes: 0,
            lifetimeBoosters: 0,
            controlsSeen: false,
        },
        wallet: {
            ink: 0,
        },
        kit: [],
        cosmetics: {
            selectedPalette: DEFAULT_PALETTE,
            unlockedPaletteIds: [],
        },
        dailyRewards: {
            lastClaimDay: null,
            totalClaims: 0,
            claimIds: [],
        },
        monetization: {
            pendingPurchaseIntent: null,
            redeemedOrderIds: [],
            rewardedAds: {
                day: null,
                completedToday: 0,
                lastCompletedAtMs: 0,
                claimIds: [],
            },
            interstitialAds: {
                day: null,
                shownToday: 0,
                lastShownAtMs: 0,
            },
        },
    };
}

function clamp01(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

export function nonNegativeInteger(value: unknown, fallback = 0): number {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : fallback;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
}

function parsePendingPurchaseIntent(value: unknown): PendingPurchaseIntent | null {
    if (!value || typeof value !== "object") return null;
    const candidate = value as Record<string, unknown>;
    if (
        typeof candidate.intentId !== "string" ||
        typeof candidate.productId !== "string" ||
        typeof candidate.catalogItemId !== "string" ||
        typeof candidate.idempotencyKey !== "string" ||
        typeof candidate.createdAtMs !== "number" ||
        !Number.isFinite(candidate.createdAtMs)
    ) {
        return null;
    }
    return {
        intentId: candidate.intentId,
        productId: candidate.productId,
        catalogItemId: candidate.catalogItemId,
        idempotencyKey: candidate.idempotencyKey,
        createdAtMs: candidate.createdAtMs,
    };
}

function parseStringList(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string").slice(-90) : [];
}

export function parseGameSave(
    raw: string | null,
    defaults: GameSaveV1 = createDefaultGameSave(false),
): GameSaveV1 | null {
    if (!raw) return null;
    try {
        const candidate = JSON.parse(raw) as Omit<Partial<GameSaveV1>, "version" | "progress"> & {
            version?: number;
            progress?: Partial<GameProgress>;
        };
        if (candidate.version !== SAVE_VERSION || !candidate.settings || !candidate.records) return null;

        // Ink-bought pages only; entitlement pages are re-verified by the host.
        const unlockedPaletteIds = Array.isArray(candidate.cosmetics?.unlockedPaletteIds)
            ? [
                  ...new Set(
                      candidate.cosmetics.unlockedPaletteIds
                          .filter(isPaletteId)
                          .filter((id) => paletteInkCost(id) !== null),
                  ),
              ]
            : [];
        const selectedCandidate = candidate.cosmetics?.selectedPalette;
        const selectedPalette = isPaletteId(selectedCandidate) ? selectedCandidate : DEFAULT_PALETTE;
        const rewardedAds = candidate.monetization?.rewardedAds;
        const interstitialAds = candidate.monetization?.interstitialAds;

        return {
            version: SAVE_VERSION,
            settings: {
                musicEnabled: booleanOr(candidate.settings.musicEnabled, defaults.settings.musicEnabled),
                musicVolume: clamp01(candidate.settings.musicVolume, defaults.settings.musicVolume),
                sfxEnabled: booleanOr(candidate.settings.sfxEnabled, defaults.settings.sfxEnabled),
                sfxVolume: clamp01(candidate.settings.sfxVolume, defaults.settings.sfxVolume),
                hapticsEnabled: booleanOr(candidate.settings.hapticsEnabled, defaults.settings.hapticsEnabled),
                reducedMotion: booleanOr(candidate.settings.reducedMotion, defaults.settings.reducedMotion),
                touchControls: touchModeOr(candidate.settings.touchControls, defaults.settings.touchControls),
                autoFire: booleanOr(candidate.settings.autoFire, defaults.settings.autoFire),
                dailyReminder: booleanOr(candidate.settings.dailyReminder, defaults.settings.dailyReminder),
            },
            records: {
                bestScore: nonNegativeInteger(candidate.records.bestScore),
                deepestLevel: Math.max(1, nonNegativeInteger(candidate.records.deepestLevel, 1)),
                bestChain: nonNegativeInteger(candidate.records.bestChain),
                totalRuns: nonNegativeInteger(candidate.records.totalRuns),
            },
            progress: {
                lifetimeDowns: nonNegativeInteger(candidate.progress?.lifetimeDowns),
                lifetimeInk: nonNegativeInteger(candidate.progress?.lifetimeInk),
                lifetimeGrazes: nonNegativeInteger(candidate.progress?.lifetimeGrazes),
                lifetimeBoosters: nonNegativeInteger(candidate.progress?.lifetimeBoosters),
                controlsSeen: booleanOr(candidate.progress?.controlsSeen, false),
            },
            wallet: {
                ink: nonNegativeInteger(candidate.wallet?.ink),
            },
            kit: Array.isArray(candidate.kit)
                ? [...new Set(candidate.kit.filter(isBoosterId).filter((id) => BOOSTERS[id].inkCost !== null))].slice(
                      0,
                      KIT_SLOTS,
                  )
                : [],
            cosmetics: {
                selectedPalette,
                unlockedPaletteIds,
            },
            dailyRewards: {
                lastClaimDay:
                    typeof candidate.dailyRewards?.lastClaimDay === "string"
                        ? candidate.dailyRewards.lastClaimDay
                        : null,
                totalClaims: nonNegativeInteger(candidate.dailyRewards?.totalClaims),
                claimIds: parseStringList(candidate.dailyRewards?.claimIds),
            },
            monetization: {
                pendingPurchaseIntent: parsePendingPurchaseIntent(candidate.monetization?.pendingPurchaseIntent),
                redeemedOrderIds: parseStringList(candidate.monetization?.redeemedOrderIds),
                rewardedAds: {
                    day: typeof rewardedAds?.day === "string" ? rewardedAds.day : null,
                    completedToday: nonNegativeInteger(rewardedAds?.completedToday),
                    lastCompletedAtMs: nonNegativeInteger(rewardedAds?.lastCompletedAtMs),
                    claimIds: parseStringList(rewardedAds?.claimIds),
                },
                interstitialAds: {
                    day: typeof interstitialAds?.day === "string" ? interstitialAds.day : null,
                    shownToday: nonNegativeInteger(interstitialAds?.shownToday),
                    lastShownAtMs: nonNegativeInteger(interstitialAds?.lastShownAtMs),
                },
            },
        };
    } catch {
        return null;
    }
}

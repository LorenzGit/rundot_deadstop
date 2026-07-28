import { createMonetizationPlan } from "./monetizationPlan.ts";
import { createPlacementRegistry } from "./placementRegistry.ts";
import { createProductRegistry } from "./productRegistry.ts";

export const monetizationPlan = createMonetizationPlan({
    version: 1,
    model: "hybrid",
    nonPayerPromise:
        "Every weapon, enemy, level, booster, and scoring rule is reachable with ink earned from play. Money buys pages, removes the results break, and can top up ink; it never unlocks content a free player cannot reach.",
    purchaseArchitecture: "shop-entitlements",
    architectureRationale:
        "Durable page palettes and permanent ad removal need the RUN Shop ledger plus authoritative Entitlements for idempotency, refunds, revocation, and cross-device restore.",
    firstExposure: {
        valueMoment: "Finish one run and reach level 2 before any offer or ad placement can activate.",
        minCompletedSessions: 1,
        minProgression: 2,
    },
    primaryKpis: ["rewarded_completion_rate", "game_payer_conversion", "monetization_revenue_per_dau"],
    guardrails: {
        retention: "D1/D7 retention for eligible exposed players versus holdout",
        sessionHealth: "Runs per session and abandonment immediately after a results break",
        economyHealth: "Ink price parity between earned and bought boosters; revived runs are flagged in results",
        reliability: "Purchase/ad error rate, duplicate grants, and entitlement reconciliation failures",
    },
});

export const monetizationPlacements = createPlacementRegistry([
    {
        id: "rewarded_second_wind",
        displayName: "Second Wind",
        type: "rewarded",
        enabledByDefault: false,
        unlock: {
            minCompletedSessions: 1,
            minProgression: 2,
            requireValueMoment: true,
        },
        cooldownSeconds: 120,
        sessionCap: 3,
        dailyCap: 3,
        subscriberPolicy: "same-as-free",
        noAdFallback: "disable-with-message",
        rewardId: "second_wind_revive",
        rewardAmount: 1,
    },
    {
        id: "interstitial_results_break",
        displayName: "Results Break",
        type: "interstitial",
        enabledByDefault: false,
        unlock: {
            minCompletedSessions: 2,
            minProgression: 2,
            requireValueMoment: true,
        },
        cooldownSeconds: 600,
        sessionCap: 1,
        dailyCap: 3,
        subscriberPolicy: "skip",
        noAdFallback: "hide",
        naturalBreak: "After the results tally is read, before the player explicitly starts another run",
        excludeFirstSession: true,
        everyNthRun: 3,
    },
]);

export const INK_CASES: Readonly<Record<string, { ink: number; catalogItemId: string }>> = {
    ink_case_small: { ink: 600, catalogItemId: "deadstop_ink_case_small" },
    ink_case_medium: { ink: 2000, catalogItemId: "deadstop_ink_case_medium" },
    ink_case_large: { ink: 5000, catalogItemId: "deadstop_ink_case_large" },
};

export const INK_CASE_IDS = Object.keys(INK_CASES);

/** Maps a fulfilled catalog item back to the ink it is worth. */
export function inkForCatalogItem(itemId: string): number {
    for (const entry of Object.values(INK_CASES)) {
        if (entry.catalogItemId === itemId) return entry.ink;
    }
    return 0;
}

export const monetizationProducts = createProductRegistry([
    {
        id: "no_interstitials",
        catalogItemId: "deadstop_no_interstitials",
        kind: "durable",
        expectedEntitlementIds: ["deadstop_no_interstitials"],
        unique: true,
        unlockDescription: "Visible once the player becomes eligible for the results break.",
    },
    {
        id: "ledger_pack",
        catalogItemId: "deadstop_ledger_pack",
        kind: "durable",
        expectedEntitlementIds: ["deadstop_ledger_pack"],
        unique: true,
        unlockDescription: "Visible after one completed run that reached wave 2.",
    },
    {
        id: "ink_case_small",
        catalogItemId: "deadstop_ink_case_small",
        kind: "consumable",
        expectedEntitlementIds: [],
        unique: false,
        unlockDescription: "A top-up for the ink boosters are bought with. Always earnable by playing.",
    },
    {
        id: "ink_case_medium",
        catalogItemId: "deadstop_ink_case_medium",
        kind: "consumable",
        expectedEntitlementIds: [],
        unique: false,
        unlockDescription: "The middle ink top-up.",
    },
    {
        id: "ink_case_large",
        catalogItemId: "deadstop_ink_case_large",
        kind: "consumable",
        expectedEntitlementIds: [],
        unique: false,
        unlockDescription: "The largest ink top-up.",
    },
    {
        id: "founder_bundle",
        catalogItemId: "deadstop_founder_bundle",
        kind: "bundle",
        expectedEntitlementIds: ["deadstop_no_interstitials", "deadstop_ledger_pack", "deadstop_pen_redpen"],
        unique: true,
        unlockDescription: "Visible after two completed runs; combines ad removal with every page and the Red Pen.",
    },
]);

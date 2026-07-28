import assert from "node:assert/strict";
import { createDefaultGameSave, parseGameSave, SAVE_VERSION } from "../src/systems/saveSchema.ts";

const defaults = createDefaultGameSave(true);

assert.equal(SAVE_VERSION, 1);
assert.equal(defaults.settings.reducedMotion, true, "system reduced-motion must seed the default save");
assert.equal(defaults.cosmetics.selectedPalette, "ledger");
assert.equal(defaults.records.deepestLevel, 1);
assert.equal(defaults.settings.touchControls, "auto", "touch support must default to automatic");
assert.equal(defaults.settings.autoFire, true, "auto-fire is the default so one thumb can play");

assert.equal(parseGameSave(null, defaults), null, "no stored payload means defaults, not a partial save");
assert.equal(parseGameSave("not json", defaults), null, "corrupt payloads must fall back to defaults");
assert.equal(
    parseGameSave(JSON.stringify({ version: 99, settings: {}, records: {} }), defaults),
    null,
    "an unknown save version must be rejected rather than half-read",
);

const healthy = parseGameSave(
    JSON.stringify({
        version: 1,
        settings: {
            musicEnabled: false,
            musicVolume: 0.5,
            sfxEnabled: true,
            sfxVolume: 0.4,
            hapticsEnabled: false,
            reducedMotion: false,
            touchControls: "on",
            autoFire: false,
        },
        records: { bestScore: 4820, deepestLevel: 6, bestChain: 9, totalRuns: 12 },
        progress: {
            lifetimeDowns: 140,
            lifetimeInk: 320,
            lifetimeGrazes: 31,
            lifetimeBoosters: 22,
            controlsSeen: true,
        },
        wallet: { ink: 260 },
        kit: ["quick_feet", "steady_hand", "long_breath"],
        cosmetics: { selectedPalette: "grid", unlockedPaletteIds: ["grid"] },
        dailyRewards: { lastClaimDay: "2026-07-24", totalClaims: 4, claimIds: ["daily-reward:2026-07-24"] },
        monetization: {
            pendingPurchaseIntent: null,
            redeemedOrderIds: ["order-1", "order-2"],
            rewardedAds: { day: "2026-07-24", completedToday: 1, lastCompletedAtMs: 42, claimIds: ["second-wind:3:1"] },
            interstitialAds: { day: "2026-07-24", shownToday: 1, lastShownAtMs: 64 },
        },
    }),
    defaults,
);

assert.ok(healthy, "a healthy current-version save must load");
assert.equal(healthy.records.bestScore, 4820);
assert.equal(healthy.records.deepestLevel, 6);
assert.equal(healthy.wallet.ink, 260);
assert.deepEqual(healthy.cosmetics.unlockedPaletteIds, ["grid"]);
assert.equal(healthy.progress.controlsSeen, true);
assert.equal(healthy.settings.touchControls, "on");
assert.equal(healthy.settings.autoFire, false);
assert.equal(healthy.progress.lifetimeBoosters, 22);
assert.deepEqual(healthy.kit, ["quick_feet", "steady_hand"], "the kit is capped at its slot count");
assert.deepEqual(healthy.monetization.redeemedOrderIds, ["order-1", "order-2"]);
assert.deepEqual(healthy.monetization.rewardedAds.claimIds, ["second-wind:3:1"]);

const hostile = parseGameSave(
    JSON.stringify({
        version: 1,
        settings: {
            musicEnabled: "yes",
            musicVolume: 9,
            sfxEnabled: true,
            sfxVolume: -3,
            hapticsEnabled: 1,
            reducedMotion: null,
            touchControls: "sideways",
            autoFire: "yes",
        },
        records: { bestScore: -50, deepestLevel: 0, bestChain: "many", totalRuns: 2.7 },
        progress: { lifetimeDowns: -1, lifetimeInk: "lots", lifetimeGrazes: null, controlsSeen: "true" },
        kit: ["quick_feet", "not_a_booster", 7],
        wallet: { ink: -900 },
        // Entitlement pages must never be trusted from local storage.
        cosmetics: { selectedPalette: "carbon", unlockedPaletteIds: ["carbon", "redpen", "grid", "bogus"] },
        dailyRewards: { lastClaimDay: 7, totalClaims: -4, claimIds: [1, "daily-reward:2026-07-24"] },
        monetization: {
            pendingPurchaseIntent: { intentId: "x" },
            rewardedAds: { day: 5, completedToday: -2, lastCompletedAtMs: "soon", claimIds: "nope" },
            interstitialAds: { day: null, shownToday: 1.9, lastShownAtMs: -4 },
        },
    }),
    defaults,
);

assert.ok(hostile, "hostile input must be repaired, not rejected outright");
assert.equal(hostile.settings.musicEnabled, defaults.settings.musicEnabled);
assert.equal(hostile.settings.musicVolume, 1, "volumes clamp into 0..1");
assert.equal(hostile.settings.sfxVolume, 0);
assert.equal(hostile.settings.hapticsEnabled, defaults.settings.hapticsEnabled);
assert.equal(hostile.settings.reducedMotion, defaults.settings.reducedMotion);
assert.equal(hostile.settings.touchControls, "auto", "an unknown touch mode falls back to auto");
assert.equal(hostile.settings.autoFire, defaults.settings.autoFire);
assert.equal(hostile.records.bestScore, 0);
assert.equal(hostile.records.deepestLevel, 1, "level records never drop below the first level");
assert.equal(hostile.records.bestChain, 0);
assert.equal(hostile.records.totalRuns, 2);
assert.equal(hostile.progress.lifetimeDowns, 0);
assert.equal(hostile.progress.lifetimeInk, 0);
assert.equal(hostile.progress.controlsSeen, false, "non-boolean flags fall back, they do not coerce");
assert.equal(hostile.wallet.ink, 0);
assert.deepEqual(hostile.kit, ["quick_feet"], "only real, ink-priced boosters survive a hostile kit list");
assert.deepEqual(
    hostile.cosmetics.unlockedPaletteIds,
    ["grid"],
    "only ink-bought pages survive a local save; paid pages need a verified entitlement",
);
assert.equal(hostile.cosmetics.selectedPalette, "carbon", "selection is kept and re-verified at runtime");
assert.equal(hostile.dailyRewards.lastClaimDay, null);
assert.equal(hostile.dailyRewards.totalClaims, 0);
assert.deepEqual(hostile.dailyRewards.claimIds, ["daily-reward:2026-07-24"]);
assert.equal(hostile.monetization.pendingPurchaseIntent, null, "an incomplete purchase intent must be dropped");
assert.equal(hostile.monetization.rewardedAds.day, null);
assert.equal(hostile.monetization.rewardedAds.completedToday, 0);
assert.deepEqual(hostile.monetization.rewardedAds.claimIds, []);
assert.equal(hostile.monetization.interstitialAds.shownToday, 1);
assert.equal(hostile.monetization.interstitialAds.lastShownAtMs, 0);

const claimIds = Array.from({ length: 140 }, (_value, index) => `daily-reward:day-${index}`);
const trimmed = parseGameSave(
    JSON.stringify({
        version: 1,
        settings: defaults.settings,
        records: defaults.records,
        dailyRewards: { lastClaimDay: null, totalClaims: 140, claimIds },
    }),
    defaults,
);
assert.ok(trimmed);
assert.equal(trimmed.dailyRewards.claimIds.length, 90, "claim ledgers stay bounded");
assert.equal(trimmed.dailyRewards.claimIds[89], "daily-reward:day-139", "the newest claims are the ones kept");

console.log("save schema check ok: version gate, hostile repair, entitlement distrust, bounded ledgers");

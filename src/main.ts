import { audioManager } from "./audio/audioManager.ts";
import {
    BOOSTERS,
    type BoosterId,
    INK_PER_SCORE,
    KIT_SLOTS,
    LAYOUT_NAMES,
    MODIFIERS,
    rewardForLevel,
    WEAPONS,
} from "./game/config.ts";
import { GameCore } from "./game/core.ts";
import { GameScene } from "./game/scene.ts";
import type { CoreSnapshot, GameEvent } from "./game/types.ts";
import { installBrowserQaContract } from "./qa/browserContract.ts";
import {
    bindRunSafeArea,
    initSdk,
    recordAnalytics,
    registerLifecycles,
    requestHostExit,
    triggerHaptic,
} from "./sdk/runSdk.ts";
import {
    type CommerceProductId,
    enforceOwnedSelection,
    isInkCase,
    paletteIsOwned,
    purchaseProduct,
    reconcilePendingPurchase,
    refreshCommerce,
} from "./systems/commerce.ts";
import { PALETTE_ENTRIES, type PaletteId, paletteInkCost } from "./systems/cosmetics.ts";
import { claimDailyReward } from "./systems/dailyRewards.ts";
import {
    initializeInterstitialAdsSession,
    maybeShowResultsInterstitial,
    refreshInterstitialAdAvailability,
    testInterstitialAd,
} from "./systems/interstitialAds.ts";
import { monetizationPlacements, monetizationPlan, monetizationProducts } from "./systems/monetization/config.ts";
import { monetizationDiagnosticsView } from "./systems/monetization/diagnostics.ts";
import { refreshMonetizationRuntime } from "./systems/monetization/runtime.ts";
import {
    clearPendingReminder,
    refreshNotificationPermission,
    reminderView,
    setDailyReminderEnabled,
    syncDailyReminder,
} from "./systems/notifications.ts";
import {
    beginSecondWindRun,
    claimSecondWind,
    initializeRewardedAdsSession,
    refreshRewardedAdAvailability,
    testRewardedAd,
} from "./systems/rewardedAds.ts";
import { type GameSettings, type SaveSource, saveSystem } from "./systems/save.ts";
import { refreshServerTime } from "./systems/serverTime.ts";
import { UiController } from "./ui/controller.ts";
import { Ftue } from "./ui/ftue.ts";
import { PerformanceHud } from "./ui/performanceHud.ts";
import "./styles/app.css";

const core = new GameCore();
const performanceHud = new PerformanceHud();
let scene: GameScene;
let ui: UiController;
let saveSource: SaveSource = "defaults";
let lastHudUpdate = 0;
let lastPhase = core.snapshot().phase;
let runBanked = false;
let firstDownRecorded = false;
let runRevives = 0;
let runKey = 0;
let qaSimulationFrozen = false;
/**
 * Real seconds the world stays frozen after a kill. The renderer keeps running,
 * so the moment reads as a held breath rather than a dropped frame.
 */
let hitStop = 0;
/** Onboarding state for the current run, plus the actions it is waiting on. */
let ftue = new Ftue(true);
/** Onboarding stops nagging once the player has cleared this many pages. */
const FTUE_LAST_COACHED_LEVEL = 3;
let coachShots = 0;
let coachX = 0;
let coachY = 0;
const HIT_STOP_SECONDS = 0.055;
const HIT_STOP_HEAVY_SECONDS = 0.1;

function updateBoot(progress: number, copy: string): void {
    const fill = document.getElementById("boot-fill");
    const label = document.getElementById("boot-copy");
    if (fill) fill.style.width = `${Math.max(4, Math.min(100, progress))}%`;
    if (label) label.textContent = copy;
}

function liftBootCover(): void {
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const cover = document.getElementById("boot-cover");
            if (!cover) return;
            cover.classList.add("hidden");
            window.setTimeout(() => cover.remove(), 320);
        });
    });
}

function haptic(style: Parameters<typeof triggerHaptic>[0]): void {
    if (saveSystem.get().settings.hapticsEnabled) void triggerHaptic(style);
}

function inkForScore(score: number): number {
    return Math.max(0, Math.floor(score / INK_PER_SCORE));
}

function levelNote(level: number): string {
    return `CLEAR › ${WEAPONS[rewardForLevel(level).weapon].name}`;
}

function planLabel(snapshot: CoreSnapshot): string {
    const plan = snapshot.levelPlan;
    const modifier = plan.modifier ? ` · ${MODIFIERS[plan.modifier].name}` : "";
    return `${plan.elite ? "ELITE · " : ""}${LAYOUT_NAMES[plan.archetype]}${modifier}`;
}

function boosterCount(snapshot: CoreSnapshot): number {
    return Object.values(snapshot.boosters).reduce((total, stacks) => total + stacks, 0);
}

function startRun(): void {
    runKey += 1;
    hitStop = 0;
    // The kit is bought at the moment the run starts, never before.
    const saved = saveSystem.get();
    const kit: BoosterId[] = [];
    let spent = 0;
    for (const id of saved.kit.slice(0, KIT_SLOTS)) {
        const cost = BOOSTERS[id].inkCost ?? 0;
        if (!saveSystem.spendInk(cost)) continue;
        spent += cost;
        kit.push(id);
    }
    if (spent > 0) {
        void saveSystem.flush();
        recordAnalytics("kit_spent", { ink: spent, boosters: kit });
    }

    const seed = (0x1f3a7c55 + saved.records.totalRuns * 7919 + runKey * 104_729) >>> 0;
    core.reset(seed, kit);
    runBanked = false;
    runRevives = 0;
    lastPhase = "running";
    qaSimulationFrozen = false;
    beginSecondWindRun(runKey);
    ui.showRunning();
    ui.setLevelPlan(planLabel(core.snapshot()), levelNote(1));
    ftue = new Ftue(saveSystem.get().progress.controlsSeen);
    // Anchor the travel tracker to the spawn point. Left at the origin, the
    // first frame reads as a ~700 unit leap and satisfies the walk lesson
    // before the player has touched anything.
    const spawn = core.snapshot().player;
    coachX = spawn.x;
    coachY = spawn.y;
    ui.showCoach(ftue.step());
    ui.refreshMeta();
    audioManager.setPaused(false);
    audioManager.play("ui");
    recordAnalytics("run_started", {
        inputMode: matchMedia("(pointer: coarse)").matches ? "touch" : "keyboard",
        kit,
    });
}

function pauseRun(): void {
    const phase = core.snapshot().phase;
    if (phase === "running" || phase === "interlude") {
        core.pause();
        ui.showPause();
        audioManager.setPaused(true);
        void saveSystem.flush();
    } else if (phase === "paused") {
        resumeRun();
    }
}

function resumeRun(): void {
    if (core.snapshot().phase !== "paused") return;
    core.resume();
    ui.showRunning();
    audioManager.setPaused(false);
}

function backToMenu(): void {
    core.pause();
    const saved = saveSystem.get();
    ui.showMenu(saved.records, saved.progress);
    audioManager.setPaused(false);
}

function applySettings(settings: GameSettings): void {
    saveSystem.updateSettings(settings);
    audioManager.applySettings(settings);
    scene.setReducedMotion(settings.reducedMotion);
    document.documentElement.dataset.reducedMotion = String(settings.reducedMotion);
    recordAnalytics("setting_changed", {
        music: settings.musicEnabled,
        sfx: settings.sfxEnabled,
        haptics: settings.hapticsEnabled,
        reducedMotion: settings.reducedMotion,
    });
    void saveSystem.flush();
}

async function refreshMonetization(): Promise<void> {
    await refreshMonetizationRuntime();
    await Promise.all([refreshCommerce(), refreshRewardedAdAvailability(), refreshInterstitialAdAvailability()]);
}

async function exitResults(destination: "retry" | "menu", rewardedInteracted: boolean): Promise<void> {
    recordAnalytics("results_exit_tapped", { destination, rewardedInteracted });
    await maybeShowResultsInterstitial(rewardedInteracted, (visible) => audioManager.setPaused(visible));
    if (destination === "retry") startRun();
    else backToMenu();
}

function handleEvent(event: GameEvent): void {
    scene.handleEvent(event);
    // The coach advances on demonstration, so it needs the player's own actions.
    if (event.type === "shot") coachShots += 1;
    // Level 1 holds two bodies and falls in seconds, so clearing it is no proof
    // the player met every lesson — the throw in particular only comes up once
    // a gun runs dry. Give onboarding room, then stop nagging.
    if (event.type === "level_clear" && event.level >= FTUE_LAST_COACHED_LEVEL) finishCoach();
    if (event.type === "shot") {
        const heavy = event.weapon === "shotgun" || event.weapon === "launcher";
        audioManager.play(heavy ? "shot_heavy" : "shot_light");
        haptic(heavy ? "medium" : "light");
    } else if (event.type === "enemy_shot") {
        audioManager.play("shot_far");
    } else if (event.type === "throw") {
        audioManager.play("throw");
        haptic("light");
    } else if (event.type === "enemy_hit") {
        audioManager.play("hit");
    } else if (event.type === "enemy_down") {
        audioManager.play("down");
        hitStop = Math.max(hitStop, event.style ? HIT_STOP_HEAVY_SECONDS : HIT_STOP_SECONDS);
        if (!firstDownRecorded) {
            firstDownRecorded = true;
            recordAnalytics("first_enemy_down");
        }
    } else if (event.type === "pickup") {
        audioManager.play("pickup");
        haptic("light");
    } else if (event.type === "graze") {
        audioManager.play("graze");
    } else if (event.type === "blast") {
        audioManager.play("blast");
        hitStop = Math.max(hitStop, HIT_STOP_HEAVY_SECONDS);
        haptic("heavy");
    } else if (event.type === "chain") {
        if (event.count >= 3) ui.milestone(`${event.count} IN A BREATH`, `x${event.multiplier.toFixed(2)}`);
    } else if (event.type === "resupply") {
        audioManager.play("pickup");
    } else if (event.type === "shield_used") {
        audioManager.play("reward");
        haptic("heavy");
    } else if (event.type === "level_start") {
        ui.setLevelPlan(planLabel(core.snapshot()), levelNote(event.level));
        if (event.plan.elite) ui.milestone(`ACT ${event.plan.act}`, "ELITE PAGE");
        else if (event.plan.modifier) ui.milestone(MODIFIERS[event.plan.modifier].name, `LEVEL ${event.level}`);
        recordAnalytics("level_started", {
            level: event.level,
            archetype: event.plan.archetype,
            modifier: event.plan.modifier,
            elite: event.plan.elite,
            total: event.total,
        });
    } else if (event.type === "level_clear") {
        audioManager.play("wave");
        haptic("success");
        ui.milestone(`LEVEL ${event.level}`, "CLEARED");
        ui.toast(`+${event.bonus} · ${WEAPONS[event.reward].name} DROPPED`);
        recordAnalytics("level_cleared", { level: event.level, bonus: event.bonus, reward: event.reward });
    } else if (event.type === "draft_open") {
        audioManager.play("reward");
        ui.showDraft(event.offers, core.snapshot().level + 1);
    } else if (event.type === "booster_taken") {
        audioManager.play("upgrade" in audioManager ? "reward" : "reward");
        haptic("success");
        ui.toast(`${BOOSTERS[event.id].name} TAKEN`);
        recordAnalytics("booster_taken", { boosterId: event.id, stacks: event.stacks });
    } else if (event.type === "revive") {
        audioManager.play("reward");
        ui.milestone("SECOND WIND", `LEVEL ${event.level}`);
    } else if (event.type === "player_down") {
        audioManager.play("defeat");
        hitStop = Math.max(hitStop, 0.16);
        haptic("error");
    }
}

function bankRun(snapshot: CoreSnapshot): void {
    if (runBanked) return;
    runBanked = true;
    const ink = inkForScore(snapshot.score);
    saveSystem.recordRun({
        score: snapshot.score,
        level: snapshot.level,
        downs: snapshot.downs,
        grazes: snapshot.grazes,
        bestChain: snapshot.bestChain,
        boosters: boosterCount(snapshot),
        ink,
    });
    void saveSystem.flush();
    recordAnalytics("run_ended", {
        score: snapshot.score,
        level: snapshot.level,
        downs: snapshot.downs,
        grazes: snapshot.grazes,
        bestChain: snapshot.bestChain,
        boosters: boosterCount(snapshot),
        revives: snapshot.revives,
        elapsed: Math.round(snapshot.elapsed),
    });
}

function showResults(snapshot: CoreSnapshot): void {
    const before = saveSystem.get().records.bestScore;
    bankRun(snapshot);
    ui.showResults({
        score: snapshot.score,
        level: snapshot.level,
        downs: snapshot.downs,
        grazes: snapshot.grazes,
        bestChain: snapshot.bestChain,
        boosters: boosterCount(snapshot),
        ink: inkForScore(snapshot.score),
        bestScore: before,
        revives: snapshot.revives,
    });
}

/**
 * Feeds the onboarding coach one frame. It only ever advances by watching the
 * player actually move, fire, and throw, so the lesson cannot be dismissed
 * before it has landed.
 */
function advanceCoach(snapshot: CoreSnapshot, moved: number, delta: number): void {
    if (ftue.isComplete() || snapshot.phase !== "running") {
        coachShots = 0;
        return;
    }
    const changed = ftue.observe({ delta, moved, shots: coachShots });
    coachShots = 0;
    if (!changed) return;
    ui.showCoach(ftue.step());
    if (ftue.isComplete()) finishCoach();
}

function finishCoach(): void {
    ftue.finish();
    ui.showCoach(null);
    if (!saveSystem.get().progress.controlsSeen) {
        saveSystem.markControlsSeen();
        void saveSystem.flush();
        recordAnalytics("ftue_completed");
    }
}

function updateUiForPhase(snapshot: CoreSnapshot): void {
    if (snapshot.phase === lastPhase) return;
    lastPhase = snapshot.phase;
    if (snapshot.phase === "defeat") {
        audioManager.setPaused(false);
        runRevives = snapshot.revives;
        showResults(snapshot);
    } else if (snapshot.phase === "running" || snapshot.phase === "interlude") {
        ui.showRunning();
    } else if (snapshot.phase === "paused") {
        ui.showPause();
    }
    // The draft screen is opened by its own event so the offers arrive with it.
}

function frame(): void {
    const delta = Math.min(0.05, scene.app.ticker.deltaMS / 1000);
    const profiling = performanceHud.isEnabled();
    const simulationStarted = profiling ? performance.now() : 0;
    if (!qaSimulationFrozen) {
        const player = core.snapshot().player;
        core.setInput(ui.input(player.x, player.y));
        // Hit stop holds the world for a beat while the renderer keeps drawing.
        if (hitStop > 0) hitStop = Math.max(0, hitStop - delta);
        else core.update(delta);
    }
    const snapshot = core.snapshot();
    const previousX = coachX;
    const previousY = coachY;
    coachX = snapshot.player.x;
    coachY = snapshot.player.y;
    for (const event of core.drainEvents()) handleEvent(event);
    advanceCoach(snapshot, Math.hypot(coachX - previousX, coachY - previousY), delta);
    const renderStarted = profiling ? performance.now() : 0;
    scene.render(snapshot, delta);
    const hudStarted = profiling ? performance.now() : 0;
    audioManager.setTension(snapshot.phase === "running" ? snapshot.timeScale : 0);
    if (performance.now() - lastHudUpdate > 70) {
        ui.updateHud(snapshot);
        lastHudUpdate = performance.now();
    }
    updateUiForPhase(snapshot);
    if (profiling) {
        const finished = performance.now();
        performanceHud.recordFrame({
            frameMs: scene.app.ticker.deltaMS,
            simulationMs: renderStarted - simulationStarted,
            renderMs: hudStarted - renderStarted,
            hudMs: finished - hudStarted,
        });
    }
}

async function boot(): Promise<void> {
    updateBoot(12, "LINKING RUN SYSTEMS");
    await initSdk();
    bindRunSafeArea();

    updateBoot(30, "OPENING THE LEDGER");
    saveSource = await saveSystem.load();
    const saved = saveSystem.get();
    initializeRewardedAdsSession();
    initializeInterstitialAdsSession();
    await Promise.all([refreshServerTime(), refreshMonetizationRuntime()]);
    await Promise.all([refreshCommerce(), refreshRewardedAdAvailability(), refreshInterstitialAdAvailability()]);
    await reconcilePendingPurchase();
    // The player is here, so any pending nudge has done its job. Re-arm from
    // the current clock rather than leaving a stale one queued.
    await refreshNotificationPermission();
    await clearPendingReminder();
    void syncDailyReminder();
    audioManager.applySettings(saved.settings);
    audioManager.bindUnlock();
    document.documentElement.dataset.reducedMotion = String(saved.settings.reducedMotion);

    updateBoot(56, "RULING THE PAGE");
    const host = document.getElementById("scene-host");
    if (!host) throw new Error("Missing #scene-host");
    scene = await GameScene.create(host);
    scene.setReducedMotion(saved.settings.reducedMotion);
    scene.setPalette(enforceOwnedSelection());
    scene.applyPaletteToDocument();
    scene.render(core.snapshot(), 0);

    updateBoot(84, "LOADING SEVEN ROUNDS");
    ui = new UiController(saved.settings, saved.records, saved.progress, saveSource, {
        onPlay: startRun,
        onRetry: async (rewardedInteracted) => {
            recordAnalytics("retry_tapped");
            await exitResults("retry", rewardedInteracted);
        },
        onMenu: async (rewardedInteracted) => {
            await exitResults("menu", rewardedInteracted);
        },
        onPause: pauseRun,
        onResume: resumeRun,
        onEndRun: () => {
            audioManager.setPaused(false);
            core.forceResults();
        },
        onSwap: () => core.requestSwap(),
        onChooseBooster: (index) => {
            if (core.chooseBooster(index)) {
                lastPhase = "running";
                ui.showRunning();
            }
        },
        onToggleKit: (id: BoosterId) => {
            const current = [...saveSystem.get().kit];
            const at = current.indexOf(id);
            if (at >= 0) {
                current.splice(at, 1);
                saveSystem.setKit(current);
                void saveSystem.flush();
                return `${BOOSTERS[id].name} DROPPED`;
            }
            if (current.length >= KIT_SLOTS) return "THE KIT ONLY HOLDS TWO";
            const cost = BOOSTERS[id].inkCost ?? 0;
            const packedCost = current.reduce((total, packed) => total + (BOOSTERS[packed].inkCost ?? 0), 0);
            if (saveSystem.get().wallet.ink < packedCost + cost) return "NOT ENOUGH INK FOR THAT KIT";
            current.push(id);
            saveSystem.setKit(current);
            void saveSystem.flush();
            audioManager.play("ui");
            haptic("light");
            return `${BOOSTERS[id].name} PACKED`;
        },
        onSettingsChanged: applySettings,
        onPerformanceHudChanged: (enabled) => performanceHud.setEnabled(enabled),
        onDailyReminderChanged: (enabled) => setDailyReminderEnabled(enabled),
        onReminderView: () => reminderView(),
        onReplayTutorial: () => {
            saveSystem.resetControlsSeen();
            void saveSystem.flush();
            recordAnalytics("ftue_replay_requested");
        },
        onSelectPalette: (id: PaletteId) => {
            if (!paletteIsOwned(id)) return "THAT PAGE IS NOT UNLOCKED";
            saveSystem.setSelectedPalette(id);
            scene.setPalette(id);
            void saveSystem.flush();
            audioManager.play("ui");
            haptic("light");
            return `${PALETTE_ENTRIES[id].name} IN USE`;
        },
        onBuyPaletteWithInk: (id: PaletteId) => {
            const cost = paletteInkCost(id);
            if (cost === null) return "THAT PAGE IS NOT SOLD FOR INK";
            if (!saveSystem.unlockPaletteWithInk(id, cost)) return "NOT ENOUGH INK YET";
            saveSystem.setSelectedPalette(id);
            scene.setPalette(id);
            void saveSystem.flush();
            audioManager.play("reward");
            haptic("success");
            recordAnalytics("palette_unlocked", { paletteId: id, cost });
            return `${PALETTE_ENTRIES[id].name} INKED`;
        },
        onPurchaseProduct: async (productId: CommerceProductId, placement = "ledger") => {
            recordAnalytics("purchase_tapped", { productId, placement });
            const outcome = await purchaseProduct(productId, placement);
            if (!outcome) return "PURCHASE CURRENTLY UNAVAILABLE";
            await refreshCommerce();
            scene.setPalette(enforceOwnedSelection());
            if (outcome.status === "confirmed") {
                audioManager.play("reward");
                haptic("success");
                ui.refreshMeta();
                if (isInkCase(productId)) return "VERIFIED · INK ADDED";
                if (productId === "no_interstitials") return "VERIFIED · AD-FREE FOREVER ACTIVE";
                if (productId === "founder_bundle") return "VERIFIED · EVERY PAGE UNLOCKED";
                return "VERIFIED · BLUEPRINT AND CARBON UNLOCKED";
            }
            if (outcome.status === "cancelled") return "PURCHASE CANCELLED";
            if (outcome.status === "failed") return "PURCHASE FAILED · NOTHING GRANTED";
            return "ORDER PENDING · RUN WILL RECONCILE";
        },
        onClaimDaily: async () => {
            const result = await claimDailyReward();
            recordAnalytics("daily_reward_claim", { ok: result.ok, reward: result.message });
            if (result.ok) {
                audioManager.play("reward");
                haptic("success");
                // Today's page is spent, so point the reminder at tomorrow's.
                void syncDailyReminder();
            }
            return result.message;
        },
        onRefreshMonetization: refreshMonetization,
        onRefreshMonetizationDiagnostics: async () => {
            await refreshMonetization();
            return monetizationDiagnosticsView();
        },
        onTestRewardedAd: async () => {
            const outcome = await testRewardedAd((visible) => audioManager.setPaused(visible));
            return outcome.message;
        },
        onTestInterstitialAd: async () => testInterstitialAd((visible) => audioManager.setPaused(visible)),
        onClaimSecondWind: async () => {
            const outcome = await claimSecondWind(runRevives, (visible) => audioManager.setPaused(visible));
            if (outcome.granted) {
                // The run is un-banked: the score keeps climbing on the same page.
                runBanked = false;
                runRevives += 1;
                core.revive();
                lastPhase = "running";
                ui.showRunning();
                audioManager.play("reward");
                haptic("success");
            }
            return outcome;
        },
        onMonetizationSurfaceViewed: (surfaceId) => {
            recordAnalytics("monetization_surface_viewed", {
                surfaceId,
                placement: `${surfaceId}_screen`,
                progression: saveSystem.get().records.deepestLevel,
            });
        },
        onAdOfferViewed: (status: string) => {
            recordAnalytics("ad_offer_viewed", {
                placementId: "rewarded_second_wind",
                adType: "rewarded",
                rewardId: "second_wind_revive",
                status,
            });
        },
    });
    ui.setWorldMapper((clientX, clientY) => scene.toWorld(clientX, clientY));
    ui.setTouchAimListener((point, held) => scene.setTouchAim(point, held));
    ui.setTargetProvider((x, y) => {
        let best: { x: number; y: number } | null = null;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (const enemy of core.snapshot().enemies) {
            const distance = Math.hypot(enemy.x - x, enemy.y - y);
            if (distance >= bestDistance) continue;
            bestDistance = distance;
            best = { x: enemy.x, y: enemy.y };
        }
        return best;
    });
    scene.app.ticker.add(frame);

    registerLifecycles({
        onPause: pauseRun,
        onResume: resumeRun,
        onSleep: () => {
            core.pause();
            audioManager.setPaused(true);
            void saveSystem.flush();
        },
        onAwake: () => {
            void refreshServerTime();
            void refreshMonetization();
            resumeRun();
        },
        onQuit: () => void saveSystem.flush(),
        onBackButton: () => {
            const phase = core.snapshot().phase;
            if (phase === "running" || phase === "interlude") pauseRun();
            else if (phase === "paused") backToMenu();
            else void requestHostExit();
        },
    });
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) pauseRun();
    });

    installBrowserQaContract(core, scene, ui, performanceHud, startRun, () => {
        qaSimulationFrozen = true;
    });
    if (import.meta.env.DEV && monetizationPlan.model !== "none") {
        console.info(
            `[monetization] ${monetizationPlacements.all().length} placements and ${monetizationProducts.all().length} products stay fail-closed until the RUN catalog and LiveOps controls are live.`,
        );
    }
    recordAnalytics("game_loaded", {
        version: __APP_VERSION__,
        saveSource,
        orientation: scene.getViewport().orientation,
    });

    updateBoot(100, "PAGE READY");
    window.setTimeout(liftBootCover, 140);
}

function preventBrowserChrome(event: Event): void {
    event.preventDefault();
}

document.addEventListener("selectstart", preventBrowserChrome);
document.addEventListener("contextmenu", preventBrowserChrome);
document.addEventListener("dragstart", preventBrowserChrome);

window.addEventListener("unhandledrejection", (event) => {
    console.warn("[runtime] guarded unhandled rejection", event.reason);
    event.preventDefault();
});

void boot().catch((error) => {
    console.error("[boot] fatal startup failure", error);
    updateBoot(100, "BOOT FAILED · RELOAD TO RETRY");
});

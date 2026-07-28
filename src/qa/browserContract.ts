import type { GameCore } from "../game/core.ts";
import type { GameScene } from "../game/scene.ts";
import type { UiController } from "../ui/controller.ts";
import type { PerformanceHud } from "../ui/performanceHud.ts";

/**
 * Development-only semantic contract for headless QA. It may set up local test
 * state but never fabricates a RUN ad, purchase, entitlement, or reward.
 */
export function installBrowserQaContract(
    core: GameCore,
    scene: GameScene,
    ui: UiController,
    performanceHud: PerformanceHud,
    startRun: () => void,
    freezeSimulation: () => void,
): void {
    if (!import.meta.env.DEV || new URLSearchParams(window.location.search).get("qa") !== "1") return;
    let qaInput = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, firing: false };
    window.__deadstopQa = {
        snapshot: () => {
            const snapshot = core.snapshot();
            const viewport = scene.getViewport();
            const diagnostics = scene.getPerformanceDiagnostics();
            return {
                phase: snapshot.phase,
                orientation: viewport.orientation,
                viewport: `${viewport.width}x${viewport.height}`,
                timeScale: snapshot.timeScale,
                score: snapshot.score,
                level: snapshot.level,
                levelRemaining: snapshot.levelRemaining,
                levelTotal: snapshot.levelTotal,
                archetype: snapshot.levelPlan.archetype,
                modifier: snapshot.levelPlan.modifier,
                elite: snapshot.levelPlan.elite,
                act: snapshot.levelPlan.act,
                boosters: Object.entries(snapshot.boosters)
                    .filter(([, stacks]) => stacks > 0)
                    .map(([id, stacks]) => `${id}:${stacks}`),
                draftOffers: snapshot.draftOffers.map((offer) => `${offer.kind}:${offer.id}`),
                shields: snapshot.player.shields,
                downs: snapshot.downs,
                grazes: snapshot.grazes,
                chain: snapshot.chain,
                bestChain: snapshot.bestChain,
                revives: snapshot.revives,
                alive: snapshot.player.alive,
                weapon: snapshot.player.weapon?.id ?? null,
                rounds: snapshot.player.weapon?.rounds ?? 0,
                playerX: Math.round(snapshot.player.x),
                playerY: Math.round(snapshot.player.y),
                enemies: snapshot.enemies.length,
                enemyKinds: snapshot.enemies.map((enemy) => enemy.kind),
                enemyPositions: snapshot.enemies.map((enemy) => [Math.round(enemy.x), Math.round(enemy.y)]),
                touchAim: scene.getTouchAim(),
                bullets: snapshot.bullets.length,
                bulletHeads: snapshot.bullets.map((bullet) => [Math.round(bullet.x), Math.round(bullet.y)]),
                thrown: snapshot.thrown.length,
                drops: snapshot.drops.length,
                outlines: snapshot.outlines.length,
                cover: snapshot.cover.length,
                rewardWeapon: snapshot.rewardWeapon,
                specks: diagnostics.specks,
                smears: diagnostics.smears,
                popups: diagnostics.popups,
                cameraShake: diagnostics.cameraShake,
                palette: diagnostics.palette,
                scale: diagnostics.scale,
                performance: performanceHud.snapshot(),
            };
        },
        startRun,
        setInput: (input) => {
            qaInput = {
                moveX: input.moveX ?? qaInput.moveX,
                moveY: input.moveY ?? qaInput.moveY,
                aimX: input.aimX ?? qaInput.aimX,
                aimY: input.aimY ?? qaInput.aimY,
                firing: input.firing ?? qaInput.firing,
            };
            core.setInput(qaInput);
        },
        step: (seconds, steps = 1) => {
            for (let index = 0; index < Math.max(1, Math.floor(steps)); index += 1) {
                core.setInput(qaInput);
                core.update(seconds);
            }
        },
        forceEnemy: (kind, distance, angle) => core.forceEnemy(kind, distance, angle),
        forceLevel: (level) => core.forceLevel(level),
        forceBooster: (id) => core.forceBooster(id),
        forceDraft: () => core.forceDraft(),
        chooseBooster: (index) => core.chooseBooster(index),
        forceWeapon: (weapon, rounds) => core.forceWeapon(weapon, rounds),
        forceResults: () => core.forceResults(),
        openSettings: () => ui.openSettings("menu"),
        openDailyRewards: () => ui.showDaily(),
        openLedger: () => ui.showLedger(),
        openKit: () => ui.showKit(),
        pause: () => {
            core.pause();
            ui.showPause();
        },
        resume: () => {
            core.resume();
            ui.showRunning();
        },
        freezeSimulation,
        setPalette: (id) => scene.setPalette(id),
        setReducedMotion: (enabled) => scene.setReducedMotion(enabled),
        setPerformanceHud: (enabled) => ui.setPerformanceHudEnabled(enabled),
        showMilestone: (kicker, title) => ui.milestone(kicker, title),
    };
}

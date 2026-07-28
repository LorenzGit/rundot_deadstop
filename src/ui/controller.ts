import { BOOSTERS, type BoosterId, KIT_BOOSTER_IDS, KIT_SLOTS, WEAPONS, type WeaponId } from "../game/config.ts";
import type { CoreInput } from "../game/core.ts";
import type { CoreSnapshot, DraftOffer } from "../game/types.ts";
import {
    type CommerceProductId,
    inkCaseAmount,
    paletteCommerceView,
    productCommerceView,
} from "../systems/commerce.ts";
import { PALETTE_ENTRIES, PALETTE_IDS, PALETTES, type PaletteId } from "../systems/cosmetics.ts";
import { dailyRewardsView } from "../systems/dailyRewards.ts";
import { resultsBreakLabel } from "../systems/interstitialAds.ts";
import type { MonetizationDiagnosticsView } from "../systems/monetization/diagnostics.ts";
import type { ReminderView } from "../systems/notifications.ts";
import { secondWindView } from "../systems/rewardedAds.ts";
import type { GameProgress, GameRecords, GameSettings, SaveSource, TouchControlsMode } from "../systems/save.ts";
import { saveSystem } from "../systems/save.ts";
import { boosterIcon, weaponIcon } from "./boosterIcons.ts";
import type { FtueStep } from "./ftue.ts";
import { floatingStickVector } from "./touchStick.ts";

export interface RunSummary {
    score: number;
    level: number;
    downs: number;
    grazes: number;
    bestChain: number;
    boosters: number;
    ink: number;
    bestScore: number;
    revives: number;
}

/** Where the nearest hostile is, for touch aim assist. */
export type TargetProvider = (x: number, y: number) => { x: number; y: number } | null;

export interface UiCallbacks {
    onPlay(): void;
    onRetry(rewardedInteracted: boolean): Promise<void>;
    onMenu(rewardedInteracted: boolean): Promise<void>;
    onPause(): void;
    onResume(): void;
    onEndRun(): void;
    onSwap(): void;
    onChooseBooster(index: number): void;
    onSettingsChanged(settings: GameSettings): void;
    onPerformanceHudChanged(enabled: boolean): void;
    onReplayTutorial(): void;
    onDailyReminderChanged(enabled: boolean): Promise<ReminderView>;
    onReminderView(): ReminderView;
    onToggleKit(id: BoosterId): string;
    onSelectPalette(id: PaletteId): string;
    onBuyPaletteWithInk(id: PaletteId): string;
    onPurchaseProduct(productId: CommerceProductId, placement?: string): Promise<string>;
    onClaimDaily(): Promise<string>;
    onRefreshMonetization(): Promise<void>;
    onRefreshMonetizationDiagnostics(): Promise<MonetizationDiagnosticsView>;
    onTestRewardedAd(): Promise<string>;
    onTestInterstitialAd(): Promise<string>;
    onClaimSecondWind(): Promise<{ granted: boolean; message: string }>;
    onMonetizationSurfaceViewed(surfaceId: "ledger" | "settings" | "kit"): void;
    onAdOfferViewed(status: string): void;
}

function element<T extends HTMLElement>(id: string): T {
    const value = document.getElementById(id);
    if (!value) throw new Error(`Missing #${id}`);
    return value as T;
}

const OFFER_PRESENTATION: Readonly<
    Record<CommerceProductId, { name: string; kicker: string; description: string; featured?: boolean }>
> = {
    ledger_pack: {
        name: "LEDGER PACK",
        kicker: "TWO PERMANENT PAGES",
        description: "Unlocks the BLUEPRINT and CARBON pages forever. Presentation only.",
    },
    no_interstitials: {
        name: "AD-FREE FOREVER",
        kicker: "REMOVES THE RESULTS BREAK",
        description: "No more mandatory interstitials. Optional Second Wind videos stay available.",
    },
    founder_bundle: {
        name: "FIRST PEN BUNDLE",
        kicker: "BEST VALUE · ALL PERMANENT",
        description: "Ad-free, both Ledger Pack pages, and the exclusive RED PEN page.",
        featured: true,
    },
    ink_case_small: {
        name: "SMALL INK CASE",
        kicker: "600 INK",
        description: "A top-up for the kit. Every booster is still earnable by playing.",
    },
    ink_case_medium: {
        name: "INK CASE",
        kicker: "2,000 INK · BETTER RATE",
        description: "Enough for several stacked kits.",
        featured: true,
    },
    ink_case_large: {
        name: "LARGE INK CASE",
        kicker: "5,000 INK · BEST RATE",
        description: "For players who want every page and a full kit every run.",
    },
};

const AIM_REACH = 420;
/**
 * Touch aiming is absolute: the shot goes where the finger is. A hostile within
 * this many world units of the touched point captures the shot, so tapping near
 * someone hits them rather than sailing past.
 */
const TAP_SNAP_RADIUS = 110;
const TAP_SNAP_STRENGTH = 0.85;
/** A press shorter than this with no real travel is a single deliberate shot. */
const TAP_SHOT_MS = 320;
/**
 * The movement stick is permanent and drawn, so its footprint is the ring the
 * player can see rather than a hidden slab of the page. Knob travel follows the
 * ring's rendered radius; this floor only guards a stick squeezed by a tiny
 * viewport from becoming hair-trigger.
 */
const MIN_STICK_RADIUS = 40;
const STICK_DEADZONE = 7;

export class UiController {
    private readonly callbacks: UiCallbacks;
    private readonly screens = {
        menu: element<HTMLElement>("menu-screen"),
        kit: element<HTMLElement>("kit-screen"),
        ledger: element<HTMLElement>("ledger-screen"),
        daily: element<HTMLElement>("daily-screen"),
        settings: element<HTMLElement>("settings-screen"),
        draft: element<HTMLElement>("draft-screen"),
        pause: element<HTMLElement>("pause-screen"),
        results: element<HTMLElement>("results-screen"),
        monetizationTest: element<HTMLElement>("monetization-test-screen"),
    };
    private readonly hud = element<HTMLElement>("hud");
    private readonly touchControls = element<HTMLElement>("touch-controls");
    private readonly keyLegend = element<HTMLElement>("key-legend");
    private readonly appFrame = element<HTMLElement>("app-frame");
    private readonly stickBase = element<HTMLElement>("stick-base");
    private readonly stickKnob = element<HTMLElement>("stick-knob");
    private readonly moveZone = element<HTMLElement>("move-zone");
    private readonly aimZone = element<HTMLElement>("aim-zone");
    private readonly tapTutorial = element<HTMLElement>("tap-tutorial");
    private readonly milestoneElement = element<HTMLElement>("milestone");
    private readonly flowWipe = element<HTMLElement>("flow-wipe");
    private readonly ammoPips = element<HTMLElement>("ammo-pips");
    private readonly boosterStrip = element<HTMLElement>("booster-strip");
    private readonly weaponSlot = element<HTMLElement>("weapon-text").parentElement as HTMLElement;
    private readonly fpsCounterInput = element<HTMLInputElement>("fps-counter");
    private readonly settingsInputs = {
        musicEnabled: element<HTMLInputElement>("music-enabled"),
        musicVolume: element<HTMLInputElement>("music-volume"),
        sfxEnabled: element<HTMLInputElement>("sfx-enabled"),
        sfxVolume: element<HTMLInputElement>("sfx-volume"),
        hapticsEnabled: element<HTMLInputElement>("haptics-enabled"),
        reducedMotion: element<HTMLInputElement>("reduced-motion"),
        autoFire: element<HTMLInputElement>("auto-fire"),
        dailyReminder: element<HTMLInputElement>("daily-reminder"),
    };
    private readonly touchModeSelect = element<HTMLSelectElement>("touch-controls-mode");

    private settings: GameSettings;
    private settingsReturn: "menu" | "pause" = "menu";
    private readonly keys = new Set<string>();
    private inputEnabled = false;
    /**
     * Which control scheme is live right now. This is never decided once at
     * boot: a hybrid laptop, an iPad with a keyboard, and a phone all report
     * different things, so the mode follows whatever the player actually used
     * last.
     */
    private inputMode: "mouse" | "touch" = "mouse";
    /** The onboarding step on screen, kept so a device switch can re-caption it. */
    private coachStep: FtueStep | null = null;
    private readonly touchCapable =
        (navigator.maxTouchPoints ?? 0) > 0 ||
        window.matchMedia("(any-pointer: coarse)").matches ||
        "ontouchstart" in window;

    private pointerAimX = 1;
    private pointerAimY = 0;
    private mouseClientX: number | null = null;
    private mouseClientY: number | null = null;
    private mouseFiring = false;
    private buttonFiring = false;

    private movePointer: number | null = null;
    private moveX = 0;
    private moveY = 0;

    private aimPointer: number | null = null;
    private aimStartedAt = 0;
    /** The world point the finger is on, which is exactly where the shot goes. */
    private touchAimX: number | null = null;
    private touchAimY: number | null = null;
    private touchAimHeld = false;
    private aimTapFire = false;

    private toastTimer = 0;
    private milestoneTimer = 0;
    private flowTimer = 0;
    private ammoRendered = -1;
    private weaponRendered: WeaponId | "none" | null = null;
    private boosterSignature = "";
    private resultsRevives = 0;
    private resultsAdOfferRecorded = false;
    private resultsRewardedInteracted = false;
    private resultsExitInFlight = false;
    private versionTapCount = 0;
    private versionTapTimer = 0;
    private monetizationDiagnostics: MonetizationDiagnosticsView | null = null;
    private toWorld: (clientX: number, clientY: number) => { x: number; y: number } = (x, y) => ({ x, y });
    private nearestTarget: TargetProvider = () => null;
    private onTouchAim: (point: { x: number; y: number } | null, held: boolean) => void = () => undefined;

    constructor(
        settings: GameSettings,
        records: GameRecords,
        progress: GameProgress,
        saveSource: SaveSource,
        callbacks: UiCallbacks,
    ) {
        this.callbacks = callbacks;
        this.settings = { ...settings };
        // Touch starts live on anything that can be touched at all, so a phone
        // never lands on a keyboard-only screen.
        this.inputMode = this.touchCapable && window.matchMedia("(pointer: coarse)").matches ? "touch" : "mouse";
        this.applyInputMode();
        element("version-label").textContent = `v${__APP_VERSION__}`;
        element("save-badge").textContent = saveSource === "run" ? "RUN CLOUD" : "LOCAL SAVE";
        this.updateRecords(records, progress);
        this.populateSettings();
        this.bindButtons();
        this.bindSettings();
        this.bindInput();
    }

    setWorldMapper(mapper: (clientX: number, clientY: number) => { x: number; y: number }): void {
        this.toWorld = mapper;
    }

    setTargetProvider(provider: TargetProvider): void {
        this.nearestTarget = provider;
    }

    /** Lets the renderer draw a reticle wherever the finger is aiming. */
    setTouchAimListener(listener: (point: { x: number; y: number } | null, held: boolean) => void): void {
        this.onTouchAim = listener;
    }

    /** True when the on-screen sticks and buttons should be present. */
    private touchControlsVisible(): boolean {
        const mode: TouchControlsMode = this.settings.touchControls;
        if (mode === "on") return true;
        if (mode === "off") return false;
        return this.touchCapable || this.inputMode === "touch";
    }

    private applyInputMode(): void {
        const visible = this.touchControlsVisible();
        document.body.dataset.pointer = visible ? "coarse" : "fine";
        document.body.dataset.inputMode = this.inputMode;
        // With auto-fire on, the aim stick is the trigger, so the FIRE button
        // would only be eating thumb space.
        document.body.dataset.autoFire = this.settings.autoFire ? "on" : "off";
        // Switching device mid-run must re-caption the live coaching step.
        if (this.coachStep) this.showCoach(this.coachStep);
    }

    /** Switches scheme the moment the player uses a different device. */
    private noteInputMode(mode: "mouse" | "touch"): void {
        if (this.inputMode === mode) return;
        this.inputMode = mode;
        if (mode === "touch") {
            this.mouseClientX = null;
            this.mouseClientY = null;
            this.mouseFiring = false;
        } else {
            this.releaseStick();
            this.releaseAim();
        }
        this.applyInputMode();
    }

    /* ----------------------------------------------------------------- input */

    input(playerX: number, playerY: number): CoreInput {
        if (!this.inputEnabled) {
            return {
                moveX: 0,
                moveY: 0,
                aimX: playerX + this.pointerAimX,
                aimY: playerY + this.pointerAimY,
                firing: false,
            };
        }
        const keyX =
            Number(this.keys.has("arrowright") || this.keys.has("d")) -
            Number(this.keys.has("arrowleft") || this.keys.has("a"));
        const keyY =
            Number(this.keys.has("arrowdown") || this.keys.has("s")) -
            Number(this.keys.has("arrowup") || this.keys.has("w"));
        const keyboardActive = Math.abs(keyX) + Math.abs(keyY) > 0;
        const moveX = keyboardActive ? keyX : this.moveX;
        const moveY = keyboardActive ? keyY : this.moveY;

        let aimX = playerX + this.pointerAimX * AIM_REACH;
        let aimY = playerY + this.pointerAimY * AIM_REACH;
        if (this.inputMode === "mouse" && this.mouseClientX !== null && this.mouseClientY !== null) {
            const world = this.toWorld(this.mouseClientX, this.mouseClientY);
            aimX = world.x;
            aimY = world.y;
        } else if (this.touchAimX !== null && this.touchAimY !== null) {
            // Absolute aim: the shot goes at the spot under the finger.
            const snapped = this.snapToTarget(this.touchAimX, this.touchAimY);
            aimX = snapped.x;
            aimY = snapped.y;
            this.pointerAimX = aimX - playerX;
            this.pointerAimY = aimY - playerY;
            const span = Math.hypot(this.pointerAimX, this.pointerAimY) || 1;
            this.pointerAimX /= span;
            this.pointerAimY /= span;
        }

        // Holding a spot keeps firing at it; a tap is one deliberate shot.
        const holdFiring = this.settings.autoFire && this.touchAimHeld;
        const firing = this.mouseFiring || this.buttonFiring || this.aimTapFire || holdFiring;
        this.aimTapFire = false;
        return { moveX, moveY, aimX, aimY, firing };
    }

    /**
     * A thumb covers about a hundred world units, so a hostile close to the
     * touched point captures the shot. The pull falls off with distance and
     * stops entirely outside the radius, so tapping empty page stays a shot at
     * empty page.
     */
    private snapToTarget(worldX: number, worldY: number): { x: number; y: number } {
        const target = this.nearestTarget(worldX, worldY);
        if (!target) return { x: worldX, y: worldY };
        const distance = Math.hypot(target.x - worldX, target.y - worldY);
        if (distance > TAP_SNAP_RADIUS) return { x: worldX, y: worldY };
        const pull = TAP_SNAP_STRENGTH * (1 - distance / TAP_SNAP_RADIUS);
        return {
            x: worldX + (target.x - worldX) * pull,
            y: worldY + (target.y - worldY) * pull,
        };
    }

    /* --------------------------------------------------------------- screens */

    showMenu(records?: GameRecords, progress?: GameProgress): void {
        if (records && progress) this.updateRecords(records, progress);
        this.refreshMeta();
        this.setInputEnabled(false);
        this.activate("menu");
        this.hud.classList.add("hidden");
        this.touchControls.classList.add("hidden");
        this.keyLegend.classList.add("hidden");
        this.tapTutorial.classList.remove("visible");
    }

    showRunning(): void {
        this.deactivateAll();
        this.hud.classList.remove("hidden");
        this.touchControls.classList.remove("hidden");
        this.keyLegend.classList.remove("hidden");
        this.setInputEnabled(true);
        this.flow();
    }

    showPause(): void {
        this.setInputEnabled(false);
        this.activate("pause");
    }

    /** The between-level draft: three cards, one pick, no going back. */
    showDraft(offers: readonly DraftOffer[], nextLevel: number): void {
        this.setInputEnabled(false);
        element("draft-kicker").textContent = `LEVEL ${nextLevel} NEXT`;
        const cards = element<HTMLElement>("draft-cards");
        cards.replaceChildren();
        // Once every booster is maxed the draft hands out guns instead, so a
        // deep run keeps its between-page choice.
        element("draft-title").textContent = offers.some((offer) => offer.kind === "weapon") ? "TAKE ONE" : "PICK ONE";
        offers.forEach((offer, index) => {
            const card = document.createElement("button");
            card.type = "button";
            card.className = "draft-card";
            const kicker = document.createElement("span");
            const name = document.createElement("strong");
            const blurb = document.createElement("small");
            if (offer.kind === "weapon") {
                const weapon = WEAPONS[offer.id];
                kicker.textContent = "FULL LOAD";
                name.textContent = weapon.name;
                blurb.textContent = `${offer.rounds} rounds, in hand for the next page.`;
                card.append(weaponIcon(offer.id), kicker, name, blurb);
            } else {
                const definition = BOOSTERS[offer.id];
                kicker.textContent =
                    offer.stacks > 1 ? `STACK ${offer.stacks} OF ${definition.maxStacks}` : "NEW BOOSTER";
                name.textContent = definition.name;
                blurb.textContent = definition.blurb;
                card.append(boosterIcon(offer.id), kicker, name, blurb);
            }
            card.addEventListener("click", () => this.callbacks.onChooseBooster(index));
            cards.appendChild(card);
        });
        this.activate("draft");
        this.hud.classList.add("hidden");
        this.touchControls.classList.add("hidden");
        this.keyLegend.classList.add("hidden");
    }

    showKit(): void {
        this.setInputEnabled(false);
        this.renderKit();
        this.activate("kit");
        this.callbacks.onMonetizationSurfaceViewed("kit");
        void this.callbacks.onRefreshMonetization().then(() => this.renderKit());
    }

    showLedger(): void {
        this.setInputEnabled(false);
        this.renderLedger();
        this.activate("ledger");
        this.callbacks.onMonetizationSurfaceViewed("ledger");
        void this.callbacks.onRefreshMonetization().then(() => this.renderLedger());
    }

    showDaily(): void {
        this.setInputEnabled(false);
        this.renderDaily();
        this.activate("daily");
    }

    openSettings(from: "menu" | "pause" = "menu"): void {
        this.settingsReturn = from;
        this.populateSettings();
        this.renderSettingsOffer();
        this.setInputEnabled(false);
        this.activate("settings");
        if (from === "menu") this.callbacks.onMonetizationSurfaceViewed("settings");
        void this.callbacks.onRefreshMonetization().then(() => this.renderSettingsOffer());
    }

    async showMonetizationTest(): Promise<void> {
        this.setInputEnabled(false);
        const view = await this.callbacks.onRefreshMonetizationDiagnostics();
        if (!view.enabled) {
            this.toast("PRIVATE TEST BAY DISABLED");
            return;
        }
        this.monetizationDiagnostics = view;
        this.renderMonetizationDiagnostics(view);
        this.activate("monetizationTest");
    }

    showResults(summary: RunSummary): void {
        this.setInputEnabled(false);
        this.resultsRevives = summary.revives;
        this.resultsAdOfferRecorded = false;
        this.resultsRewardedInteracted = false;
        this.resultsExitInFlight = false;
        const retryButton = element<HTMLButtonElement>("retry-button");
        const menuButton = element<HTMLButtonElement>("menu-button");
        retryButton.disabled = false;
        retryButton.textContent = "RUN IT BACK";
        menuButton.disabled = false;
        menuButton.textContent = "MAIN MENU";
        element("results-title").textContent = summary.score >= summary.bestScore ? "NEW BEST" : "DOWN";
        element("results-kicker").textContent =
            summary.revives > 0 ? "ASSISTED RUN · SECOND WIND USED" : "THE PAGE STOPPED";
        element("results-score").textContent = String(summary.score);
        element("results-level").textContent = String(summary.level);
        element("results-downs").textContent = String(summary.downs);
        element("results-chain").textContent = String(summary.bestChain);
        element("results-boosters").textContent = String(summary.boosters);
        element("results-grazes").textContent = String(summary.grazes);
        element("results-ink").textContent = String(summary.ink);
        element("results-best").textContent = String(Math.max(summary.bestScore, summary.score));
        element("results-break-note").textContent = resultsBreakLabel();
        this.renderSecondWind();
        this.activate("results");
        this.hud.classList.add("hidden");
        this.touchControls.classList.add("hidden");
        this.keyLegend.classList.add("hidden");
        this.tapTutorial.classList.remove("visible");
        void this.callbacks.onRefreshMonetization().then(() => this.renderSecondWind());
    }

    /* ------------------------------------------------------------------- HUD */

    updateHud(snapshot: CoreSnapshot): void {
        element("score-text").textContent = String(snapshot.score);
        const chain = element("chain-text");
        chain.classList.toggle("hidden", snapshot.chain < 2);
        if (snapshot.chain >= 2) chain.textContent = `CHAIN x${snapshot.chainMultiplier.toFixed(2)}`;

        element("level-text").textContent = `LEVEL ${snapshot.level}`;
        element("level-remaining").textContent =
            snapshot.phase === "interlude" ? "CLEARED" : `${snapshot.levelRemaining} LEFT`;

        const weapon = snapshot.player.weapon;
        const weaponKey: WeaponId | "none" = weapon?.id ?? "none";
        if (weaponKey !== this.weaponRendered) {
            this.weaponRendered = weaponKey;
            element("weapon-text").textContent = weapon ? WEAPONS[weapon.id].name : "EMPTY HANDS";
            this.weaponSlot.classList.toggle("empty", !weapon);
            this.ammoRendered = -1;
        }
        const rounds = weapon?.rounds ?? 0;
        const capacity = Math.max(weapon?.capacity ?? 0, rounds);
        if (rounds !== this.ammoRendered) {
            this.ammoRendered = rounds;
            this.ammoPips.replaceChildren();
            for (let index = 0; index < Math.min(capacity, 30); index += 1) {
                const pip = document.createElement("i");
                if (index >= rounds) pip.className = "spent";
                this.ammoPips.appendChild(pip);
            }
        }

        const boosterSignature = Object.entries(snapshot.boosters)
            .filter(([, stacks]) => stacks > 0)
            .map(([id, stacks]) => `${id}${stacks}`)
            .join(",");
        if (boosterSignature !== this.boosterSignature) {
            this.boosterSignature = boosterSignature;
            this.boosterStrip.replaceChildren();
            for (const [id, stacks] of Object.entries(snapshot.boosters)) {
                if (stacks <= 0) continue;
                const chip = document.createElement("i");
                const definition = BOOSTERS[id as BoosterId];
                const label = document.createElement("span");
                label.textContent = stacks > 1 ? `${definition.name} x${stacks}` : definition.name;
                chip.append(boosterIcon(id as BoosterId), label);
                this.boosterStrip.appendChild(chip);
            }
        }

        element("time-fill").style.width = `${Math.round(snapshot.timeScale * 100)}%`;
    }

    setLevelPlan(planName: string, note: string): void {
        element("level-plan").textContent = planName;
        element("level-note").textContent = note;
    }

    /**
     * Shows the current onboarding step, or clears the coach when it is done.
     * The copy follows whatever the player last touched, so a hybrid laptop
     * never coaches a keyboard player with thumb instructions.
     */
    showCoach(step: FtueStep | null): void {
        this.coachStep = step;
        if (!step) {
            this.tapTutorial.classList.remove("visible");
            return;
        }
        element("tap-tutorial-copy").textContent = step.title;
        element("tap-tutorial-hint").textContent = this.touchControlsVisible() ? step.touchHint : step.keyboardHint;
        this.tapTutorial.classList.add("visible");
    }

    toast(message: string): void {
        const toast = element("toast");
        toast.textContent = message;
        toast.classList.remove("visible");
        void toast.offsetWidth;
        toast.classList.add("visible");
        if (this.toastTimer) window.clearTimeout(this.toastTimer);
        this.toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 1500);
    }

    milestone(kicker: string, title: string): void {
        element("milestone-kicker").textContent = kicker;
        element("milestone-title").textContent = title;
        this.milestoneElement.classList.remove("visible");
        void this.milestoneElement.offsetWidth;
        this.milestoneElement.classList.add("visible");
        if (this.milestoneTimer) window.clearTimeout(this.milestoneTimer);
        this.milestoneTimer = window.setTimeout(() => this.milestoneElement.classList.remove("visible"), 1400);
    }

    setPerformanceHudEnabled(enabled: boolean): void {
        this.fpsCounterInput.checked = enabled;
        this.callbacks.onPerformanceHudChanged(enabled);
    }

    refreshMeta(): void {
        const saved = saveSystem.get();
        element("wallet-ink").textContent = String(saved.wallet.ink);
        element("ledger-wallet").textContent = String(saved.wallet.ink);
        element("daily-wallet").textContent = String(saved.wallet.ink);
        element("kit-wallet").textContent = String(saved.wallet.ink);
        element("daily-badge").classList.toggle("hidden", !dailyRewardsView().claimable);
        const kitBadge = element("kit-badge");
        kitBadge.textContent = String(saved.kit.length);
        kitBadge.classList.toggle("hidden", saved.kit.length === 0);
    }

    private updateRecords(records: GameRecords, progress: GameProgress): void {
        element("best-score").textContent = String(records.bestScore);
        element("best-level").textContent = String(records.deepestLevel);
        element("lifetime-downs").textContent = String(progress.lifetimeDowns);
    }

    /* ------------------------------------------------------------------- kit */

    private renderReminderStatus(): void {
        element("daily-reminder-status").textContent = this.callbacks.onReminderView().label;
    }

    private renderKit(): void {
        const saved = saveSystem.get();
        const grid = element<HTMLElement>("kit-grid");
        grid.replaceChildren();
        let total = 0;
        for (const id of saved.kit) total += BOOSTERS[id].inkCost ?? 0;
        element("kit-summary").textContent = saved.kit.length
            ? `${saved.kit.map((id) => BOOSTERS[id].name).join(" + ")} · ${total} INK ON START`
            : "NOTHING PACKED · 0 INK";

        for (const id of KIT_BOOSTER_IDS) {
            const definition = BOOSTERS[id];
            const cost = definition.inkCost ?? 0;
            const packed = saved.kit.includes(id);
            const full = saved.kit.length >= KIT_SLOTS && !packed;
            const card = document.createElement("button");
            card.type = "button";
            card.className = `kit-card${packed ? " packed" : ""}`;
            card.disabled = full;
            const name = document.createElement("strong");
            name.textContent = definition.name;
            const blurb = document.createElement("small");
            blurb.textContent = definition.blurb;
            const price = document.createElement("em");
            price.textContent = packed ? "PACKED · TAP TO DROP" : full ? `KIT FULL · ${cost} INK` : `${cost} INK`;
            card.append(boosterIcon(id), name, blurb, price);
            card.addEventListener("click", () => {
                this.toast(this.callbacks.onToggleKit(id));
                this.renderKit();
            });
            grid.appendChild(card);
        }

        this.renderInkCases();
        this.refreshMeta();
    }

    private renderInkCases(): void {
        const grid = element("ink-case-grid");
        grid.replaceChildren();
        const cases: readonly CommerceProductId[] = ["ink_case_small", "ink_case_medium", "ink_case_large"];
        for (const productId of cases) {
            const commerce = productCommerceView(productId);
            if (!commerce.visible) continue;
            const presentation = OFFER_PRESENTATION[productId];
            const card = document.createElement("article");
            card.className = `offer-card${presentation.featured ? " featured" : ""}`;
            const kicker = document.createElement("span");
            kicker.textContent = presentation.kicker;
            const name = document.createElement("strong");
            name.textContent = presentation.name;
            const description = document.createElement("small");
            description.textContent = presentation.description;
            const action = document.createElement("button");
            action.type = "button";
            action.className = "ink-button";
            action.disabled = !commerce.purchasable;
            action.textContent = commerce.purchasable ? `BUY · ${commerce.priceLabel}` : commerce.statusLabel;
            action.addEventListener("click", async () => {
                action.disabled = true;
                action.textContent = "OPENING CHECKOUT…";
                this.toast(await this.callbacks.onPurchaseProduct(productId, "kit_ink_case"));
                this.renderKit();
            });
            card.append(kicker, name, description, action);
            grid.appendChild(card);
        }
    }

    /* ---------------------------------------------------------------- ledger */

    private renderLedger(): void {
        this.renderProductOffers();
        const grid = element<HTMLElement>("palette-grid");
        const selected = saveSystem.get().cosmetics.selectedPalette;
        grid.replaceChildren();
        for (const id of PALETTE_IDS) {
            const entry = PALETTE_ENTRIES[id];
            const commerce = paletteCommerceView(id);
            if (!commerce.visible) continue;
            const palette = PALETTES[id];
            const card = document.createElement("article");
            card.className = `palette-card${selected === id ? " equipped" : ""}`;

            const swatch = document.createElement("div");
            swatch.className = "palette-swatch";
            swatch.setAttribute("aria-hidden", "true");
            for (const colour of [palette.css.page, palette.css.ink, palette.css.hostile, palette.css.accent]) {
                const chip = document.createElement("i");
                chip.style.background = colour;
                swatch.appendChild(chip);
            }

            const kicker = document.createElement("span");
            kicker.textContent = commerce.statusLabel;
            const name = document.createElement("strong");
            name.textContent = entry.name;
            const tagline = document.createElement("small");
            tagline.textContent = entry.tagline;

            const action = document.createElement("button");
            action.type = "button";
            action.className = "ink-button";
            if (commerce.owned) {
                action.textContent = selected === id ? "IN USE" : "USE THIS PAGE";
                action.disabled = selected === id;
                action.addEventListener("click", () => {
                    this.toast(this.callbacks.onSelectPalette(id));
                    this.renderLedger();
                });
            } else if (commerce.inkCost !== null) {
                action.textContent = `INK IT · ${commerce.inkCost}`;
                action.disabled = !commerce.purchasable;
                action.addEventListener("click", () => {
                    this.toast(this.callbacks.onBuyPaletteWithInk(id));
                    this.renderLedger();
                });
            } else if (commerce.productId) {
                const productId = commerce.productId;
                action.textContent = commerce.purchasable ? `BUY · ${commerce.priceLabel}` : commerce.statusLabel;
                action.disabled = !commerce.purchasable;
                action.addEventListener("click", async () => {
                    action.disabled = true;
                    action.textContent = "OPENING CHECKOUT…";
                    this.toast(await this.callbacks.onPurchaseProduct(productId, "ledger_page"));
                    this.renderLedger();
                });
            } else {
                action.textContent = commerce.statusLabel;
                action.disabled = true;
            }

            card.append(swatch, kicker, name, tagline, action);
            grid.appendChild(card);
        }
        this.refreshMeta();
    }

    private renderProductOffers(): void {
        const grid = element("offer-grid");
        grid.replaceChildren();
        const productIds: readonly CommerceProductId[] = ["founder_bundle", "ledger_pack", "no_interstitials"];
        for (const productId of productIds) {
            const commerce = productCommerceView(productId);
            if (!commerce.visible) continue;
            const presentation = OFFER_PRESENTATION[productId];
            const card = document.createElement("article");
            card.className = `offer-card${presentation.featured ? " featured" : ""}${commerce.owned ? " owned" : ""}`;

            const kicker = document.createElement("span");
            kicker.textContent = commerce.owned ? "OWNED · VERIFIED" : presentation.kicker;
            const name = document.createElement("strong");
            name.textContent = presentation.name;
            const description = document.createElement("small");
            description.textContent = presentation.description;

            const action = document.createElement("button");
            action.type = "button";
            action.className = "ink-button";
            action.disabled = commerce.owned || !commerce.purchasable;
            action.textContent = commerce.owned
                ? "OWNED"
                : commerce.purchasable
                  ? `BUY · ${commerce.priceLabel}`
                  : commerce.statusLabel;
            action.addEventListener("click", async () => {
                action.disabled = true;
                action.textContent = "OPENING CHECKOUT…";
                this.toast(await this.callbacks.onPurchaseProduct(productId, "ledger_offer"));
                this.renderLedger();
                this.renderSettingsOffer();
            });
            card.append(kicker, name, description, action);
            grid.appendChild(card);
        }
    }

    private renderSettingsOffer(): void {
        const commerce = productCommerceView("no_interstitials");
        const offer = element("settings-noads-offer");
        const button = element<HTMLButtonElement>("settings-noads-button");
        offer.classList.toggle("hidden", !commerce.visible);
        button.disabled = commerce.owned || !commerce.purchasable;
        button.textContent = commerce.owned
            ? "OWNED · ACTIVE"
            : commerce.purchasable
              ? `BUY · ${commerce.priceLabel}`
              : commerce.statusLabel;
        button.onclick = async () => {
            button.disabled = true;
            button.textContent = "OPENING CHECKOUT…";
            this.toast(await this.callbacks.onPurchaseProduct("no_interstitials", "settings"));
            this.renderSettingsOffer();
        };
    }

    /* ----------------------------------------------------------------- daily */

    private renderDaily(): void {
        const view = dailyRewardsView();
        const grid = element<HTMLElement>("daily-grid");
        grid.replaceChildren();
        view.rewards.forEach((reward, index) => {
            const tile = document.createElement("article");
            const completed = index < Math.min(view.totalClaims, view.rewards.length);
            const current = index === view.currentIndex;
            tile.className = `daily-tile${completed ? " claimed" : ""}${current ? " current" : ""}`;
            const day = document.createElement("span");
            day.textContent = `DAY ${reward.day}`;
            const label = document.createElement("strong");
            label.textContent = reward.label;
            const state = document.createElement("small");
            state.textContent = completed ? "CLAIMED" : current ? "NEXT" : "LOCKED";
            tile.append(day, label, state);
            grid.appendChild(tile);
        });
        element("daily-authority").textContent = view.authorityLabel;
        element("daily-next").textContent = view.nextLabel;
        const claim = element<HTMLButtonElement>("daily-claim");
        claim.disabled = !view.claimable;
        claim.textContent = view.claimedToday
            ? "CLAIMED TODAY"
            : view.claimable
              ? "CLAIM TODAY"
              : "TIME CHECK REQUIRED";
        this.refreshMeta();
    }

    /* -------------------------------------------------------------- results */

    private renderSecondWind(): void {
        const view = secondWindView(this.resultsRevives);
        const button = element<HTMLButtonElement>("second-wind-button");
        const offer = element("second-wind-offer");
        element("second-wind-status").textContent = view.status;
        button.textContent = view.action || "UNAVAILABLE";
        button.disabled = !view.enabled;
        offer.classList.toggle("hidden", !view.visible);
        offer.classList.toggle("claimed", view.claimed);
        element("results-break-note").textContent = resultsBreakLabel();
        if (view.visible && !this.resultsAdOfferRecorded) {
            this.resultsAdOfferRecorded = true;
            this.callbacks.onAdOfferViewed(view.status);
        }
    }

    private renderMonetizationDiagnostics(view: MonetizationDiagnosticsView): void {
        const mock = view.environment === "LOCAL MOCK";
        const setStatus = (id: string, ready: boolean, mockLabel?: string): void => {
            const target = element(id);
            target.textContent = mock && mockLabel ? mockLabel : ready ? "READY" : "BLOCKED";
            target.classList.toggle("ready", ready && !(mock && mockLabel));
        };
        element("monetization-test-environment").textContent = view.environment;
        setStatus("test-host-status", view.hostReady);
        setStatus("test-liveops-status", view.liveOpsReady, "MOCK CONFIG");
        setStatus("test-shop-status", view.shopReady);
        setStatus("test-entitlements-status", view.entitlementsReady, "MOCK ONLY");
        setStatus("test-ads-status", view.adsReady, "MOCK ONLY");
        setStatus("test-ad-fill-status", view.adFillReady, "MOCK ONLY");
        setStatus("test-interstitial-fill-status", view.interstitialFillReady, "MOCK ONLY");
        element("test-config-id").textContent = view.configVersion;
        element("test-catalog-id").textContent = view.catalogConfigId;
        element("test-catalog-count").textContent = String(view.catalogItemCount);
        element("test-entitlement-count").textContent = String(view.entitlementCount);
        element("test-product-name").textContent = view.testProductName;
        element("test-product-state").textContent = view.testProductOwned
            ? "ENTITLEMENT VERIFIED"
            : `${view.testProductId} · ${view.testProductPrice}`;
        const purchaseButton = element<HTMLButtonElement>("test-purchase-button");
        purchaseButton.disabled = !view.purchaseReady || view.testProductOwned;
        purchaseButton.textContent = view.testProductOwned
            ? "ALREADY OWNED"
            : view.purchaseReady
              ? `TEST PURCHASE · ${view.testProductPrice}`
              : "PURCHASE BLOCKED";
        const adButton = element<HTMLButtonElement>("test-ad-button");
        adButton.disabled = !view.adTestReady;
        adButton.textContent = view.adTestReady ? "TEST VIDEO" : "VIDEO UNAVAILABLE";
        const interstitialButton = element<HTMLButtonElement>("test-interstitial-button");
        interstitialButton.disabled = !view.interstitialTestReady;
        interstitialButton.textContent = view.interstitialTestReady ? "TEST RESULTS AD" : "INTERSTITIAL UNAVAILABLE";
    }

    private async refreshMonetizationDiagnostics(log = "CHECKS REFRESHED"): Promise<void> {
        const view = await this.callbacks.onRefreshMonetizationDiagnostics();
        this.monetizationDiagnostics = view;
        this.renderMonetizationDiagnostics(view);
        element("monetization-test-log").textContent = log;
    }

    /* -------------------------------------------------------------- settings */

    private populateSettings(): void {
        this.touchModeSelect.value = this.settings.touchControls;
        this.settingsInputs.autoFire.checked = this.settings.autoFire;
        this.settingsInputs.dailyReminder.checked = this.settings.dailyReminder;
        this.renderReminderStatus();
        this.settingsInputs.musicEnabled.checked = this.settings.musicEnabled;
        this.settingsInputs.musicVolume.value = String(this.settings.musicVolume);
        this.settingsInputs.sfxEnabled.checked = this.settings.sfxEnabled;
        this.settingsInputs.sfxVolume.value = String(this.settings.sfxVolume);
        this.settingsInputs.hapticsEnabled.checked = this.settings.hapticsEnabled;
        this.settingsInputs.reducedMotion.checked = this.settings.reducedMotion;
    }

    private readSettings(): GameSettings {
        return {
            musicEnabled: this.settingsInputs.musicEnabled.checked,
            musicVolume: Number(this.settingsInputs.musicVolume.value),
            sfxEnabled: this.settingsInputs.sfxEnabled.checked,
            sfxVolume: Number(this.settingsInputs.sfxVolume.value),
            hapticsEnabled: this.settingsInputs.hapticsEnabled.checked,
            reducedMotion: this.settingsInputs.reducedMotion.checked,
            touchControls: (this.touchModeSelect.value as TouchControlsMode) ?? "auto",
            autoFire: this.settingsInputs.autoFire.checked,
            dailyReminder: this.settingsInputs.dailyReminder.checked,
        };
    }

    private bindSettings(): void {
        const commit = (): void => {
            this.settings = this.readSettings();
            this.applyInputMode();
            this.callbacks.onSettingsChanged(this.settings);
        };
        for (const [key, input] of Object.entries(this.settingsInputs)) {
            // The reminder is a platform permission, not just a stored flag, so
            // it has to be asked for from this gesture rather than on save.
            if (key === "dailyReminder") continue;
            input.addEventListener("input", commit);
        }
        this.settingsInputs.dailyReminder.addEventListener("change", () => {
            const wanted = this.settingsInputs.dailyReminder.checked;
            this.settingsInputs.dailyReminder.disabled = true;
            element("daily-reminder-status").textContent = "ASKING…";
            void this.callbacks.onDailyReminderChanged(wanted).then((view) => {
                this.settingsInputs.dailyReminder.disabled = false;
                this.settings = { ...this.settings, dailyReminder: view.wanted && view.granted };
                this.settingsInputs.dailyReminder.checked = this.settings.dailyReminder;
                element("daily-reminder-status").textContent = view.label;
            });
        });
        this.touchModeSelect.addEventListener("change", commit);
        element("replay-tutorial").addEventListener("click", () => {
            this.callbacks.onReplayTutorial();
            this.toast("TUTORIAL WILL PLAY ON THE NEXT RUN");
        });
        this.fpsCounterInput.addEventListener("input", () => {
            this.callbacks.onPerformanceHudChanged(this.fpsCounterInput.checked);
        });
    }

    /* --------------------------------------------------------------- buttons */

    private bindButtons(): void {
        element("play-button").addEventListener("click", this.callbacks.onPlay);
        element("retry-button").addEventListener("click", () => void this.exitResults("retry"));
        element("menu-button").addEventListener("click", () => void this.exitResults("menu"));
        element("pause-button").addEventListener("click", this.callbacks.onPause);
        element("resume-button").addEventListener("click", this.callbacks.onResume);
        element("quit-run-button").addEventListener("click", this.callbacks.onEndRun);
        element("settings-button").addEventListener("click", () => this.openSettings("menu"));
        element("pause-settings-button").addEventListener("click", () => this.openSettings("pause"));
        element("kit-button").addEventListener("click", () => this.showKit());
        element("ledger-button").addEventListener("click", () => this.showLedger());
        element("daily-button").addEventListener("click", () => this.showDaily());
        element("kit-back").addEventListener("click", () => this.showMenu());
        element("ledger-back").addEventListener("click", () => this.showMenu());
        element("daily-back").addEventListener("click", () => this.showMenu());
        element("monetization-test-back").addEventListener("click", () => this.showMenu());
        element("settings-back").addEventListener("click", () => {
            if (this.settingsReturn === "pause") this.showPause();
            else this.showMenu();
        });
        element("performance-hud").addEventListener("click", () => this.setPerformanceHudEnabled(false));

        const fireButton = element("fire-button");
        fireButton.addEventListener("pointerdown", (event) => {
            event.preventDefault();
            this.buttonFiring = true;
        });
        const releaseFire = (): void => {
            this.buttonFiring = false;
        };
        fireButton.addEventListener("pointerup", releaseFire);
        fireButton.addEventListener("pointercancel", releaseFire);
        fireButton.addEventListener("pointerleave", releaseFire);
        window.addEventListener("pointerup", releaseFire);

        element("version-label").addEventListener("click", () => {
            this.versionTapCount += 1;
            if (this.versionTapTimer) window.clearTimeout(this.versionTapTimer);
            this.versionTapTimer = window.setTimeout(() => {
                this.versionTapCount = 0;
            }, 1800);
            if (this.versionTapCount >= 5) {
                this.versionTapCount = 0;
                void this.showMonetizationTest();
            }
        });

        element("monetization-test-refresh").addEventListener("click", () => {
            element("monetization-test-log").textContent = "CHECKING PRIVATE RUN HOST…";
            void this.refreshMonetizationDiagnostics();
        });
        element("test-purchase-button").addEventListener("click", async () => {
            const view = this.monetizationDiagnostics;
            if (!view?.purchaseReady || view.testProductOwned) return;
            const button = element<HTMLButtonElement>("test-purchase-button");
            button.disabled = true;
            button.textContent = "OPENING CHECKOUT…";
            const message = await this.callbacks.onPurchaseProduct(
                view.testProductId as CommerceProductId,
                "private_test_bay",
            );
            await this.refreshMonetizationDiagnostics(message);
        });
        element("test-ad-button").addEventListener("click", async () => {
            const button = element<HTMLButtonElement>("test-ad-button");
            button.disabled = true;
            button.textContent = "OPENING VIDEO…";
            const message = await this.callbacks.onTestRewardedAd();
            await this.refreshMonetizationDiagnostics(message);
        });
        element("test-interstitial-button").addEventListener("click", async () => {
            const button = element<HTMLButtonElement>("test-interstitial-button");
            button.disabled = true;
            button.textContent = "OPENING RESULTS AD…";
            const message = await this.callbacks.onTestInterstitialAd();
            await this.refreshMonetizationDiagnostics(message);
        });
        element("second-wind-button").addEventListener("click", async () => {
            const button = element<HTMLButtonElement>("second-wind-button");
            this.resultsRewardedInteracted = true;
            button.disabled = true;
            button.textContent = "OPENING VIDEO…";
            const outcome = await this.callbacks.onClaimSecondWind();
            this.toast(outcome.message);
            if (!outcome.granted) {
                this.renderSecondWind();
                void this.callbacks.onRefreshMonetization().then(() => this.renderSecondWind());
            }
        });
        element("daily-claim").addEventListener("click", async () => {
            const button = element<HTMLButtonElement>("daily-claim");
            button.disabled = true;
            button.textContent = "SIGNING THE PAGE…";
            this.toast(await this.callbacks.onClaimDaily());
            this.renderDaily();
        });
    }

    private async exitResults(destination: "retry" | "menu"): Promise<void> {
        if (this.resultsExitInFlight) return;
        this.resultsExitInFlight = true;
        const retry = element<HTMLButtonElement>("retry-button");
        const menu = element<HTMLButtonElement>("menu-button");
        retry.disabled = true;
        menu.disabled = true;
        const target = destination === "retry" ? retry : menu;
        target.textContent = "CONTINUING…";
        if (destination === "retry") await this.callbacks.onRetry(this.resultsRewardedInteracted);
        else await this.callbacks.onMenu(this.resultsRewardedInteracted);
    }

    /* ----------------------------------------------------------------- input */

    private bindInput(): void {
        window.addEventListener("keydown", (event) => {
            const key = event.key.toLowerCase();
            if (["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d", " "].includes(key)) {
                event.preventDefault();
            }
            this.keys.add(key);
            if (this.screens.draft.classList.contains("active") && !event.repeat) {
                if (key === "1" || key === "2" || key === "3") {
                    this.callbacks.onChooseBooster(Number(key) - 1);
                    return;
                }
            }
            if (!this.inputEnabled) return;
            if (key === "e" && !event.repeat) this.callbacks.onSwap();
            if ((key === "escape" || key === "p") && !event.repeat) this.callbacks.onPause();
        });
        window.addEventListener("keyup", (event) => this.keys.delete(event.key.toLowerCase()));
        window.addEventListener("blur", () => {
            this.keys.clear();
            this.mouseFiring = false;
            this.buttonFiring = false;
            this.releaseStick();
            this.releaseAim();
        });
        window.addEventListener("pointerup", (event) => {
            if (event.pointerId === this.aimPointer) this.releaseAim();
        });

        this.appFrame.addEventListener("contextmenu", (event) => event.preventDefault());

        // Desktop: the mouse aims, the left button fires, the right button throws.
        this.appFrame.addEventListener("pointermove", (event) => {
            if (event.pointerType === "touch") return;
            // A mouse dragging the on-screen sticks is still stick input.
            if (event.target instanceof Element && event.target.closest("#touch-controls")) return;
            this.noteInputMode("mouse");
            this.mouseClientX = event.clientX;
            this.mouseClientY = event.clientY;
        });
        this.appFrame.addEventListener("pointerdown", (event) => {
            if (event.pointerType === "touch") {
                this.noteInputMode("touch");
                return;
            }
            if (event.target instanceof Element && event.target.closest("#touch-controls")) return;
            this.noteInputMode("mouse");
            if (!this.inputEnabled) return;
            if (event.target instanceof Element && event.target.closest("button, .screen.active")) return;
            event.preventDefault();
            this.mouseClientX = event.clientX;
            this.mouseClientY = event.clientY;
            this.mouseFiring = true;
        });
        window.addEventListener("pointerup", (event) => {
            if (event.pointerType === "touch") return;
            this.mouseFiring = false;
        });

        this.bindTouchZones();
    }

    private bindTouchZones(): void {
        // The stick is a permanent, visible control anchored to the bottom-left
        // corner. Touching it steers at once and never shoots — that is the
        // whole point of drawing it: the player can see the one spot that is
        // not a trigger.
        this.moveZone.addEventListener("pointerdown", (event) => {
            if (!this.inputEnabled) return;
            this.noteInputMode("touch");
            event.preventDefault();
            this.movePointer = event.pointerId;
            this.stickBase.classList.add("active");
            this.steer(event.clientX, event.clientY);
            try {
                this.moveZone.setPointerCapture(event.pointerId);
            } catch {
                // Older WebViews still deliver the moves without capture.
            }
        });
        this.moveZone.addEventListener("pointermove", (event) => {
            if (event.pointerId !== this.movePointer) return;
            event.preventDefault();
            this.steer(event.clientX, event.clientY);
        });
        const releaseMove = (event: PointerEvent): void => {
            if (event.pointerId !== this.movePointer) return;
            this.releaseStick();
        };
        this.moveZone.addEventListener("pointerup", releaseMove);
        this.moveZone.addEventListener("pointercancel", releaseMove);
        window.addEventListener("pointerup", releaseMove);

        // The whole page is the firing surface. A touch aims at the exact spot
        // it lands on; holding keeps aiming there as the finger moves.
        this.aimZone.addEventListener("pointerdown", (event) => {
            if (!this.inputEnabled) return;
            this.noteInputMode("touch");
            event.preventDefault();
            this.aimPointer = event.pointerId;
            this.aimStartedAt = performance.now();
            this.setTouchAim(event.clientX, event.clientY);
            this.touchAimHeld = true;
            try {
                this.aimZone.setPointerCapture(event.pointerId);
            } catch {
                // Capture is a nicety, not a requirement.
            }
        });
        this.aimZone.addEventListener("pointermove", (event) => {
            if (event.pointerId !== this.aimPointer) return;
            event.preventDefault();
            this.setTouchAim(event.clientX, event.clientY);
        });
        const releaseAim = (event: PointerEvent): void => {
            if (event.pointerId !== this.aimPointer) return;
            this.setTouchAim(event.clientX, event.clientY);
            // A short press is one deliberate shot even with hold-fire off.
            if (performance.now() - this.aimStartedAt <= TAP_SHOT_MS) this.aimTapFire = true;
            this.releaseAim();
        };
        this.aimZone.addEventListener("pointerup", releaseAim);
        this.aimZone.addEventListener("pointercancel", releaseAim);
    }

    private setTouchAim(clientX: number, clientY: number): void {
        const world = this.toWorld(clientX, clientY);
        this.touchAimX = world.x;
        this.touchAimY = world.y;
        this.onTouchAim(this.snapToTarget(world.x, world.y), true);
    }

    /**
     * Reads the thumb against the drawn ring. The stick never moves, so the
     * origin is the ring's own centre and the knob is capped at its radius —
     * what the player sees is exactly what the sim is given.
     */
    private steer(clientX: number, clientY: number): void {
        const ring = this.stickBase.getBoundingClientRect();
        const radius = Math.max(MIN_STICK_RADIUS, ring.width / 2);
        const vector = floatingStickVector(
            ring.left + ring.width / 2,
            ring.top + ring.height / 2,
            clientX,
            clientY,
            radius,
            STICK_DEADZONE,
        );
        this.moveX = vector.x;
        this.moveY = vector.y;
        this.stickKnob.style.transform = `translate(${vector.knobX}px, ${vector.knobY}px)`;
    }

    private releaseStick(): void {
        this.movePointer = null;
        this.moveX = 0;
        this.moveY = 0;
        this.stickBase.classList.remove("active");
        this.stickKnob.style.transform = "translate(0, 0)";
    }

    private releaseAim(): void {
        this.aimPointer = null;
        this.touchAimHeld = false;
        if (this.touchAimX !== null && this.touchAimY !== null) {
            this.onTouchAim({ x: this.touchAimX, y: this.touchAimY }, false);
        }
    }

    /**
     * An ad is presented by the host, over or beside this document. Keyboard
     * focus goes with it and does not necessarily come back, which leaves the
     * window listeners deaf: pointer input still lands on the canvas, so the
     * game looks alive while WASD does nothing at all.
     *
     * So the game takes its own focus back on the way out, and drops any key it
     * thought was held on the way in — a key released during the ad never sent
     * us a keyup.
     */
    handleAdPresentation(visible: boolean): void {
        this.keys.clear();
        this.mouseFiring = false;
        this.buttonFiring = false;
        this.aimTapFire = false;
        this.releaseStick();
        this.releaseAim();
        if (visible) return;
        try {
            window.focus();
            this.appFrame.focus({ preventScroll: true });
        } catch {
            // A host that refuses focus is not a reason to break the return.
        }
    }

    private setInputEnabled(enabled: boolean): void {
        this.inputEnabled = enabled;
        if (!enabled) {
            this.releaseStick();
            this.releaseAim();
            this.touchAimX = null;
            this.touchAimY = null;
            this.onTouchAim(null, false);
            this.mouseFiring = false;
            this.buttonFiring = false;
            this.aimTapFire = false;
        }
    }

    private activate(name: keyof UiController["screens"]): void {
        this.deactivateAll();
        this.screens[name].classList.add("active");
        this.flow();
    }

    private deactivateAll(): void {
        for (const screen of Object.values(this.screens)) screen.classList.remove("active");
    }

    private flow(): void {
        this.flowWipe.classList.remove("play");
        void this.flowWipe.offsetWidth;
        this.flowWipe.classList.add("play");
        if (this.flowTimer) window.clearTimeout(this.flowTimer);
        this.flowTimer = window.setTimeout(() => this.flowWipe.classList.remove("play"), 460);
    }
}

export { inkCaseAmount };

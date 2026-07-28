import { type Application, Container, Graphics, Text, TextStyle } from "pixi.js";
import {
    drawCover,
    drawFigure,
    drawGun,
    drawInkPool,
    drawMuzzleFlash,
    drawOutline,
    drawPage,
    drawSmear,
    drawSpark,
    drawSplatter,
    inkCircle,
    jitter,
    PALETTES,
    type Palette,
    type PaletteId,
} from "./art.ts";
import {
    type DesignViewport,
    designViewportForSize,
    ENEMIES,
    FIGURE_SCALE,
    figureScaleFor,
    TIME_STILL_THRESHOLD,
    WEAPONS,
    WORLD_HEIGHT,
    WORLD_WIDTH,
} from "./config.ts";
import { createPixiApp } from "./pixiApp.ts";
import type { CoreSnapshot, GameEvent } from "./types.ts";

const BOIL_INTERVAL = 1 / 9;
const HUD_FONT = 'Impact, Haettenschweiler, "Arial Narrow Bold", "Oswald", system-ui, sans-serif';
const OUTLINE_DRAW_SECONDS = 0.55;
const SMEAR_LIFETIME = 0.5;

interface Speck {
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    maxLife: number;
    size: number;
    colour: number;
    /** World specks freeze with the clock; page marks do not. */
    world: boolean;
}

interface Smear {
    x: number;
    y: number;
    dirX: number;
    dirY: number;
    length: number;
    life: number;
    colour: number;
}

interface Spark {
    x: number;
    y: number;
    dirX: number;
    dirY: number;
    life: number;
    colour: number;
    key: number;
}

interface Popup {
    x: number;
    y: number;
    life: number;
    maxLife: number;
    text: Text;
}

export interface SceneViewport extends DesignViewport {
    scale: number;
    offsetX: number;
    offsetY: number;
}

export class GameScene {
    readonly app: Application;
    private readonly host: HTMLElement;
    private readonly world = new Container();
    private readonly pageGraphics = new Graphics();
    private readonly coverGraphics = new Graphics();
    private readonly groundGraphics = new Graphics();
    private readonly smearGraphics = new Graphics();
    private readonly dropGraphics = new Graphics();
    private readonly sightGraphics = new Graphics();
    private readonly bulletGraphics = new Graphics();
    private readonly figureGraphics = new Graphics();
    private readonly fxGraphics = new Graphics();
    private readonly grainGraphics = new Graphics();
    private readonly overlayGraphics = new Graphics();
    private readonly popupLayer = new Container();
    private readonly labelLayer = new Container();
    private readonly youLabel: Text;

    private palette: Palette = PALETTES.ledger;
    private reducedMotion = false;
    private boilTimer = 0;
    private boil = 0;
    private specks: Speck[] = [];
    private smears: Smear[] = [];
    private sparks: Spark[] = [];
    private popups: Popup[] = [];
    private popupPool: Text[] = [];
    private shake = 0;
    private shakeX = 0;
    private shakeY = 0;
    private breath = 0;
    private danger = 0;
    private coverSignature = "";
    private outlineAges = new Map<number, number>();
    private smearTimer = 0;
    /** 0..1 reveal of the current floor plan, so a level draws itself in. */
    private coverDraw = 0;
    private flash = 0;
    private flashColour = 0;
    private leanX = 0;
    private leanY = 0;
    private recoil = 0;
    private touchAim: { x: number; y: number } | null = null;
    private touchAimHeld = false;
    private touchAimPulse = 0;
    private viewport: SceneViewport;
    private resizeObserver: ResizeObserver | null = null;
    private resizeFrame = 0;

    private constructor(app: Application, host: HTMLElement) {
        this.app = app;
        this.host = host;
        this.viewport = this.measure();

        this.world.addChild(
            this.pageGraphics,
            this.coverGraphics,
            this.groundGraphics,
            this.smearGraphics,
            this.dropGraphics,
            this.sightGraphics,
            this.bulletGraphics,
            this.figureGraphics,
            this.fxGraphics,
            this.grainGraphics,
            this.labelLayer,
        );
        this.app.stage.addChild(this.world, this.overlayGraphics, this.popupLayer);

        this.youLabel = new Text({
            text: "YOU",
            style: new TextStyle({
                fontFamily: HUD_FONT,
                fontSize: 19,
                fontWeight: "700",
                letterSpacing: 2,
                fill: this.palette.accent,
            }),
        });
        this.youLabel.anchor.set(0.5, 1);
        this.labelLayer.addChild(this.youLabel);

        this.redrawPage();
        this.applyViewport();
        this.bindResize();
    }

    static async create(host: HTMLElement): Promise<GameScene> {
        const app = await createPixiApp(host);
        return new GameScene(app, host);
    }

    /* ------------------------------------------------------------- viewport */

    getViewport(): Readonly<SceneViewport> {
        return this.viewport;
    }

    /** Converts a client-space pointer position into world coordinates. */
    toWorld(clientX: number, clientY: number): { x: number; y: number } {
        const bounds = this.app.canvas.getBoundingClientRect();
        const localX = ((clientX - bounds.left) / Math.max(1, bounds.width)) * this.viewport.width;
        const localY = ((clientY - bounds.top) / Math.max(1, bounds.height)) * this.viewport.height;
        return {
            x: (localX - this.viewport.offsetX) / this.viewport.scale,
            y: (localY - this.viewport.offsetY) / this.viewport.scale,
        };
    }

    private measure(): SceneViewport {
        const width = Math.max(1, Math.round(this.host.clientWidth || window.innerWidth));
        const height = Math.max(1, Math.round(this.host.clientHeight || window.innerHeight));
        const design = designViewportForSize(width, height);
        const scale = Math.min(width / WORLD_WIDTH, height / WORLD_HEIGHT);
        return {
            width,
            height,
            orientation: design.orientation,
            scale,
            offsetX: (width - WORLD_WIDTH * scale) / 2,
            offsetY: (height - WORLD_HEIGHT * scale) / 2,
        };
    }

    private applyViewport(): void {
        this.world.scale.set(this.viewport.scale);
        this.world.position.set(this.viewport.offsetX, this.viewport.offsetY);
        const root = document.documentElement;
        root.dataset.orientation = this.viewport.orientation;
        // The HUD hangs off the inked page, not the window, so it never drifts
        // into the letterbox. With the drawn border gone the inset is only a
        // hairline of breathing room, so the HUD sits close to the edge.
        root.style.setProperty("--stage-scale", String(this.viewport.scale));
        root.style.setProperty("--stage-top", `${Math.round(this.viewport.offsetY)}px`);
        root.style.setProperty("--stage-left", `${Math.round(this.viewport.offsetX)}px`);
        root.style.setProperty("--stage-inset", `${Math.round(8 * this.viewport.scale)}px`);
    }

    private bindResize(): void {
        const schedule = (): void => {
            window.cancelAnimationFrame(this.resizeFrame);
            this.resizeFrame = window.requestAnimationFrame(() => this.resize());
        };
        if (typeof ResizeObserver !== "undefined") {
            this.resizeObserver = new ResizeObserver(schedule);
            this.resizeObserver.observe(this.host);
        }
        window.addEventListener("resize", schedule, { passive: true });
        window.addEventListener("orientationchange", schedule, { passive: true });
    }

    resize(): void {
        const next = this.measure();
        if (next.width === this.viewport.width && next.height === this.viewport.height) return;
        this.viewport = next;
        this.app.renderer.resize(next.width, next.height);
        this.applyViewport();
    }

    /* -------------------------------------------------------------- palette */

    setPalette(id: PaletteId): void {
        const palette = PALETTES[id];
        if (!palette || palette.id === this.palette.id) return;
        this.palette = palette;
        this.redrawPage();
        this.coverSignature = "";
        this.youLabel.style.fill = palette.accent;
        this.applyPaletteToDocument();
    }

    getPalette(): Readonly<Palette> {
        return this.palette;
    }

    applyPaletteToDocument(): void {
        const root = document.documentElement;
        root.style.setProperty("--page", this.palette.css.page);
        root.style.setProperty("--page-shade", this.palette.css.pageShade);
        root.style.setProperty("--ink", this.palette.css.ink);
        root.style.setProperty("--hostile", this.palette.css.hostile);
        root.style.setProperty("--accent", this.palette.css.accent);
        root.style.setProperty("--ammo", this.palette.css.ammo);
        root.style.setProperty("--ghost", this.palette.css.ghost);
        root.dataset.palette = this.palette.id;
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute("content", this.palette.css.page);
    }

    /**
     * Where a touch is aiming. Drawn as an inked reticle so the player can see
     * the exact spot the next round is going before it leaves the barrel.
     */
    setTouchAim(point: { x: number; y: number } | null, held: boolean): void {
        if (point && !this.touchAim) this.touchAimPulse = 1;
        if (point && this.touchAim && Math.hypot(point.x - this.touchAim.x, point.y - this.touchAim.y) > 60) {
            this.touchAimPulse = 1;
        }
        this.touchAim = point;
        this.touchAimHeld = held;
    }

    setReducedMotion(enabled: boolean): void {
        this.reducedMotion = enabled;
        if (enabled) {
            this.boil = 0;
            this.shake = 0;
            this.smears = [];
            this.touchAimPulse = 0;
            this.flash = 0;
            this.leanX = 0;
            this.leanY = 0;
            this.coverDraw = 1;
        }
    }

    private redrawPage(): void {
        this.pageGraphics.clear();
        drawPage(this.pageGraphics, WORLD_WIDTH, WORLD_HEIGHT, this.palette);
        this.app.renderer.background.color = this.palette.page;
        this.redrawGrain();
    }

    /**
     * A static wash of paper tooth over the whole page. Drawn once per palette
     * and left alone, so it costs nothing per frame.
     */
    private redrawGrain(): void {
        const g = this.grainGraphics;
        g.clear();
        for (let index = 0; index < 520; index += 1) {
            const x = ((jitter(index * 5 + 101) + 1) / 2) * WORLD_WIDTH;
            const y = ((jitter(index * 11 + 211) + 1) / 2) * WORLD_HEIGHT;
            const size = 0.5 + ((jitter(index * 17 + 37) + 1) / 2) * 1.1;
            g.circle(x, y, size).fill({ color: this.palette.ink, alpha: 0.05 });
        }
        // A soft edge burn, heavier in the corners.
        for (let ring = 0; ring < 5; ring += 1) {
            const inset = 8 + ring * 9;
            g.rect(inset, inset, WORLD_WIDTH - inset * 2, WORLD_HEIGHT - inset * 2).stroke({
                color: this.palette.ink,
                width: 10,
                alpha: 0.02,
                alignment: 1,
            });
        }
    }

    /* --------------------------------------------------------------- events */

    handleEvent(event: GameEvent): void {
        if (event.type === "shot") {
            const heavy = event.weapon === "shotgun" || event.weapon === "launcher";
            this.addShake(heavy ? 3.4 : 1.5);
            this.spawnSpecks(event.x, event.y, heavy ? 6 : 3, this.palette.ink, 46);
            this.recoil = Math.min(1, this.recoil + (heavy ? 1 : 0.45));
            if (heavy) this.addFlash(this.palette.ammo, 0.22);
        } else if (event.type === "level_start") {
            // The floor plan inks itself in rather than snapping into place.
            this.coverDraw = this.reducedMotion ? 1 : 0;
        } else if (event.type === "enemy_shot") {
            this.spawnSpecks(event.x, event.y, 2, this.palette.hostile, 34);
        } else if (event.type === "enemy_hit") {
            this.spawnSpecks(event.x, event.y, 7, this.palette.hostile, 96);
        } else if (event.type === "enemy_down") {
            this.addShake(2.4);
            this.breath = 1;
            this.spawnSpecks(event.x, event.y, 16, this.palette.hostile, 160);
            if (event.score > 0) {
                this.addPopup(event.x, event.y - 40, event.style ? `${event.score} ${event.style}` : `${event.score}`);
            }
        } else if (event.type === "spark") {
            this.sparks.push({
                x: event.x,
                y: event.y,
                dirX: event.dirX,
                dirY: event.dirY,
                life: 0.25,
                colour: event.owner === "player" ? this.palette.ink : this.palette.hostile,
                key: Math.round(event.x * 7 + event.y * 13),
            });
            if (this.sparks.length > 40) this.sparks.shift();
        } else if (event.type === "blast") {
            this.addShake(7);
            this.danger = Math.max(this.danger, 0.7);
            this.addFlash(this.palette.ink, 0.3);
            this.spawnSpecks(event.x, event.y, 28, this.palette.ink, 260);
        } else if (event.type === "graze") {
            this.danger = Math.max(this.danger, 0.5);
            this.addPopup(event.x, event.y - 18, "GRAZE");
        } else if (event.type === "pickup") {
            this.addPopup(event.x, event.y - 26, WEAPONS[event.weapon].name);
        } else if (event.type === "resupply") {
            this.addPopup(event.x, event.y - 26, "SIDEARM");
        } else if (event.type === "shield_used") {
            this.addShake(5);
            this.danger = 1;
            this.addPopup(event.x, event.y - 42, "SECOND SKIN");
            this.spawnSpecks(event.x, event.y, 14, this.palette.accent, 150);
        } else if (event.type === "throw") {
            this.addShake(1.8);
        } else if (event.type === "level_clear") {
            // The last body on a page gets a wide, slow ink burst.
            this.breath = 1.6;
            this.addFlash(this.palette.accent, 0.26);
        } else if (event.type === "player_down") {
            this.addShake(9);
            this.danger = 1;
            this.addFlash(this.palette.hostile, 0.5);
            this.spawnSpecks(event.x, event.y, 24, this.palette.ink, 200);
        }
    }

    /** A single-frame wash of colour over the whole page. */
    private addFlash(colour: number, strength: number): void {
        if (this.reducedMotion) return;
        this.flashColour = colour;
        this.flash = Math.max(this.flash, strength);
    }

    private addShake(amount: number): void {
        if (this.reducedMotion) return;
        this.shake = Math.min(14, this.shake + amount);
    }

    private spawnSpecks(x: number, y: number, count: number, colour: number, speed: number): void {
        const total = this.reducedMotion ? Math.ceil(count / 3) : count;
        for (let index = 0; index < total; index += 1) {
            const angle = jitter(index * 97 + Math.round(x)) * Math.PI;
            const velocity = speed * (0.35 + ((jitter(index * 31 + Math.round(y)) + 1) / 2) * 0.9);
            this.specks.push({
                x,
                y,
                vx: Math.cos(angle) * velocity,
                vy: Math.sin(angle) * velocity,
                life: 0.5 + ((jitter(index * 17) + 1) / 2) * 0.5,
                maxLife: 1,
                size: 1 + ((jitter(index * 13) + 1) / 2) * 2.4,
                colour,
                world: true,
            });
        }
        if (this.specks.length > 420) this.specks.splice(0, this.specks.length - 420);
    }

    private addPopup(x: number, y: number, label: string): void {
        const text =
            this.popupPool.pop() ??
            new Text({
                text: label,
                style: new TextStyle({
                    fontFamily: HUD_FONT,
                    fontSize: 15,
                    fontWeight: "700",
                    letterSpacing: 1.4,
                    fill: this.palette.ink,
                }),
            });
        text.text = label;
        text.style.fill = this.palette.ink;
        text.anchor.set(0.5, 1);
        text.alpha = 1;
        this.popupLayer.addChild(text);
        this.popups.push({ x, y, life: 0.85, maxLife: 0.85, text });
        if (this.popups.length > 18) {
            const oldest = this.popups.shift();
            if (oldest) this.retirePopup(oldest);
        }
    }

    private retirePopup(popup: Popup): void {
        this.popupLayer.removeChild(popup.text);
        this.popupPool.push(popup.text);
    }

    /* ---------------------------------------------------------------- frame */

    render(snapshot: CoreSnapshot, delta: number): void {
        const worldDelta = delta * snapshot.timeScale;
        if (!this.reducedMotion) {
            this.boilTimer += delta;
            while (this.boilTimer >= BOIL_INTERVAL) {
                this.boilTimer -= BOIL_INTERVAL;
                this.boil = (this.boil + 1) % 512;
            }
        }
        this.danger = Math.max(0, this.danger - delta * 1.6);
        this.flash = Math.max(0, this.flash - delta * 3.4);
        this.recoil = Math.max(0, this.recoil - delta * 7);
        if (this.coverDraw < 1) this.coverDraw = Math.min(1, this.coverDraw + delta * 2.6);
        this.updateCamera(snapshot, delta);
        this.drawCoverIfChanged(snapshot);
        this.trackSmears(snapshot, delta, worldDelta);
        this.drawGround(snapshot, delta);
        this.drawDrops(snapshot);
        this.drawSightLines(snapshot);
        this.drawBullets(snapshot);
        this.drawFigures(snapshot);
        this.drawEffects(snapshot, delta, worldDelta);
        this.drawOverlay();
        this.updatePopups(delta);
    }

    /** The screen-space wash: muzzle flash, blast bloom, the killing shot. */
    private drawOverlay(): void {
        const g = this.overlayGraphics;
        g.clear();
        if (this.flash <= 0.01) return;
        g.rect(0, 0, this.viewport.width, this.viewport.height).fill({
            color: this.flashColour,
            alpha: Math.min(0.4, this.flash * 0.5),
        });
    }

    private updateCamera(snapshot: CoreSnapshot, delta: number): void {
        this.breath = Math.max(0, this.breath - delta * 3.4);
        if (this.shake > 0.01) {
            this.shake = Math.max(0, this.shake - delta * 34);
            this.shakeX = jitter(this.boil * 7 + Math.round(this.shake * 100)) * this.shake;
            this.shakeY = jitter(this.boil * 13 + Math.round(this.shake * 57)) * this.shake;
        } else {
            this.shakeX = 0;
            this.shakeY = 0;
        }
        // The page leans a little the way the player is looking, and kicks back
        // against the shot. Both are small enough to feel rather than see.
        const player = snapshot.player;
        const leanTargetX = this.reducedMotion || !player.alive ? 0 : -player.aimX * 10 - player.aimX * this.recoil * 9;
        const leanTargetY = this.reducedMotion || !player.alive ? 0 : -player.aimY * 10 - player.aimY * this.recoil * 9;
        const follow = Math.min(1, delta * 7);
        this.leanX += (leanTargetX - this.leanX) * follow;
        this.leanY += (leanTargetY - this.leanY) * follow;
        const pulse = this.reducedMotion ? 1 : 1 + this.breath * 0.004;
        this.world.scale.set(this.viewport.scale * pulse);
        this.world.position.set(
            this.viewport.offsetX + this.shakeX + this.leanX * this.viewport.scale,
            this.viewport.offsetY + this.shakeY + this.leanY * this.viewport.scale,
        );
    }

    private drawCoverIfChanged(snapshot: CoreSnapshot): void {
        const drawStep = Math.round(this.coverDraw * 8);
        const signature = `${this.palette.id}:${snapshot.level}:${snapshot.cover.length}:${snapshot.levelPlan.archetype}:${drawStep}`;
        if (signature === this.coverSignature) return;
        this.coverSignature = signature;
        this.coverGraphics.clear();
        // Blocks appear one after another, as if the page were being drawn.
        snapshot.cover.forEach((rect, index) => {
            const share = snapshot.cover.length === 0 ? 1 : (index + 1) / snapshot.cover.length;
            if (this.coverDraw < share - 1 / Math.max(1, snapshot.cover.length)) return;
            drawCover(
                this.coverGraphics,
                rect.shape,
                rect.x,
                rect.y,
                rect.width,
                rect.height,
                this.palette,
                rect.key * 137 + 11,
            );
        });
    }

    /** Bodies that are genuinely moving leave a dry-brush smear behind them. */
    private trackSmears(snapshot: CoreSnapshot, delta: number, worldDelta: number): void {
        for (let index = this.smears.length - 1; index >= 0; index -= 1) {
            const smear = this.smears[index];
            if (!smear) continue;
            smear.life -= delta;
            if (smear.life <= 0) this.smears.splice(index, 1);
        }
        if (this.reducedMotion) return;
        this.smearTimer += delta;
        if (this.smearTimer < 0.05) return;
        this.smearTimer = 0;

        const player = snapshot.player;
        const playerSpeed = Math.hypot(player.vx, player.vy);
        if (player.alive && playerSpeed > 40) {
            const direction = { x: player.vx / playerSpeed, y: player.vy / playerSpeed };
            this.smears.push({
                x: player.x,
                y: player.y + 18,
                dirX: direction.x,
                dirY: direction.y,
                length: Math.min(26, playerSpeed * 0.14),
                life: SMEAR_LIFETIME,
                colour: this.palette.ink,
            });
        }
        for (const enemy of snapshot.enemies) {
            if (enemy.pace < 0.35 || worldDelta <= 0) continue;
            this.smears.push({
                x: enemy.x,
                y: enemy.y + 18,
                dirX: enemy.aimX,
                dirY: enemy.aimY,
                length: 14 * enemy.pace,
                life: SMEAR_LIFETIME * 0.7,
                colour: this.palette.hostile,
            });
        }
        if (this.smears.length > 90) this.smears.splice(0, this.smears.length - 90);
    }

    /** Pools, splatter, and chalk outlines: the page keeps its record of the fight. */
    private drawGround(snapshot: CoreSnapshot, delta: number): void {
        const g = this.groundGraphics;
        g.clear();
        const seen = new Set<number>();
        for (const outline of snapshot.outlines) {
            seen.add(outline.id);
            const age = (this.outlineAges.get(outline.id) ?? 0) + delta;
            this.outlineAges.set(outline.id, age);
            const colour = outline.kind === "player" ? this.palette.ink : this.palette.hostile;
            const drawn = Math.min(1, age / OUTLINE_DRAW_SECONDS);
            drawInkPool(g, outline.x, outline.y + 14, 26, colour, outline.id * 71);
            drawSplatter(g, outline.x, outline.y, 17, colour, outline.id * 53);
            drawOutline(g, outline.x, outline.y, outline.angle, colour, outline.id * 29, drawn);
        }
        for (const id of [...this.outlineAges.keys()]) {
            if (!seen.has(id)) this.outlineAges.delete(id);
        }

        const smearLayer = this.smearGraphics;
        smearLayer.clear();
        for (const smear of this.smears) {
            drawSmear(
                smearLayer,
                smear.x,
                smear.y,
                smear.dirX,
                smear.dirY,
                smear.length,
                smear.colour,
                (smear.life / SMEAR_LIFETIME) * 0.16,
            );
        }
    }

    private drawDrops(snapshot: CoreSnapshot): void {
        const g = this.dropGraphics;
        g.clear();
        for (const drop of snapshot.drops) {
            const reachable =
                Math.hypot(drop.x - snapshot.player.x, drop.y - snapshot.player.y) < 52 && snapshot.player.alive;
            if (reachable) {
                inkCircle(g, drop.x, drop.y, 24, {
                    colour: this.palette.ammo,
                    width: 2.2,
                    alpha: 0.85,
                    key: drop.id * 7,
                    boil: this.boil,
                    amp: 1.4,
                });
            }
            drawGun(
                g,
                drop.x,
                drop.y,
                drop.angle,
                drop.weapon.id,
                drop.weapon.rounds > 0 ? this.palette.ink : this.palette.ghost,
                3,
                drop.id * 17,
                FIGURE_SCALE,
            );
            for (let pip = 0; pip < Math.min(8, drop.weapon.rounds); pip += 1) {
                g.rect(drop.x - 12 + pip * 3.4, drop.y + 13, 2.2, 4).fill({ color: this.palette.ammo, alpha: 0.9 });
            }
        }
    }

    private drawSightLines(snapshot: CoreSnapshot): void {
        const g = this.sightGraphics;
        g.clear();
        for (const enemy of snapshot.enemies) {
            if (!enemy.weapon) continue;
            const charge = 1 - Math.min(1, enemy.acquire / enemy.acquireTotal);
            const locked = enemy.hasLos && charge > 0.82;
            // A dim page hides the ray until the shot is genuinely about to leave.
            if (snapshot.hideSightLines && !locked) continue;
            const reach = Math.max(90, enemy.sightLength);
            const endX = enemy.x + enemy.aimX * reach;
            const endY = enemy.y + enemy.aimY * reach;
            g.moveTo(enemy.x + enemy.aimX * 16, enemy.y + enemy.aimY * 16);
            g.lineTo(endX, endY);
            g.stroke({
                color: locked ? this.palette.hostile : this.palette.ghost,
                width: locked ? 1.3 : 0.9,
                alpha: enemy.hasLos ? 0.16 + charge * 0.36 : 0.12,
            });
            if (locked) {
                // A tightening ring on the muzzle end: the shot is about to leave.
                inkCircle(g, enemy.x + enemy.aimX * 26, enemy.y + enemy.aimY * 26, 5 + (1 - charge) * 8, {
                    colour: this.palette.hostile,
                    width: 1.5,
                    alpha: 0.7,
                    key: enemy.id * 41,
                    boil: this.boil,
                    amp: 1,
                });
            }
        }
    }

    private drawBullets(snapshot: CoreSnapshot): void {
        const g = this.bulletGraphics;
        g.clear();
        const frozen = snapshot.timeScale < TIME_STILL_THRESHOLD;
        for (const bullet of snapshot.bullets) {
            const colour = bullet.owner === "player" ? this.palette.ink : this.palette.hostile;
            const speed = Math.hypot(bullet.vx, bullet.vy) || 1;
            const dirX = bullet.vx / speed;
            const dirY = bullet.vy / speed;
            const tail = Math.max(9, bullet.trail);
            g.moveTo(bullet.x - dirX * tail, bullet.y - dirY * tail);
            g.lineTo(bullet.x, bullet.y);
            g.stroke({ color: colour, width: 2.6, alpha: 0.6, cap: "round" });
            g.circle(bullet.x, bullet.y, 3.7).fill({ color: colour });
            if (frozen) {
                // Suspended rounds get a pin tick so a still page still reads.
                g.moveTo(bullet.x - dirY * 5, bullet.y + dirX * 5);
                g.lineTo(bullet.x + dirY * 5, bullet.y - dirX * 5);
                g.stroke({ color: colour, width: 1.2, alpha: 0.55 });
            }
        }
        for (const gun of snapshot.thrown) {
            drawGun(g, gun.x, gun.y, gun.angle, gun.weapon.id, this.palette.ink, 3.2, gun.id * 23, FIGURE_SCALE);
        }
    }

    private drawFigures(snapshot: CoreSnapshot): void {
        const g = this.figureGraphics;
        g.clear();
        const frozen = snapshot.timeScale < TIME_STILL_THRESHOLD;

        for (const enemy of snapshot.enemies) {
            const definition = ENEMIES[enemy.kind];
            const aim = Math.atan2(enemy.aimY, enemy.aimX);
            const scale = figureScaleFor(enemy.kind);
            // While the page is held, sketch where a walker is heading next.
            if (frozen && enemy.pace > 0.25 && definition.speed > 0 && !this.reducedMotion) {
                drawFigure(g, {
                    x: enemy.x + enemy.aimX * 34 * enemy.pace,
                    y: enemy.y + enemy.aimY * 34 * enemy.pace,
                    facing: enemy.aimX >= 0 ? 1 : -1,
                    aim,
                    stride: enemy.phase * 6 + 1.2,
                    motion: 1,
                    colour: this.palette.ghost,
                    width: 1.6,
                    weapon: null,
                    key: enemy.id * 61 + 5,
                    boil: this.boil,
                    scale,
                });
            }
            drawFigure(g, {
                x: enemy.x,
                y: enemy.y,
                facing: enemy.aimX >= 0 ? 1 : -1,
                aim,
                stride: enemy.phase * (definition.speed > 0 ? 6 : 0),
                motion: definition.speed > 0 ? Math.max(0.25, enemy.pace) : 0,
                colour: this.palette.hostile,
                width: enemy.kind === "tank" ? 4.8 : 3.6,
                weapon: enemy.weapon?.id ?? null,
                key: enemy.id * 61,
                boil: this.boil,
                flinch: enemy.flinch,
                scale,
            });
            if (enemy.maxSoak > 1) {
                for (let pip = 0; pip < enemy.maxSoak; pip += 1) {
                    const filled = pip < enemy.soak;
                    g.rect(enemy.x - 10 + pip * 8, enemy.y - 46, 6, 3.4).fill({
                        color: this.palette.hostile,
                        alpha: filled ? 0.95 : 0.22,
                    });
                }
            }
        }

        const player = snapshot.player;
        if (player.alive) {
            const aim = Math.atan2(player.aimY, player.aimX);
            const speed = Math.hypot(player.vx, player.vy);
            drawFigure(g, {
                x: player.x,
                y: player.y,
                facing: player.aimX >= 0 ? 1 : -1,
                aim,
                stride: snapshot.worldElapsed * 9 + snapshot.elapsed * 3,
                motion: Math.min(1, speed / 90),
                colour: this.palette.ink,
                width: 4.8,
                weapon: player.weapon?.id ?? null,
                key: 7,
                boil: this.boil,
                scale: FIGURE_SCALE,
            });
            if (player.flash > 0 && player.weapon) {
                const barrel = (WEAPONS[player.weapon.id].barrel + 10) * FIGURE_SCALE;
                const flashX = player.x + Math.cos(aim) * barrel;
                const flashY = player.y - 11 * FIGURE_SCALE + Math.sin(aim) * barrel;
                drawMuzzleFlash(g, flashX, flashY, aim, 0.7 + player.flash * 6, this.palette.ammo);
                // A puff of smoke hanging off the muzzle.
                for (let puff = 0; puff < 3; puff += 1) {
                    const spread = jitter(this.boil * 3 + puff * 29) * 0.5;
                    const reach = 10 + puff * 7;
                    g.circle(
                        flashX + Math.cos(aim + spread) * reach,
                        flashY + Math.sin(aim + spread) * reach,
                        3 + puff * 1.6,
                    ).fill({ color: this.palette.ghost, alpha: 0.28 * player.flash * 12 });
                }
            }
            // SECOND SKIN reads as an inked shell around the figure.
            for (let shield = 0; shield < player.shields; shield += 1) {
                inkCircle(g, player.x, player.y - 4, 30 + shield * 6, {
                    colour: this.palette.accent,
                    width: 2,
                    alpha: 0.55,
                    key: 811 + shield,
                    boil: this.boil,
                    amp: 1.6,
                });
            }
            this.youLabel.visible = true;
            this.youLabel.position.set(player.x, player.y - 58);
            // The aim thread: a dotted trajectory hint from the muzzle.
            if (player.weapon) {
                const dash = 16;
                for (let step = 3; step < 20; step += 1) {
                    const from = 26 + step * dash;
                    const to = from + dash * 0.42;
                    g.moveTo(player.x + Math.cos(aim) * from, player.y - 6 + Math.sin(aim) * from);
                    g.lineTo(player.x + Math.cos(aim) * to, player.y - 6 + Math.sin(aim) * to);
                }
                g.stroke({ color: this.palette.accent, width: 1.3, alpha: 0.34 });
            }
            // A teal caret under the label so the protagonist is never lost in a crowd.
            const caretY = player.y - 46;
            g.poly([player.x - 6, caretY - 7, player.x + 6, caretY - 7, player.x, caretY]).fill({
                color: this.palette.accent,
                alpha: 0.9,
            });
        } else {
            this.youLabel.visible = false;
        }
    }

    private drawEffects(snapshot: CoreSnapshot, delta: number, worldDelta: number): void {
        const g = this.fxGraphics;
        g.clear();

        for (const blast of snapshot.blasts) {
            const progress = Math.min(1, blast.age / 0.42);
            inkCircle(g, blast.x, blast.y, blast.radius * (0.35 + progress * 0.8), {
                colour: this.palette.ink,
                width: 4 - progress * 3,
                alpha: 1 - progress,
                key: blast.id * 71,
                boil: this.boil,
                amp: 4,
            });
            // Radial strokes flung outward from the seat of the blast.
            for (let spoke = 0; spoke < 8; spoke += 1) {
                const angle = (spoke / 8) * Math.PI * 2 + blast.id;
                const inner = blast.radius * (0.2 + progress * 0.5);
                const outer = inner + blast.radius * 0.3 * (1 - progress);
                g.moveTo(blast.x + Math.cos(angle) * inner, blast.y + Math.sin(angle) * inner);
                g.lineTo(blast.x + Math.cos(angle) * outer, blast.y + Math.sin(angle) * outer);
            }
            g.stroke({ color: this.palette.ink, width: 2.4, alpha: (1 - progress) * 0.7, cap: "round" });
        }

        for (let index = this.sparks.length - 1; index >= 0; index -= 1) {
            const spark = this.sparks[index];
            if (!spark) continue;
            spark.life -= delta;
            if (spark.life <= 0) {
                this.sparks.splice(index, 1);
                continue;
            }
            drawSpark(g, spark.x, spark.y, spark.dirX, spark.dirY, 12 * (spark.life / 0.25), spark.colour, spark.key);
        }

        for (let index = this.specks.length - 1; index >= 0; index -= 1) {
            const speck = this.specks[index];
            if (!speck) continue;
            const step = speck.world ? worldDelta : delta;
            speck.life -= delta;
            if (speck.life <= 0) {
                this.specks.splice(index, 1);
                continue;
            }
            speck.x += speck.vx * step;
            speck.y += speck.vy * step;
            speck.vx *= 1 - Math.min(1, step * 3.4);
            speck.vy *= 1 - Math.min(1, step * 3.4);
            g.circle(speck.x, speck.y, speck.size).fill({
                color: speck.colour,
                alpha: Math.min(1, speck.life / speck.maxLife) * 0.85,
            });
        }

        if (snapshot.phase === "interlude" && snapshot.rewardWeapon) {
            const drop = snapshot.drops[snapshot.drops.length - 1];
            if (drop) {
                inkCircle(g, drop.x, drop.y, 26 + Math.sin(snapshot.elapsed * 6) * 3, {
                    colour: this.palette.accent,
                    width: 2.4,
                    alpha: 0.8,
                    key: 401,
                    boil: this.boil,
                    amp: 1.6,
                });
            }
        }

        this.touchAimPulse = Math.max(0, this.touchAimPulse - delta * 3.2);
        if (this.touchAim && snapshot.player.alive) {
            const aim = this.touchAim;
            const held = this.touchAimHeld;
            const radius = 15 + this.touchAimPulse * 13;
            // A hand-inked reticle: ring, cross ticks, and a line back to the gun.
            inkCircle(g, aim.x, aim.y, radius, {
                colour: held ? this.palette.hostile : this.palette.accent,
                width: held ? 2.6 : 1.8,
                alpha: held ? 0.9 : 0.5,
                key: 907,
                boil: this.boil,
                amp: 1.5,
            });
            for (let tick = 0; tick < 4; tick += 1) {
                const angle = (tick / 4) * Math.PI * 2 + Math.PI / 4;
                g.moveTo(aim.x + Math.cos(angle) * (radius + 3), aim.y + Math.sin(angle) * (radius + 3));
                g.lineTo(aim.x + Math.cos(angle) * (radius + 10), aim.y + Math.sin(angle) * (radius + 10));
            }
            g.stroke({
                color: held ? this.palette.hostile : this.palette.accent,
                width: 2,
                alpha: held ? 0.85 : 0.45,
                cap: "round",
            });
            g.circle(aim.x, aim.y, 2.6).fill({
                color: held ? this.palette.hostile : this.palette.accent,
                alpha: 0.9,
            });
        }

        if (snapshot.player.alive && snapshot.player.graceFor > 0) {
            inkCircle(g, snapshot.player.x, snapshot.player.y, 30 + snapshot.player.graceFor * 26, {
                colour: this.palette.accent,
                width: 1.8,
                alpha: snapshot.player.graceFor,
                key: 517,
                boil: this.boil,
                amp: 2,
            });
        }

        // A bled-in vignette when the page is close to being ruined.
        if (this.danger > 0.02) {
            const inset = 26;
            g.rect(inset, inset, WORLD_WIDTH - inset * 2, WORLD_HEIGHT - inset * 2).stroke({
                color: this.palette.hostile,
                width: 26,
                alpha: this.danger * 0.18,
                alignment: 1,
            });
        }
    }

    private updatePopups(delta: number): void {
        for (let index = this.popups.length - 1; index >= 0; index -= 1) {
            const popup = this.popups[index];
            if (!popup) continue;
            popup.life -= delta;
            if (popup.life <= 0) {
                this.popups.splice(index, 1);
                this.retirePopup(popup);
                continue;
            }
            const progress = 1 - popup.life / popup.maxLife;
            const screenX = this.viewport.offsetX + popup.x * this.viewport.scale + this.shakeX;
            const screenY = this.viewport.offsetY + (popup.y - progress * 26) * this.viewport.scale + this.shakeY;
            popup.text.position.set(screenX, screenY);
            popup.text.alpha = 1 - progress * progress;
        }
    }

    /** Draws a single still frame with no live snapshot, used by the menu. */
    idleFrame(): void {
        this.app.render();
    }

    /** The live touch aim point, for QA. */
    getTouchAim(): { x: number; y: number; held: boolean } | null {
        if (!this.touchAim) return null;
        return { x: Math.round(this.touchAim.x), y: Math.round(this.touchAim.y), held: this.touchAimHeld };
    }

    getPerformanceDiagnostics(): {
        specks: number;
        smears: number;
        popups: number;
        boil: number;
        cameraShake: number;
        scale: number;
        palette: PaletteId;
    } {
        return {
            specks: this.specks.length,
            smears: this.smears.length,
            popups: this.popups.length,
            boil: this.boil,
            cameraShake: this.shake,
            scale: this.viewport.scale,
            palette: this.palette.id,
        };
    }

    destroy(): void {
        this.resizeObserver?.disconnect();
        window.cancelAnimationFrame(this.resizeFrame);
        this.app.destroy({ removeView: true }, { children: true });
    }
}

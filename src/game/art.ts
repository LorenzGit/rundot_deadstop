import type { Graphics } from "pixi.js";
import { FIGURE_HEAD_RADIUS, FIGURE_HEAD_Y, type WeaponId } from "./config.ts";

/* ---------------------------------------------------------------- palettes */

export type PageRuling = "ruled" | "grid" | "plain";

export interface Palette {
    id: PaletteId;
    name: string;
    tagline: string;
    /** How the blank page is printed before anything is drawn on it. */
    ruling: PageRuling;
    page: number;
    pageShade: number;
    rule: number;
    ink: number;
    hostile: number;
    accent: number;
    ammo: number;
    ghost: number;
    /** CSS mirrors so the DOM shell matches the page. */
    css: {
        page: string;
        pageShade: string;
        ink: string;
        hostile: string;
        accent: string;
        ammo: string;
        ghost: string;
    };
}

export type PaletteId = "ledger" | "grid" | "nightshift" | "blueprint" | "carbon" | "redpen";

function css(value: number): string {
    return `#${value.toString(16).padStart(6, "0")}`;
}

interface PaletteColours {
    page: number;
    pageShade: number;
    rule: number;
    ink: number;
    hostile: number;
    accent: number;
    ammo: number;
    ghost: number;
}

function makePalette(
    id: PaletteId,
    name: string,
    tagline: string,
    ruling: PageRuling,
    colours: PaletteColours,
): Palette {
    return {
        id,
        name,
        tagline,
        ruling,
        ...colours,
        css: {
            page: css(colours.page),
            pageShade: css(colours.pageShade),
            ink: css(colours.ink),
            hostile: css(colours.hostile),
            accent: css(colours.accent),
            ammo: css(colours.ammo),
            ghost: css(colours.ghost),
        },
    };
}

export const PALETTES: Readonly<Record<PaletteId, Palette>> = {
    ledger: makePalette("ledger", "FIELD LEDGER", "The page you started on.", "ruled", {
        page: 0xf4eee1,
        pageShade: 0xe6dcc8,
        rule: 0xd8cbb0,
        ink: 0x14100c,
        hostile: 0xc8382a,
        accent: 0x12766c,
        ammo: 0xc8891a,
        ghost: 0xb8ab90,
    }),
    grid: makePalette("grid", "GRAPH GRID", "Engineering pad, five to the inch.", "grid", {
        page: 0xf7f5ec,
        pageShade: 0xe4e8dc,
        rule: 0xbfd3c0,
        ink: 0x1a2a24,
        hostile: 0xd0452c,
        accent: 0x2a7fb8,
        ammo: 0xb8860f,
        ghost: 0xa7b6a8,
    }),
    nightshift: makePalette("nightshift", "NIGHT SHIFT", "Desk lamp, late hours, cheap paper.", "ruled", {
        page: 0x2a2620,
        pageShade: 0x201d18,
        rule: 0x39332a,
        ink: 0xf0e6d2,
        hostile: 0xe4614a,
        accent: 0x64c2b0,
        ammo: 0xe8b23c,
        ghost: 0x5b5347,
    }),
    blueprint: makePalette("blueprint", "BLUEPRINT", "Drafting linen and chalk.", "grid", {
        page: 0x0e2c4a,
        pageShade: 0x0a2239,
        rule: 0x1d4a72,
        ink: 0xe8f1f8,
        hostile: 0xff8a5c,
        accent: 0x6fd7c4,
        ammo: 0xffd166,
        ghost: 0x2c5b84,
    }),
    carbon: makePalette("carbon", "CARBON", "Graphite on black card.", "plain", {
        page: 0x15171b,
        pageShade: 0x0d0f12,
        rule: 0x23272d,
        ink: 0xe7e3d8,
        hostile: 0xff5747,
        accent: 0x53d2c0,
        ammo: 0xf1b845,
        ghost: 0x3b4149,
    }),
    redpen: makePalette("redpen", "RED PEN", "Marked, corrected, and signed.", "ruled", {
        page: 0xf6f1e6,
        pageShade: 0xe9dfcc,
        rule: 0xe0cdbb,
        ink: 0xb02a20,
        hostile: 0x1b1512,
        accent: 0x0f6d8c,
        ammo: 0xc07a12,
        ghost: 0xcbb2a4,
    }),
};

export const PALETTE_IDS = Object.keys(PALETTES) as PaletteId[];

export function isPaletteId(value: unknown): value is PaletteId {
    return typeof value === "string" && (PALETTE_IDS as string[]).includes(value);
}

/* ------------------------------------------------------------ hand wobble */

function clampUnit(value: number): number {
    return Math.max(0, Math.min(1, value));
}

/** Deterministic signed noise in [-1, 1] from an integer key. */
export function jitter(key: number): number {
    let value = Math.imul(key ^ 0x2f6b_1a9d, 0x85eb_ca6b) >>> 0;
    value ^= value >>> 13;
    value = Math.imul(value, 0xc2b2_ae35) >>> 0;
    value ^= value >>> 16;
    return (value / 0xffff_ffff) * 2 - 1;
}

export interface InkStyle {
    colour: number;
    width: number;
    alpha?: number;
    /** Wobble amplitude in world units. */
    amp?: number;
    /** Stable per-shape key so a stroke keeps its personality. */
    key: number;
    /** Advances on the boil so lines feel alive. */
    boil: number;
}

const SEGMENT_LENGTH = 22;

/** Draws a wobbled straight line, the base unit of every DEADSTOP stroke. */
export function inkLine(g: Graphics, ax: number, ay: number, bx: number, by: number, style: InkStyle): void {
    const dx = bx - ax;
    const dy = by - ay;
    const span = Math.hypot(dx, dy);
    const amp = style.amp ?? 1.1;
    const steps = Math.max(1, Math.min(7, Math.round(span / SEGMENT_LENGTH)));
    const nx = span > 1e-4 ? -dy / span : 0;
    const ny = span > 1e-4 ? dx / span : 0;
    g.moveTo(ax, ay);
    for (let step = 1; step <= steps; step += 1) {
        const t = step / steps;
        const bulge = step === steps ? 0 : jitter(style.key * 31 + step * 7919 + style.boil) * amp;
        g.lineTo(ax + dx * t + nx * bulge, ay + dy * t + ny * bulge);
    }
    g.stroke({ color: style.colour, width: style.width, alpha: style.alpha ?? 1, cap: "round", join: "round" });
}

/** Draws a wobbled polyline through the supplied points. */
export function inkPath(g: Graphics, points: readonly number[], style: InkStyle, close = false): void {
    if (points.length < 4) return;
    const amp = style.amp ?? 1.1;
    const firstX = points[0] as number;
    const firstY = points[1] as number;
    g.moveTo(firstX + jitter(style.key + style.boil) * amp, firstY + jitter(style.key * 3 + style.boil) * amp);
    for (let index = 2; index < points.length; index += 2) {
        const px = points[index] as number;
        const py = points[index + 1] as number;
        g.lineTo(
            px + jitter(style.key * 17 + index * 131 + style.boil) * amp,
            py + jitter(style.key * 29 + index * 197 + style.boil) * amp,
        );
    }
    if (close) g.closePath();
    g.stroke({ color: style.colour, width: style.width, alpha: style.alpha ?? 1, cap: "round", join: "round" });
}

/** Draws a wobbled circle as a closed polygon. */
export function inkCircle(g: Graphics, cx: number, cy: number, radius: number, style: InkStyle): void {
    const sides = Math.max(9, Math.min(22, Math.round(radius * 1.7)));
    const points: number[] = [];
    for (let index = 0; index < sides; index += 1) {
        const angle = (index / sides) * Math.PI * 2;
        const wobble = radius + jitter(style.key * 13 + index * 617 + style.boil) * (style.amp ?? 0.8);
        points.push(cx + Math.cos(angle) * wobble, cy + Math.sin(angle) * wobble);
    }
    inkPath(g, points, { ...style, amp: 0 }, true);
}

export function inkRect(g: Graphics, x: number, y: number, width: number, height: number, style: InkStyle): void {
    inkPath(g, [x, y, x + width, y, x + width, y + height, x, y + height], style, true);
}

/* --------------------------------------------------------------- the page */

export function drawPage(g: Graphics, width: number, height: number, palette: Palette): void {
    g.rect(-600, -600, width + 1200, height + 1200).fill({ color: palette.page });

    if (palette.ruling === "grid") {
        // Engineering pad: a fine square grid with a heavier line every fifth.
        for (let y = 20; y < height; y += 24) {
            const major = Math.round(y / 24) % 5 === 0;
            g.moveTo(24, y);
            for (let x = 24; x <= width - 24; x += 120) g.lineTo(x, y + jitter(y * 7 + x) * 0.8);
            g.stroke({ color: palette.rule, width: major ? 1.4 : 0.9, alpha: major ? 0.6 : 0.34 });
        }
        for (let x = 20; x < width; x += 24) {
            const major = Math.round(x / 24) % 5 === 0;
            g.moveTo(x, 24);
            for (let y = 24; y <= height - 24; y += 120) g.lineTo(x + jitter(x * 11 + y) * 0.8, y);
            g.stroke({ color: palette.rule, width: major ? 1.4 : 0.9, alpha: major ? 0.6 : 0.34 });
        }
    } else if (palette.ruling === "ruled") {
        for (let y = 92; y < height - 40; y += 62) {
            g.moveTo(34, y);
            for (let x = 34; x <= width - 34; x += 96) g.lineTo(x, y + jitter(y * 7 + x) * 1.5);
            g.stroke({ color: palette.rule, width: 1.2, alpha: 0.45 });
        }
    }

    for (let index = 0; index < 320; index += 1) {
        const x = ((jitter(index * 3 + 11) + 1) / 2) * width;
        const y = ((jitter(index * 7 + 23) + 1) / 2) * height;
        const size = 0.6 + ((jitter(index * 13 + 5) + 1) / 2) * 1.6;
        g.circle(x, y, size).fill({ color: palette.rule, alpha: 0.3 });
    }

    // No drawn page border: it framed the arena as a picture and cost every
    // edge a thick band the HUD had to stand clear of. The paper simply runs
    // to the screen edge now.
}

export type CoverShapeId = "crate" | "desk" | "pillar" | "drum";

function hatch(
    g: Graphics,
    x: number,
    y: number,
    width: number,
    height: number,
    palette: Palette,
    spacing: number,
    alpha: number,
): void {
    const diagonal = width + height;
    for (let offset = spacing; offset < diagonal; offset += spacing) {
        const ax = x + Math.max(0, offset - height);
        const ay = y + Math.min(offset, height);
        const bx = x + Math.min(offset, width);
        const by = y + Math.max(0, offset - width);
        g.moveTo(ax, ay);
        g.lineTo(bx, by);
        g.stroke({ color: palette.ink, width: 1.1, alpha });
    }
}

/** Each floor plan piece has its own inked silhouette so a page reads at a glance. */
export function drawCover(
    g: Graphics,
    shape: CoverShapeId,
    x: number,
    y: number,
    width: number,
    height: number,
    palette: Palette,
    key: number,
): void {
    g.rect(x + 5, y + 6, width, height).fill({ color: palette.pageShade, alpha: 0.9 });
    const style: InkStyle = { colour: palette.ink, width: 3.4, key, boil: 0, amp: 1.7 };

    if (shape === "desk") {
        // A long desk on legs, seen flat on the page.
        inkRect(g, x, y, width, height, style);
        hatch(g, x, y, width, height, palette, 16, 0.26);
        inkLine(g, x + 8, y + height * 0.34, x + width - 8, y + height * 0.34, {
            ...style,
            width: 2,
            alpha: 0.5,
            key: key + 3,
        });
        for (const legX of [x + 12, x + width - 12]) {
            inkLine(g, legX, y + height, legX, y + height + 9, { ...style, width: 2.6, key: key + 7 });
        }
        return;
    }

    if (shape === "pillar") {
        inkRect(g, x, y, width, height, style);
        // Fluting: vertical strokes rather than a flat hatch.
        const columns = Math.max(2, Math.round(width / 18));
        for (let column = 1; column < columns; column += 1) {
            const cx = x + (width * column) / columns;
            inkLine(g, cx, y + 6, cx, y + height - 6, { ...style, width: 1.2, alpha: 0.32, key: key + column });
        }
        inkLine(g, x, y + 7, x + width, y + 7, { ...style, width: 2, alpha: 0.55, key: key + 21 });
        inkLine(g, x, y + height - 7, x + width, y + height - 7, {
            ...style,
            width: 2,
            alpha: 0.55,
            key: key + 22,
        });
        return;
    }

    if (shape === "drum") {
        const cx = x + width / 2;
        const cy = y + height / 2;
        const radius = Math.min(width, height) / 2;
        inkCircle(g, cx, cy, radius, { ...style, amp: 1.4 });
        inkCircle(g, cx, cy, radius * 0.62, { ...style, width: 1.6, alpha: 0.45, key: key + 5, amp: 1 });
        for (let spoke = 0; spoke < 6; spoke += 1) {
            const angle = (spoke / 6) * Math.PI * 2;
            inkLine(
                g,
                cx + Math.cos(angle) * radius * 0.62,
                cy + Math.sin(angle) * radius * 0.62,
                cx + Math.cos(angle) * radius,
                cy + Math.sin(angle) * radius,
                { ...style, width: 1.2, alpha: 0.3, key: key + 30 + spoke },
            );
        }
        return;
    }

    // Crate: a braced box with a cross on the lid.
    inkRect(g, x, y, width, height, style);
    hatch(g, x, y, width, height, palette, 20, 0.2);
    inkLine(g, x + 4, y + 4, x + width - 4, y + height - 4, { ...style, width: 2, alpha: 0.5, key: key + 11 });
    inkLine(g, x + width - 4, y + 4, x + 4, y + height - 4, { ...style, width: 2, alpha: 0.5, key: key + 12 });
}

/* ------------------------------------------------------------- the figure */

export interface FigurePose {
    x: number;
    y: number;
    /** -1 faces left, 1 faces right. */
    facing: number;
    /** Aim angle in radians, in screen space. */
    aim: number;
    /** Walk cycle phase in radians. */
    stride: number;
    /** 0 standing, 1 running. */
    motion: number;
    colour: number;
    width: number;
    weapon: WeaponId | null;
    key: number;
    boil: number;
    /** 0..1 flinch lean. */
    flinch?: number;
    scale?: number;
}

const HIP_Y = 4;
const SHOULDER_Y = -11;
const FOOT_Y = 20;

export function drawFigure(g: Graphics, pose: FigurePose): void {
    const scale = pose.scale ?? 1;
    const lean = (pose.flinch ?? 0) * 3.2 * -pose.facing;
    const bob = Math.sin(pose.stride * 2) * 1.2 * pose.motion;
    const px = pose.x + lean;
    const py = pose.y + bob * scale;
    const style: InkStyle = { colour: pose.colour, width: pose.width, key: pose.key, boil: pose.boil, amp: 0.85 };
    const at = (dx: number, dy: number): [number, number] => [px + dx * pose.facing * scale, py + dy * scale];

    const swing = Math.sin(pose.stride) * (5 + pose.motion * 9);
    const lift = Math.max(0, Math.cos(pose.stride)) * pose.motion * 4;
    const [hipX, hipY] = at(0, HIP_Y);
    const [frontFootX, frontFootY] = at(swing * 0.9, FOOT_Y - lift);
    const [backFootX, backFootY] = at(-swing * 0.9, FOOT_Y);
    inkLine(g, hipX, hipY, frontFootX, frontFootY, style);
    inkLine(g, hipX, hipY, backFootX, backFootY, style);

    const [shoulderX, shoulderY] = at(0, SHOULDER_Y);
    inkLine(g, hipX, hipY, shoulderX, shoulderY, style);

    const reach = (pose.weapon ? 15 : 11) * scale;
    const gripX = shoulderX + Math.cos(pose.aim) * reach;
    const gripY = shoulderY + Math.sin(pose.aim) * reach;
    inkLine(g, shoulderX, shoulderY, gripX, gripY, style);
    const trailSwing = -Math.sin(pose.stride) * (4 + pose.motion * 7);
    const [trailX, trailY] = at(trailSwing * 0.8, SHOULDER_Y + 11);
    inkLine(g, shoulderX, shoulderY, trailX, trailY, style);

    inkCircle(g, px, py + FIGURE_HEAD_Y * scale, FIGURE_HEAD_RADIUS * scale, {
        ...style,
        amp: 0.55,
        key: pose.key + 91,
    });

    if (pose.weapon) drawGun(g, gripX, gripY, pose.aim, pose.weapon, pose.colour, pose.width, pose.key, scale);
}

const GUN_SHAPES: Readonly<Record<WeaponId, readonly number[]>> = {
    pistol: [-3, 1, 10, 1, 10, 3, -1, 3, -1, 7, -4, 7, -4, 1],
    smg: [-4, 0, 15, 0, 15, 3, 4, 3, 4, 9, 0, 9, 0, 3, -4, 3],
    shotgun: [-7, 0, 19, 0, 19, 3.4, -1, 3.4, -1, 8, -5, 8, -5, 3.4, -7, 3.4],
    rifle: [-9, 0, 23, 0, 23, 2.6, 6, 2.6, 4, 8, 0, 8, 1, 2.6, -9, 2.6],
    launcher: [-8, -3, 20, -3, 21, 4, -7, 4, -7, 9, -11, 9, -11, -3],
};

export function drawGun(
    g: Graphics,
    x: number,
    y: number,
    angle: number,
    weapon: WeaponId,
    colour: number,
    width: number,
    key: number,
    scale = 1,
): void {
    const shape = GUN_SHAPES[weapon];
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const flip = Math.abs(angle) > Math.PI / 2 ? -1 : 1;
    const points: number[] = [];
    for (let index = 0; index < shape.length; index += 2) {
        const sx = (shape[index] as number) * scale;
        const sy = (shape[index + 1] as number) * scale * flip;
        points.push(x + sx * cos - sy * sin, y + sx * sin + sy * cos);
    }
    inkPath(g, points, { colour, width: width * 0.85, key: key + 313, boil: 0, amp: 0.45 }, true);
}

export function drawMuzzleFlash(g: Graphics, x: number, y: number, angle: number, scale: number, colour: number): void {
    const spikes = 6;
    const points: number[] = [];
    for (let index = 0; index < spikes * 2; index += 1) {
        const spread = (index / (spikes * 2)) * Math.PI * 2;
        const radius = (index % 2 === 0 ? 11 : 4.5) * scale;
        points.push(x + Math.cos(angle + spread) * radius, y + Math.sin(angle + spread) * radius);
    }
    g.poly(points).fill({ color: colour, alpha: 0.9 });
}

/* ------------------------------------------------------------ ink effects */

export function drawSplatter(g: Graphics, x: number, y: number, size: number, colour: number, key: number): void {
    for (let index = 0; index < 7; index += 1) {
        const angle = jitter(key + index * 37) * Math.PI;
        const distance = ((jitter(key + index * 53) + 1) / 2) * size;
        const radius = (0.9 + ((jitter(key + index * 71) + 1) / 2) * 2.6) * (size / 18);
        g.circle(x + Math.cos(angle) * distance, y + Math.sin(angle) * distance, radius).fill({
            color: colour,
            alpha: 0.85,
        });
    }
    g.circle(x, y, size * 0.28).fill({ color: colour, alpha: 0.9 });
}

/** A soaked-in pool under a body: a few overlapping blots, no hard edge. */
export function drawInkPool(g: Graphics, x: number, y: number, size: number, colour: number, key: number): void {
    for (let index = 0; index < 5; index += 1) {
        const angle = jitter(key * 3 + index * 41) * Math.PI;
        const distance = ((jitter(key + index * 17) + 1) / 2) * size * 0.5;
        const radius = size * (0.42 + ((jitter(key + index * 29) + 1) / 2) * 0.4);
        g.circle(x + Math.cos(angle) * distance, y + Math.sin(angle) * distance * 0.55, radius).fill({
            color: colour,
            alpha: 0.13,
        });
    }
}

/** Chips of ink kicked off cover where a round struck it. */
export function drawSpark(
    g: Graphics,
    x: number,
    y: number,
    dirX: number,
    dirY: number,
    size: number,
    colour: number,
    key: number,
): void {
    const base = Math.atan2(dirY, dirX);
    for (let index = 0; index < 4; index += 1) {
        const angle = base + jitter(key + index * 53) * 0.9;
        const reach = size * (0.5 + ((jitter(key + index * 71) + 1) / 2) * 0.8);
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(angle) * reach, y + Math.sin(angle) * reach);
    }
    g.stroke({ color: colour, width: 1.6, alpha: 0.75, cap: "round" });
}

/** A dry-brush smear left behind a body that is genuinely moving. */
export function drawSmear(
    g: Graphics,
    x: number,
    y: number,
    dirX: number,
    dirY: number,
    length: number,
    colour: number,
    alpha: number,
): void {
    if (length < 2) return;
    g.moveTo(x - dirX * length, y - dirY * length);
    g.lineTo(x, y);
    g.stroke({ color: colour, width: 2.4, alpha, cap: "round" });
}

/** The chalk outline left where a body fell. `drawn` reveals it stroke by stroke. */
export function drawOutline(
    g: Graphics,
    x: number,
    y: number,
    angle: number,
    colour: number,
    key: number,
    drawn = 1,
): void {
    const style: InkStyle = { colour, width: 2.1, alpha: 0.42 * clampUnit(drawn), key, boil: 0, amp: 1.6 };
    if (drawn <= 0) return;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const at = (dx: number, dy: number): [number, number] => [x + dx * cos - dy * sin, y + dx * sin + dy * cos];
    const reveal = clampUnit(drawn);
    const [headX, headY] = at(14, 0);
    inkCircle(g, headX, headY, 7, { ...style, amp: 1 });
    if (reveal < 0.35) return;
    const [hipX, hipY] = at(-6, 0);
    const [neckX, neckY] = at(7, 0);
    inkLine(g, neckX, neckY, hipX, hipY, style);
    if (reveal < 0.6) return;
    const [legAX, legAY] = at(-20, 7);
    const [legBX, legBY] = at(-19, -8);
    inkLine(g, hipX, hipY, legAX, legAY, style);
    inkLine(g, hipX, hipY, legBX, legBY, style);
    if (reveal < 0.85) return;
    const [shoulderX, shoulderY] = at(5, 0);
    const [armAX, armAY] = at(2, 13);
    const [armBX, armBY] = at(1, -13);
    inkLine(g, shoulderX, shoulderY, armAX, armAY, style);
    inkLine(g, shoulderX, shoulderY, armBX, armBY, style);
}

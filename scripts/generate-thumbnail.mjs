/**
 * Draws the 512x512 store tile with the same ink language as the game: a
 * ruled page, hand-wobbled stick figures, and a frozen lattice of rounds. The
 * wordmark is drawn from a stroke alphabet because the tile has no font to
 * load. Pure Node rasteriser, then `sips` for the JPG encode.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

const size = 512;
const pixels = Buffer.alloc(size * size * 3);

const PAGE = [244, 238, 225];
const RULE = [216, 203, 176];
const INK = [20, 16, 12];
const HOSTILE = [200, 56, 42];
const ACCENT = [18, 118, 108];

/** Deterministic signed noise, matching the in-game wobble. */
function jitter(key) {
    let value = Math.imul(key ^ 0x2f6b_1a9d, 0x85eb_ca6b) >>> 0;
    value ^= value >>> 13;
    value = Math.imul(value, 0xc2b2_ae35) >>> 0;
    value ^= value >>> 16;
    return (value / 0xffff_ffff) * 2 - 1;
}

function fill(colour) {
    for (let index = 0; index < size * size; index += 1) {
        pixels[index * 3] = colour[0];
        pixels[index * 3 + 1] = colour[1];
        pixels[index * 3 + 2] = colour[2];
    }
}

function blend(x, y, colour, alpha) {
    if (alpha <= 0 || x < 0 || y < 0 || x >= size || y >= size) return;
    const clamped = Math.min(1, alpha);
    const offset = (y * size + x) * 3;
    for (let channel = 0; channel < 3; channel += 1) {
        const current = pixels[offset + channel];
        pixels[offset + channel] = Math.round(current + (colour[channel] - current) * clamped);
    }
}

function distanceToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
    return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function segment(ax, ay, bx, by, width, colour, alpha = 1) {
    const half = width / 2;
    const minX = Math.max(0, Math.floor(Math.min(ax, bx) - half - 2));
    const maxX = Math.min(size - 1, Math.ceil(Math.max(ax, bx) + half + 2));
    const minY = Math.max(0, Math.floor(Math.min(ay, by) - half - 2));
    const maxY = Math.min(size - 1, Math.ceil(Math.max(ay, by) + half + 2));
    for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
            const distance = distanceToSegment(x + 0.5, y + 0.5, ax, ay, bx, by);
            blend(x, y, colour, Math.max(0, Math.min(1, half + 0.5 - distance)) * alpha);
        }
    }
}

/** A wobbled stroke: the base unit of every mark on the tile. */
function stroke(ax, ay, bx, by, width, colour, key, amp = 1.4, alpha = 1) {
    const span = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.min(6, Math.round(span / 26)));
    const nx = span > 0 ? -(by - ay) / span : 0;
    const ny = span > 0 ? (bx - ax) / span : 0;
    let previousX = ax;
    let previousY = ay;
    for (let step = 1; step <= steps; step += 1) {
        const t = step / steps;
        const bulge = step === steps ? 0 : jitter(key * 31 + step * 7919) * amp;
        const nextX = ax + (bx - ax) * t + nx * bulge;
        const nextY = ay + (by - ay) * t + ny * bulge;
        segment(previousX, previousY, nextX, nextY, width, colour, alpha);
        previousX = nextX;
        previousY = nextY;
    }
}

function ring(cx, cy, radius, width, colour, key, amp = 1, alpha = 1) {
    const sides = Math.max(14, Math.round(radius * 1.6));
    let previousX = null;
    let previousY = null;
    for (let index = 0; index <= sides; index += 1) {
        const angle = (index / sides) * Math.PI * 2;
        const wobble = radius + jitter(key * 13 + index * 617) * amp;
        const x = cx + Math.cos(angle) * wobble;
        const y = cy + Math.sin(angle) * wobble;
        if (previousX !== null && previousY !== null) segment(previousX, previousY, x, y, width, colour, alpha);
        previousX = x;
        previousY = y;
    }
}

function disc(cx, cy, radius, colour, alpha = 1) {
    const minX = Math.max(0, Math.floor(cx - radius - 2));
    const maxX = Math.min(size - 1, Math.ceil(cx + radius + 2));
    const minY = Math.max(0, Math.floor(cy - radius - 2));
    const maxY = Math.min(size - 1, Math.ceil(cy + radius + 2));
    for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
            const distance = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
            blend(x, y, colour, Math.max(0, Math.min(1, radius + 0.5 - distance)) * alpha);
        }
    }
}

function figure({ x, y, scale, colour, width, key, stride = 0, gun = true }) {
    const at = (dx, dy) => [x + dx * scale, y + dy * scale];
    const swing = Math.sin(stride) * 9;
    const [hipX, hipY] = at(0, 4);
    const [shoulderX, shoulderY] = at(0, -11);
    const [headX, headY] = at(0, -21);
    const [frontX, frontY] = at(swing, 20);
    const [backX, backY] = at(-swing, 20);
    const [gripX, gripY] = at(15, -11);
    const [trailX, trailY] = at(-6, 0);
    stroke(hipX, hipY, frontX, frontY, width, colour, key + 1);
    stroke(hipX, hipY, backX, backY, width, colour, key + 2);
    stroke(hipX, hipY, shoulderX, shoulderY, width, colour, key + 3);
    stroke(shoulderX, shoulderY, gripX, gripY, width, colour, key + 4);
    stroke(shoulderX, shoulderY, trailX, trailY, width, colour, key + 5);
    ring(headX, headY, 7.4 * scale, width, colour, key + 6, 0.55);
    if (!gun) return;
    const barrel = width * 0.85;
    stroke(gripX - 3 * scale, gripY + 2 * scale, gripX + 13 * scale, gripY + 2 * scale, barrel, colour, key + 7, 0.4);
    stroke(gripX + 13 * scale, gripY + 2 * scale, gripX + 13 * scale, gripY + 4 * scale, barrel, colour, key + 8, 0.3);
    stroke(gripX - scale, gripY + 4 * scale, gripX - scale, gripY + 9 * scale, barrel, colour, key + 9, 0.3);
    stroke(gripX - 3 * scale, gripY + 4 * scale, gripX - scale, gripY + 4 * scale, barrel, colour, key + 10, 0.3);
}

/* ------------------------------------------------------------------ the page */

fill(PAGE);

for (let index = 0; index < 220; index += 1) {
    const x = ((jitter(index * 3 + 11) + 1) / 2) * size;
    const y = ((jitter(index * 7 + 23) + 1) / 2) * size;
    disc(x, y, 0.7 + ((jitter(index * 13 + 5) + 1) / 2) * 1.4, RULE, 0.38);
}

for (let index = 0; index < 8; index += 1) {
    const y = 58 + index * 58;
    stroke(26, y, size - 26, y + jitter(y) * 2, 1.4, RULE, index + 90, 1.6, 0.55);
}

/* --------------------------------------------------------------- the fight */

// Lifted into the upper two thirds so the wordmark has a band of its own.
// Enemy sight lines, aimed at the figure that is about to move.
segment(388, 132, 210, 216, 2, HOSTILE, 0.45);
segment(400, 306, 216, 236, 2, HOSTILE, 0.45);

figure({ x: 388, y: 132, scale: 1.9, colour: HOSTILE, width: 5, key: 210, stride: 0.7 });
figure({ x: 400, y: 306, scale: 1.8, colour: HOSTILE, width: 4.8, key: 320, stride: -0.5 });
figure({ x: 450, y: 216, scale: 1.4, colour: HOSTILE, width: 4.2, key: 430, stride: 1.4, gun: false });

// The frozen lattice: the player's burst hanging in the air. This is the hook,
// so it gets the centre of the tile.
for (let index = 0; index < 8; index += 1) {
    const t = index / 7;
    const x = 206 + t * 214;
    const y = 214 - t * 40 + jitter(index * 91) * 3;
    segment(x - 17, y + 3, x, y, 3.4, INK, 0.55);
    disc(x, y, 4.8, INK);
}

figure({ x: 146, y: 236, scale: 2.5, colour: INK, width: 7.2, key: 7, stride: 0.3 });

// The teal caret that marks the player, exactly as the HUD draws it.
for (let row = 0; row < 14; row += 1) {
    const half = 14 - row;
    segment(146 - half, 146 + row, 146 + half, 146 + row, 1, ACCENT, 1);
}

/* ----------------------------------------------------------- the wordmark */

/**
 * A condensed block alphabet built from the same thick strokes as everything
 * else, because the tile has no font to load and a store tile without the
 * game's name on it is just a picture. Each glyph is a list of strokes on a
 * unit grid, x and y both running 0..1 from the top-left.
 */
const GLYPHS = {
    D: [
        [0, 0, 0, 1],
        [0, 0, 0.72, 0.16],
        [0.72, 0.16, 0.72, 0.84],
        [0.72, 0.84, 0, 1],
    ],
    E: [
        [0, 0, 0, 1],
        [0, 0, 0.82, 0],
        [0, 0.5, 0.62, 0.5],
        [0, 1, 0.82, 1],
    ],
    A: [
        [0, 1, 0.42, 0],
        [0.42, 0, 0.84, 1],
        [0.17, 0.62, 0.67, 0.62],
    ],
    S: [
        [0.82, 0, 0.05, 0],
        [0.05, 0, 0, 0.46],
        [0, 0.46, 0.8, 0.54],
        [0.8, 0.54, 0.76, 1],
        [0.76, 1, 0, 1],
    ],
    T: [
        [0, 0, 0.84, 0],
        [0.42, 0, 0.42, 1],
    ],
    O: [
        [0, 0.08, 0, 0.92],
        [0, 0.08, 0.78, 0.08],
        [0.78, 0.08, 0.78, 0.92],
        [0.78, 0.92, 0, 0.92],
    ],
    P: [
        [0, 0, 0, 1],
        [0, 0, 0.76, 0.06],
        [0.76, 0.06, 0.74, 0.52],
        [0.74, 0.52, 0, 0.56],
    ],
    I: [[0.4, 0, 0.4, 1]],
    M: [
        [0, 1, 0, 0],
        [0, 0, 0.4, 0.58],
        [0.4, 0.58, 0.8, 0],
        [0.8, 0, 0.8, 1],
    ],
    W: [
        [0, 0, 0.18, 1],
        [0.18, 1, 0.4, 0.34],
        [0.4, 0.34, 0.62, 1],
        [0.62, 1, 0.8, 0],
    ],
    H: [
        [0, 0, 0, 1],
        [0.78, 0, 0.78, 1],
        [0, 0.52, 0.78, 0.52],
    ],
    N: [
        [0, 1, 0, 0],
        [0, 0, 0.78, 1],
        [0.78, 1, 0.78, 0],
    ],
    Y: [
        [0, 0, 0.4, 0.52],
        [0.8, 0, 0.4, 0.52],
        [0.4, 0.52, 0.4, 1],
    ],
    U: [
        [0, 0, 0, 0.86],
        [0, 0.86, 0.78, 0.86],
        [0.78, 0.86, 0.78, 0],
    ],
};

function word(text, originX, baselineY, glyphHeight, glyphWidth, gap, width, colour, keyBase) {
    let cursor = originX;
    for (let index = 0; index < text.length; index += 1) {
        const strokes = GLYPHS[text[index]];
        if (strokes) {
            for (let s = 0; s < strokes.length; s += 1) {
                const [ax, ay, bx, by] = strokes[s];
                stroke(
                    cursor + ax * glyphWidth,
                    baselineY + ay * glyphHeight,
                    cursor + bx * glyphWidth,
                    baselineY + by * glyphHeight,
                    width,
                    colour,
                    keyBase + index * 37 + s * 11,
                    1.1,
                );
            }
        }
        cursor += glyphWidth + gap;
    }
    return cursor - gap;
}

{
    const text = "DEADSTOP";
    const glyphWidth = 44;
    const gap = 10;
    const total = text.length * glyphWidth + (text.length - 1) * gap;
    word(text, (size - total) / 2, 386, 74, glyphWidth, gap, 13, INK, 900);
}

// The rule, small and teal, the way the menu says it.
{
    const tagline = "TIME STOPS WHEN YOU DO";
    const glyphWidth = 14;
    const gap = 6.9;
    const total = tagline.length * glyphWidth + (tagline.length - 1) * gap;
    let cursor = (size - total) / 2;
    for (let index = 0; index < tagline.length; index += 1) {
        const strokes = GLYPHS[tagline[index]];
        if (strokes) {
            for (let s = 0; s < strokes.length; s += 1) {
                const [ax, ay, bx, by] = strokes[s];
                stroke(
                    cursor + ax * glyphWidth,
                    474 + ay * 26,
                    cursor + bx * glyphWidth,
                    474 + by * 26,
                    3.6,
                    ACCENT,
                    1500 + index * 29 + s * 7,
                    0.5,
                );
            }
        }
        cursor += glyphWidth + gap;
    }
}

/* --------------------------------------------------------------- the encode */

const publicDir = new URL("../public/", import.meta.url);
mkdirSync(publicDir, { recursive: true });
const ppmUrl = new URL("thumbnail-source.ppm", publicDir);
const jpgUrl = new URL("thumbnail.jpg", publicDir);
writeFileSync(ppmUrl, Buffer.concat([Buffer.from(`P6\n${size} ${size}\n255\n`), pixels]));

const result = spawnSync(
    "/usr/bin/sips",
    ["-s", "format", "jpeg", "-s", "formatOptions", "90", ppmUrl.pathname, "--out", jpgUrl.pathname],
    { stdio: "inherit" },
);
if (result.status !== 0) throw new Error(`sips failed with status ${result.status}`);
unlinkSync(ppmUrl);
console.log(`generated ${jpgUrl.pathname} (${readFileSync(jpgUrl.pathname).length} bytes)`);

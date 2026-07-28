import type { BoosterId, WeaponId } from "../game/config.ts";

/**
 * One ink-line glyph per booster, drawn on a 24x24 grid in the same pen the
 * arena is drawn with: open strokes, round caps, no fills except where a mark
 * has to read solid at chip size.
 *
 * This record is the single source for every surface that shows a booster —
 * the HUD chip, the draft card, the kit card. Keying it to BoosterId means a
 * new booster cannot ship without a glyph: the compiler refuses.
 */
export interface IconShape {
    /** An SVG path command string. */
    d: string;
    /** Filled rather than stroked, for marks too small to read as outlines. */
    solid?: boolean;
}

const ICONS: Readonly<Record<BoosterId, readonly IconShape[]>> = {
    // A crosshair closed down on its centre: the spread has nowhere to go.
    steady_hand: [
        { d: "M12 12 m-7.5 0 a7.5 7.5 0 1 0 15 0 a7.5 7.5 0 1 0 -15 0" },
        { d: "M12 1.5 V6" },
        { d: "M12 18 V22.5" },
        { d: "M1.5 12 H6" },
        { d: "M18 12 H22.5" },
        { d: "M12 12 m-1.9 0 a1.9 1.9 0 1 0 3.8 0 a1.9 1.9 0 1 0 -3.8 0", solid: true },
    ],
    // An hourglass: standing still buys you clock.
    long_breath: [{ d: "M7 3 H17" }, { d: "M7 21 H17" }, { d: "M7 3 L17 21" }, { d: "M17 3 L7 21" }],
    // The game's own stick figure, mid-stride.
    quick_feet: [
        { d: "M14.6 5 m-2.2 0 a2.2 2.2 0 1 0 4.4 0 a2.2 2.2 0 1 0 -4.4 0", solid: true },
        { d: "M14 7.4 L10.8 13.2" },
        { d: "M12.9 9.4 L17.2 11.6" },
        { d: "M12.9 9.4 L8.6 8" },
        { d: "M10.8 13.2 L14.4 17.4 L13.4 21" },
        { d: "M10.8 13.2 L6.4 16.2 L7 20.4" },
    ],
    // Three rounds you did not have before.
    deep_pockets: [
        { d: "M4.7 21 V14 C4.7 11.4 8.5 11.4 8.5 14 V21 Z" },
        { d: "M10.1 21 V14 C10.1 11.4 13.9 11.4 13.9 14 V21 Z" },
        { d: "M15.5 21 V14 C15.5 11.4 19.3 11.4 19.3 14 V21 Z" },
    ],
    // A lobbed arc that keeps going after it lands.
    heavy_throw: [{ d: "M3 17 Q10 2 20 14" }, { d: "M20 14 L14.5 13.5" }, { d: "M20 14 L19 8.5" }],
    // A round folding off a wall.
    ricochet: [{ d: "M20 3 V21" }, { d: "M3 6 L17 12 L3 18" }],
    // A shield: one hit soaked.
    second_skin: [{ d: "M12 3 L20 6 V12 C20 16.5 16 19.5 12 21 C8 19.5 4 16.5 4 12 V6 Z" }],
    // Taking back what the bodies leave behind.
    scavenger: [{ d: "M4 14 V20 H20 V14" }, { d: "M12 3 V14" }, { d: "M8 10 L12 14 L16 10" }],
    // An eye that does not blink.
    dead_eye: [
        { d: "M2 12 C6 6 9 5 12 5 C15 5 18 6 22 12 C18 18 15 19 12 19 C9 19 6 18 2 12 Z" },
        { d: "M12 12 m-2.6 0 a2.6 2.6 0 1 0 5.2 0 a2.6 2.6 0 1 0 -5.2 0", solid: true },
    ],
    // A page with a slice taken out of its corner.
    paper_cut: [{ d: "M6 3 H15 L19 7 V21 H6 Z" }, { d: "M15 3 V7 H19" }, { d: "M9 18 L16 11" }],
    // Two impacts where there was one trigger pull.
    twin_tap: [
        { d: "M9 12 m-4 0 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0" },
        { d: "M15 12 m-4 0 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0" },
        { d: "M9 12 m-1.4 0 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0", solid: true },
        { d: "M15 12 m-1.4 0 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0", solid: true },
    ],
    // A round already gone, with the air still closing behind it.
    long_barrel: [
        { d: "M14 8.6 H17 A3.4 3.4 0 0 1 17 15.4 H14 Z", solid: true },
        { d: "M3 12 H11" },
        { d: "M5.5 7.6 H11" },
        { d: "M5.5 16.4 H11" },
    ],
    // Reach opening outward from where you stand.
    wide_step: [
        { d: "M12 5 V19" },
        { d: "M8 12 H3" },
        { d: "M5.5 9 L2.5 12 L5.5 15" },
        { d: "M16 12 H21" },
        { d: "M18.5 9 L21.5 12 L18.5 15" },
    ],
    // A cold page: they take longer to find you on it.
    cold_start: [
        { d: "M12 2 V22" },
        { d: "M3.5 7 L20.5 17" },
        { d: "M20.5 7 L3.5 17" },
        { d: "M12 6 L9 3.5" },
        { d: "M12 6 L15 3.5" },
        { d: "M12 18 L9 20.5" },
        { d: "M12 18 L15 20.5" },
    ],
};

/**
 * The endless draft deals guns instead of boosters once the board is full, and
 * a card in that slot should not read as half-finished next to a booster card.
 * Same pen, same grid, keyed to WeaponId for the same compile-time guarantee.
 */
const WEAPON_ICONS: Readonly<Record<WeaponId, readonly IconShape[]>> = {
    // A short frame and a stub barrel.
    pistol: [{ d: "M4 9 H16 V13 H10 L9 19 H5 V13 H4 Z" }, { d: "M16 10.5 H20" }],
    // Boxy receiver, stick mag, long thin barrel.
    smg: [{ d: "M4 8 H14 V12 H9 L8 18 H5 V12 H4 Z" }, { d: "M14 9.5 H21" }, { d: "M10 12 L11 17" }],
    // Wide bore and an under-barrel pump.
    shotgun: [{ d: "M3 9 H15 V12.5 H8 L7 17 H4 V12.5 H3 Z" }, { d: "M15 8 H21 V13 H15 Z" }, { d: "M9 13.5 H14" }],
    // Long barrel with a raised scope.
    rifle: [{ d: "M3 10 H13 V13.5 H8 L7 18 H4 V13.5 H3 Z" }, { d: "M13 11 H22" }, { d: "M9 10 V6.5 H15 V10" }],
    // A fat tube with a shell in the mouth.
    launcher: [{ d: "M3 8.5 H17 A3 3 0 0 1 17 14.5 H3 Z" }, { d: "M17 11.5 H22" }, { d: "M7 14.5 L6 19 H9 L10 14.5" }],
};

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Builds the glyph for a booster. It is decoration beside the booster's own
 * name, so it is hidden from assistive tech rather than duplicating the label.
 */
export function boosterIcon(id: BoosterId): SVGSVGElement {
    return drawIcon(ICONS[id]);
}

/** The same glyph treatment for the guns the endless draft deals. */
export function weaponIcon(id: WeaponId): SVGSVGElement {
    return drawIcon(WEAPON_ICONS[id]);
}

function drawIcon(shapes: readonly IconShape[]): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", "booster-icon");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    for (const shape of shapes) {
        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", shape.d);
        if (shape.solid) {
            path.setAttribute("fill", "currentColor");
            path.setAttribute("stroke", "none");
        }
        svg.appendChild(path);
    }
    return svg;
}

/** Exposed so the invariant suite can prove nothing ships without a glyph. */
export const BOOSTER_ICON_SHAPES = ICONS;
export const WEAPON_ICON_SHAPES = WEAPON_ICONS;

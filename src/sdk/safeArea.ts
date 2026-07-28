export interface EdgeInsets {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

export interface FrameBounds {
    top: number;
    right: number;
    bottom: number;
    left: number;
    width: number;
    height: number;
}

export interface ViewportSize {
    width: number;
    height: number;
}

/**
 * No real safe area eats this much of the screen. A larger reading is a bad
 * one — a host reporting device pixels against our CSS-pixel frame, a stale
 * measurement taken before layout, or simply a value we should not trust.
 *
 * Left unclamped it is catastrophic rather than cosmetic: the HUD anchors to
 * these insets, so an oversized bottom pushes the TIME bar above the score and
 * throws the movement stick clean off the top of the screen, and the menu and
 * results screens get squeezed into a sliver that clips from the top.
 */
export const MAX_SAFE_AREA_FRACTION = 0.3;

/**
 * Bounded both ways, but not squashed to zero: a letterboxed frame legitimately
 * gets negative offsets so the HUD can reach back out toward the host boundary.
 * Only the magnitude is capped.
 */
function clampInset(value: number, extent: number): number {
    if (!Number.isFinite(value)) return 0;
    const limit = Math.max(0, extent) * MAX_SAFE_AREA_FRACTION;
    return Math.max(-limit, Math.min(value, limit));
}

export function safeAreaOffsetsForFrame(
    safeArea: Readonly<EdgeInsets>,
    frame: Readonly<FrameBounds>,
    viewport: Readonly<ViewportSize>,
): EdgeInsets {
    const safeRight = viewport.width - Math.max(0, safeArea.right);
    const safeBottom = viewport.height - Math.max(0, safeArea.bottom);
    return {
        top: clampInset(Math.max(0, safeArea.top) - frame.top, viewport.height),
        right: clampInset(frame.right - safeRight, viewport.width),
        bottom: clampInset(frame.bottom - safeBottom, viewport.height),
        left: clampInset(Math.max(0, safeArea.left) - frame.left, viewport.width),
    };
}

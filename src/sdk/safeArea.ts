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

function finite(value: number): number {
    return Number.isFinite(value) ? value : 0;
}

export function safeAreaOffsetsForFrame(
    safeArea: Readonly<EdgeInsets>,
    frame: Readonly<FrameBounds>,
    viewport: Readonly<ViewportSize>,
): EdgeInsets {
    const safeRight = viewport.width - Math.max(0, safeArea.right);
    const safeBottom = viewport.height - Math.max(0, safeArea.bottom);
    return {
        top: finite(Math.max(0, safeArea.top) - frame.top),
        right: finite(frame.right - safeRight),
        bottom: finite(frame.bottom - safeBottom),
        left: finite(Math.max(0, safeArea.left) - frame.left),
    };
}

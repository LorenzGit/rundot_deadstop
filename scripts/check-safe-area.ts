import assert from "node:assert/strict";
import { safeAreaOffsetsForFrame } from "../src/sdk/safeArea.ts";

assert.deepEqual(
    safeAreaOffsetsForFrame(
        { top: 88, right: 0, bottom: 34, left: 0 },
        { top: 0, right: 390, bottom: 844, left: 0, width: 390, height: 844 },
        { width: 390, height: 844 },
    ),
    { top: 88, right: 0, bottom: 34, left: 0 },
    "a full-viewport frame must receive the full host safe area",
);

assert.deepEqual(
    safeAreaOffsetsForFrame(
        { top: 88, right: 0, bottom: 34, left: 0 },
        { top: 102, right: 390, bottom: 742, left: 30, width: 360, height: 640 },
        { width: 430, height: 844 },
    ),
    { top: -14, right: -40, bottom: -68, left: -30 },
    "letterboxed HUD edges must receive signed offsets that reach out to the host safe boundaries",
);

assert.deepEqual(
    safeAreaOffsetsForFrame(
        { top: 88, right: 18, bottom: 34, left: 12 },
        { top: 60, right: 420, bottom: 820, left: 4, width: 416, height: 760 },
        { width: 430, height: 844 },
    ),
    { top: 28, right: 8, bottom: 10, left: 8 },
    "only the safe-area overlap with the game frame must become local HUD padding",
);

console.log("safe area check ok: viewport boundaries converted to signed frame offsets");

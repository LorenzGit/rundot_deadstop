/**
 * First-time onboarding.
 *
 * DEADSTOP's whole hook is one counter-intuitive rule: the world only moves
 * while you do. A line of text does not teach that — standing still and
 * watching the page freeze does. So this coaches by demonstration: each step
 * names one thing and waits for the player to actually do it, rather than
 * dumping a control list that disappears on the first keypress.
 *
 * There are only two things to teach, because there are only two controls. An
 * empty gun throws itself, so throwing has no verb and needs no lesson.
 *
 * Pure and deterministic on purpose: no DOM, no clock of its own, one method
 * fed one frame at a time. The headless sim drives it exactly as the game does.
 */

export type FtueStepId = "move" | "shoot";

export interface FtueStep {
    id: FtueStepId;
    /** The rule being taught, in the game's own voice. */
    title: string;
    touchHint: string;
    keyboardHint: string;
}

export const FTUE_STEPS: readonly FtueStep[] = [
    {
        id: "move",
        title: "TIME MOVES WHEN YOU DO",
        touchHint: "DRAG THE MOVE STICK · THE PAGE RUNS WHILE YOU WALK",
        keyboardHint: "WASD OR ARROWS · THE PAGE RUNS WHILE YOU WALK",
    },
    {
        id: "shoot",
        title: "NOW PUT A ROUND IN THEM",
        touchHint: "TAP ANYWHERE TO SHOOT THAT SPOT",
        keyboardHint: "MOUSE AIMS · CLICK FIRES",
    },
];

/** World units the player must cover before the clock lesson has landed. */
export const FTUE_MOVE_DISTANCE = 190;

/**
 * A step cannot be satisfied until it has been legible for this long.
 *
 * Without it the coach is useless in exactly the case it matters. Auto-fire is
 * on by default and most players walk with the trigger down, so the frame that
 * completes "move" is usually a frame they are already shooting on — "NOW PUT A
 * ROUND IN THEM" would appear and be satisfied before anyone could read it. An
 * instruction nobody can read is not an instruction.
 */
export const FTUE_MIN_DWELL_SECONDS = 1.6;

export interface FtueFrame {
    /** Real seconds elapsed this frame. */
    delta: number;
    /** World units the player moved this frame. */
    moved: number;
    /** Rounds the player fired this frame. */
    shots: number;
}

export class Ftue {
    private index = 0;
    private travelled = 0;
    private shownFor = 0;
    private satisfied = false;
    private finished: boolean;

    /** Returning players are never coached again. */
    constructor(alreadySeen: boolean) {
        this.finished = alreadySeen;
    }

    step(): FtueStep | null {
        if (this.finished) return null;
        return FTUE_STEPS[this.index] ?? null;
    }

    isComplete(): boolean {
        return this.finished;
    }

    /** Ends coaching for good — a cleared page, or the player opting out. */
    finish(): void {
        this.finished = true;
    }

    /**
     * Feeds one frame. Returns true when the visible step changed, so the
     * caller only touches the DOM on a transition.
     */
    observe(frame: FtueFrame): boolean {
        if (this.finished) return false;
        const current = FTUE_STEPS[this.index];
        if (!current) {
            this.finished = true;
            return true;
        }

        this.shownFor += Math.max(0, frame.delta);

        // The demonstration latches the moment it happens, and the step clears
        // once it has also been readable. Without the latch a throw performed
        // during the dwell would be thrown away — and the player only has the
        // one gun, so there would be nothing left to demonstrate with.
        if (!this.satisfied) {
            if (current.id === "move") {
                this.travelled += Math.max(0, frame.moved);
                this.satisfied = this.travelled >= FTUE_MOVE_DISTANCE;
            } else {
                this.satisfied = frame.shots > 0;
            }
        }
        if (!this.satisfied || this.shownFor < FTUE_MIN_DWELL_SECONDS) return false;

        this.index += 1;
        this.shownFor = 0;
        this.satisfied = false;
        if (this.index >= FTUE_STEPS.length) this.finished = true;
        return true;
    }
}

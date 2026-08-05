import { recordAnalytics, recordFunnelStep } from "../../sdk/runSdk.ts";
import { countedSteps, createAnalytics } from "./analytics.ts";

/**
 * DEADSTOP funnel registry.
 *
 * The full loop and monetization already fired as custom events; what was
 * missing was the ordered declaration that turns those events into a
 * diagnosable drop-off curve. Every step below is an event the game already
 * emitted.
 *
 * Step names and numbers are frozen now that they are deployed: add new beats
 * at the end of a funnel, never renumber or rename an existing one.
 */
export const analytics = createAnalytics({
    emitEvent: (name, payload) => recordAnalytics(name, payload),
    emitFunnelStep: (step, name, funnel, order) => recordFunnelStep(step, name, funnel, order),
    funnels: {
        /**
         * The loading phase itself, ahead of the first-run funnel (order 0).
         *
         * The first-run funnel starts at "the game finished loading", so a player
         * who closed the tab during boot never appeared in it at all — a load
         * regression and a retention problem looked identical. Step 1 fires on the
         * first executable line, before any await, and is buffered until the SDK
         * transport is up.
         *
         * A separate funnel rather than steps prepended to the existing one,
         * because shipped step numbers must never be renumbered.
         */
        load: {
            order: 0,
            onceEver: true,
            steps: [
                "load_started", // first line of script execution
                "load_sdk_ready", // host handshake resolved
                "load_save_ready", // progress restored
                "load_assets_ready", // playable frame reachable
            ],
        },
        ftue: {
            order: 1,
            onceEver: true,
            steps: [
                "game_loaded", // boot complete, scene ready
                "run_started", // pressed play
                "first_enemy_down", // first kill — the first "I get it" beat
                "ftue_completed", // coach marks finished
                "first_level_cleared", // first level survived
                "first_run_ended", // first run resolved
                "second_run_started", // came back for another run
            ],
        },
        // Repeatable: how deep players get across their first 12 runs.
        engagement: { order: 2, steps: countedSteps("run_completed_", 12) },
        /**
         * Store conversion. Every step below is an event this game was already
         * firing; without the declaration the dashboard could show that purchases
         * happened but not where the other players dropped out of the flow.
         *
         * Repeatable (not onceEver): a player can buy more than once, and each
         * pass through the store should count.
         */
        purchase: {
            order: 3,
            steps: [
                "monetization_surface_viewed", // the store/offer was actually seen
                "purchase_tapped", // a specific product was chosen
                "checkout_started", // the host purchase sheet was requested
                "checkout_result", // the host returned a verdict
            ],
        },
    },
    marksKey: "deadstop_funnel_marks",
    debug: import.meta.env.DEV,
});

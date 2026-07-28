# DEADSTOP measurement

Analytics are capability-gated behind the RUN facade and never block gameplay.

## Events

| Event | Fired when | Key fields |
| --- | --- | --- |
| `game_loaded` | Boot completes | `version`, `saveSource`, `orientation` |
| `run_started` | A run begins | `inputMode` |
| `first_enemy_down` | First kill of the session | — |
| `controls_discovered` | The player first moves or fires | — |
| `level_started` | A level begins | `level`, `archetype`, `modifier`, `elite`, `total` |
| `level_cleared` | A level ends | `level`, `bonus`, `reward` |
| `booster_taken` | A draft card is picked | `boosterId`, `stacks` |
| `kit_spent` | Ink is spent starting a run | `ink`, `boosters` |
| `ink_case_redeemed` | A verified ink order is granted | `itemId`, `orderId`, `ink` |
| `run_ended` | A run is banked | `score`, `level`, `downs`, `grazes`, `bestChain`, `boosters`, `revives`, `elapsed` |
| `retry_tapped` / `results_exit_tapped` | Results navigation | `destination`, `rewardedInteracted` |
| `palette_unlocked` | A page is bought with ink | `paletteId`, `cost` |
| `daily_reward_claim` | Daily ink claim | `ok`, `reward` |
| `setting_changed` | Any setting toggles | `music`, `sfx`, `haptics`, `reducedMotion` |
| `monetization_surface_viewed` | Ledger or Settings opened | `surfaceId`, `placement`, `progression` |
| `ad_offer_viewed` | Second Wind offer rendered | `placementId`, `adType`, `rewardId`, `status` |
| `ad_requested` / `ad_result` / `reward_granted` | Ad lifecycle | `placementId`, `adType`, `result` |
| `interstitial_gate_evaluated` | Results break decision | `placementId`, `runNumber`, `result` |
| `purchase_tapped` / `checkout_started` / `checkout_result` | Purchase funnel | `productId`, `placement`, `result` |

## KPIs

- **Loop health:** runs per session, median level reached, share of runs ending
  on level 1, and the level histogram by act.
- **Draft health:** pick rate per booster, win-rate proxy (levels survived after
  taking it), and boosters that are never picked.
- **Kit economy:** ink earned per run versus ink spent per run, share of runs
  started with a full kit, and ink balance distribution.
- **Teaching:** time from `run_started` to `controls_discovered`; share of first
  sessions reaching wave 2.
- **Rewarded:** offer view to completion rate; share of runs that use Second
  Wind; retention delta for players who use it.
- **Ads:** interstitial gate outcomes by reason; abandonment immediately after a
  results break.
- **Purchase:** conversion by product; Ledger visits per payer; refund rate.

## Guardrails

- Every booster stays draftable for free. If a booster is ever kit-only, the
  non-payer promise is broken and the change must be reverted.
- Ink earn rate is tuned so a full kit is reachable in a handful of runs; if
  ink-case revenue rises while ink-per-run falls, that is a red flag, not a win.
- Assisted runs are labelled in results and carried in `run_ended.revives` so
  they can be excluded from difficulty analysis.
- Every ad and purchase event is recorded on both success and failure so a
  silent no-fill is visible in the funnel.

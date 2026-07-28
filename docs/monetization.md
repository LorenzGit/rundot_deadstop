# Day-zero monetization brief

This is the final monetization design for DEADSTOP. The player sees complete,
normally discoverable offers in the Ledger, in Settings, and on the death
screen — never a platform-status dashboard. Prices are explicit server-catalog
hypotheses, ownership comes only from RUN Shop and Entitlements, rewarded value
is granted only after a host-confirmed completion, and the one mandatory ad
fires on a single documented post-results transition.

## Product context

- **Game / version:** DEADSTOP v0.1.0 on RUN SDK 5.24
- **Audience and rating:** arcade and action-puzzle players 12+; stylised
  stick-figure gunplay drawn as ink on paper
- **Core loop and session:** one to four minute runs that end on a single hit,
  with instant retry
- **Value moment:** finish one run and reach wave 2
- **Model:** hybrid — durable cosmetics plus one optional rewarded revive and a
  capped results break
- **Why it fits:** the page palette *is* the game's identity, so swapping it is
  genuinely desirable and completely powerless. Short runs create a clean,
  non-interruptive results break, and a one-hit-death game has an obvious,
  honest place for an optional revive.

## Non-payer promise

Every gun, enemy, wave, cover layout, and scoring rule is free forever. Ink is
earned only from play and the daily track, and it buys two of the six pages
outright. No purchase and no ad changes accuracy, damage, speed, ammunition,
wave composition, or the score formula.

## Purchases

| Product | Catalog id | Entitlements | Price | Value |
| --- | --- | --- | --- | --- |
| Ledger Pack | `deadstop_ledger_pack` | `deadstop_ledger_pack` | 199 RB | Blueprint and Carbon pages, permanent |
| Ad-Free Forever | `deadstop_no_interstitials` | `deadstop_no_interstitials` | 299 RB | Removes the mandatory results break |
| First Pen Bundle | `deadstop_founder_bundle` | all three, incl. `deadstop_pen_redpen` | 399 RB | Ad-free, both pack pages, and the exclusive Red Pen page |

## Consumables: Ink Cases

| Product | Catalog id | Price | Ink |
| --- | --- | --- | --- |
| Small Ink Case | `deadstop_ink_case_small` | 99 RB | 600 |
| Ink Case | `deadstop_ink_case_medium` | 249 RB | 2,000 |
| Large Ink Case | `deadstop_ink_case_large` | 499 RB | 5,000 |

A full two-booster kit costs `170..380` ink and a competent run pays `10..40`,
so a case is a shortcut of a handful of runs rather than a gate.

**Redemption is order-keyed, not client-keyed.** After any purchase and on every
boot, the client reads `shop.getOrderHistory()`, finds fulfilled orders for ink
catalog items whose `orderId` is not already in `monetization.redeemedOrderIds`,
grants the ink, and records the id. This means: a replayed history cannot
double-grant, a checkout interrupted by a kill is honoured on the next boot, and
the client never grants ink from its own optimism.

All three are non-consumable, unique, refund-eligible for 24 hours, and gated
behind the value moment: the Ledger Pack after one completed run, the other two
after two.

### The RB anchor

**1 RB = 1 US cent**, verified against the live RUN Bits purchase screen on
**2026-07-27**. Every non-bonus tier lands on the same rate, and the two largest
packs carry their advertised bonus:

| Bundle | Price | RB per $ | Bonus |
| ---: | ---: | ---: | ---: |
| 200 RB | $1.99 | 100.5 | — |
| 500 RB | $4.99 | 100.2 | — |
| 1,000 RB | $9.99 | 100.1 | — |
| 2,000 RB | $19.99 | 100.1 | — |
| 6,000 RB | $49.99 | 120.0 | +20% |
| 13,000 RB | $99.99 | 130.0 | +30% |

Record this whenever prices are revisited. The workspace contains sibling games
priced on a much higher band (400–4,000 RB, i.e. $4–$40) — those are *expensive
products*, not a different unit, and mistaking one for the other is an easy way
to talk yourself into a tenfold repricing that is not warranted.

### Price rationale and rollback

The ladder reads in dollars as $0.99 / $1.99 / $2.49 / $2.99 / $3.99 / $4.99 —
conventional mobile entry points, deliberately below the impulse ceiling for a
free arcade title with short sessions.

Value curves, both intentionally rewarding the larger commitment:

- **Ink cases:** `6.1` / `8.0` / `10.0` ink per RB. Each step up is a real,
  legible improvement rather than a flat rate with a bigger number.
- **First Pen Bundle** at $3.99 against $4.98 for Ad-Free plus Ledger Pack
  bought separately: a 20% saving *and* an exclusive page found nowhere else.

These are documented, reversible launch hypotheses rather than proven facts.
Rollback signal: bundle conversion under `0.5%` after 1,000 exposed sessions, or
a refund rate over `3%` on any single product. Prices are changed in
`rundot/shop.config.json` and uploaded; the client never hard-codes a live
price.

## Ads

| Placement | Format | Trigger | Rules |
| --- | --- | --- | --- |
| `rewarded_second_wind` | Rewarded | Death screen, before the run is banked | Once per run (claim id includes the run counter), 3 per session, 3 per day, 120s cooldown. Grants a revive on the same wave with the wave re-inked and the score kept. |
| `interstitial_results_break` | Interstitial | Leaving the results screen | Every third eligible banked run, 1 per session, 3 per day, 600s cooldown. Never in the first session. Skipped when the player took the rewarded offer. Removed permanently by `deadstop_no_interstitials`. |

The rewarded offer is a genuine choice at a genuine moment of loss, not a
currency faucet, so it cannot be farmed for score: the revive keeps the score
you already earned and marks the run as assisted in the results.

## Fail-closed architecture

- Placements are `enabledByDefault: false` and only activate through RUN LiveOps.
- Ownership requires `entitlements.listEntitlements()` to have returned; a local
  save can only ever unlock ink-bought pages.
- A purchase intent is written to the save before checkout and reconciled from
  order history on the next boot, so a mid-checkout kill cannot lose an order or
  double-grant one.
- A rewarded completion is recorded in the save before the revive is applied.
- Every host call is bounded by a timeout, and every failure path grants nothing.
- The private test bay is hidden behind five taps on the version label and is
  disabled entirely by the public LiveOps config.

## QA matrix

| Case | Expectation |
| --- | --- |
| No host (local dev) | Offers show a preview price and stay disabled |
| Host, LiveOps disabled | No offers, no ads, no errors |
| Host, entitlements unavailable | Paid pages hidden, ink pages still work |
| Rewarded video cancelled | No revive, run stays banked |
| Rewarded video completed twice in a run | Second attempt reports the offer already used |
| Interstitial no-fill | Navigation continues silently |
| Ad-free owned | Results break never fires; rewarded offer still available |
| Purchase interrupted | Reconciled on next boot from order history |
| Ink case bought twice | Two distinct order ids, two grants |
| Same ink order replayed | Second pass grants nothing |
| Ink case bought offline-then-online | Granted on the boot that sees the fulfilled order |

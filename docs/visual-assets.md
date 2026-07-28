# DEADSTOP visual assets

## Art direction: Field Ledger Ink

Everything is drawn as if inked by hand on a ledger page. No gradients, no glow,
no bloom, no bitmaps.

| Role | Field Ledger |
| --- | --- |
| Page | `#f4eee1` |
| Page shade | `#e6dcc8` |
| Rule | `#d8cbb0` |
| Ink | `#14100c` |
| Hostile | `#c8382a` |
| Player mark | `#12766c` |
| Ammo | `#c8891a` |
| Ghost | `#b8ab90` |

Five more pages ship with the same roles and different values: Graph Grid, Night
Shift, Blueprint, Carbon, and Red Pen. Every colour in the DOM shell is driven
from the same palette object, so a page swap restyles the HUD and the canvas
together.

## Marks

- **Wobble.** Every stroke is a jittered polyline. The jitter comes from an
  integer hash keyed by shape, so a given mark keeps its personality frame to
  frame.
- **Boil.** The jitter key advances nine times a second, which makes the lines
  breathe like hand-drawn animation. Reduced motion freezes the boil and keeps
  the wobble.
- **Figures.** Six strokes: two legs, a spine, two arms, and a head ring, plus a
  six-point gun silhouette. Tanks are drawn 22% larger and heavier.
- **Deaths.** A splatter plus a chalk outline that stays on the page until the
  next wave.
- **The page.** Ruled lines and fibre speckle, drawn once per palette change
  rather than per frame, running clean to the screen edge with no border.
- **Booster glyphs.** One 24×24 ink-line mark per booster in
  `src/ui/boosterIcons.ts`, shared by the HUD chip, the draft card and the kit
  card. Stroked in `currentColor` so each surface only sets size and hue.

## Production

- `node scripts/generate-thumbnail.mjs` redraws the 512×512 store tile from code
  with the same wobble hash the game uses, then encodes it with `sips`.
- `node scripts/visual-qa.mjs` captures the release screenshot set into
  `docs/qa/`, including one capture per page palette.
- No external image files ship except the thumbnail.

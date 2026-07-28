# DEADSTOP audio

Sound effects are generated in Web Audio and ship no files at all — they are
gameplay feedback, so they have to be instant, free, and impossible to stack
into mud. The score is the one authored asset: `Midnight Static`, a two-minute
loop bundled at 128 kbps (1.9 MB).

## The score follows the clock

The music is wired to `timeScale` exactly as the world is, so the player hears
their own agency rather than a soundtrack running alongside it. Standing still
does not merely duck the track — it pulls it behind a closed filter, so a held
page sounds like it is heard through a wall and moving again opens it back up.

| | Standing still | Moving |
| --- | ---: | ---: |
| Level (before the music volume setting) | `0.30` | `0.50` |
| Lowpass corner | `460 Hz` | `16 kHz` |
| Playback rate | `1.0` | `1.0` |

**Tempo is deliberately not part of this.** An earlier version also pushed
playback rate from `0.93` to `1.06`, which pitch-shifts the entire mix along
with it — on an authored track that reads as broken rather than tense. The
filter and the level carry the whole effect, and an invariant now fails the
build if `playbackRate` reappears in the audio path.

Everything between is interpolated from `timeScale`, smoothed with a `0.22s`
time constant so the score breathes rather than steps. The filter sweep is
exponential, because that is how the ear reads pitch.

The track is fetched and decoded once, then looped. Music is a nicety, so every
failure in that path is swallowed and logged: a missing or undecodable file
leaves the game silent but never blocks the loop, and never throws into a frame.
Playback starts only after a real user gesture unlocks the context, and the
whole graph suspends with the host lifecycle, so nothing plays behind a paused
or backgrounded game.

## Cues

Each cue is a filtered noise burst, an optional pitched tone, and a minimum gap
so a burst of SMG fire cannot stack into a wall of sound.

| Cue | Character |
| --- | --- |
| `shot_light` / `shot_heavy` / `shot_far` | Dry cracks; heavy for shotgun and launcher, far for hostile fire |
| `dry` | A high, tiny click. The most important sound in the game |
| `throw` | A rising bandpass whoosh |
| `hit` / `down` | A short thud; a longer tear for a body going down |
| `pickup` / `graze` / `wave` / `reward` | Pen-and-paper ticks and rising figures |
| `blast` | A long low sweep |
| `defeat` | A descending pair, then silence |

## Lifecycle and settings

- The context is created lazily and only unlocked by a real pointer or key
  event.
- `setPaused` suspends the context for host pause, sleep, tab hide, ads, and the
  pause screen.
- Music and sound have separate enable flags and volumes, all persisted.
- The noise buffer is generated once from a deterministic integer hash; there is
  no `Math.random` anywhere in the audio path.

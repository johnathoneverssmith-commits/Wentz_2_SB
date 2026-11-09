# Audio measurements (clean run)

**Limitation, preserved:** this environment has no audio device (no `aplay`/`arecord`) and no human listened.
Chromium still renders the Web Audio graph, so a recorder node was spliced onto `AudioContext.destination`
and the real `MusicDirector` and `cue()` code were driven from the Vite dev server on a blank page (the real app
mounts its own music director, which contaminated a first run; that run was discarded). Not captured: the
browser-speech "chants" (`speechSynthesis`), the production bundle, in-app triggering. Defaults: music 0.34, effects 0.6.
Figures are objective loudness, not a judgement of whether it sounds good.

## Music beds (12 s, first 2 s skipped)
| Mood | RMS dBFS | Peak dBFS | 2 s window range | Strongest envelope repeat |
|---|---|---|---|---|
| champion | -23.2 | -4.3 | -23.8..-22.6 | 2.41 s (r 0.68) |
| draft | -23.6 | -5.1 | -24.5..-23.0 | 2.60 s (0.84) |
| freeAgency | -23.4 | -5.0 | -24.0..-22.4 | 1.66 s (0.74) |
| frontOffice | -24.1 | -5.1 | -24.9..-23.3 | 1.68 s (0.57) |
| gameday | -22.5 | -4.9 | -23.7..-21.8 | 1.50 s (0.78) |
| lobby | -24.0 | -5.0 | -24.7..-23.4 | 4.28 s (0.74) |
| playoffs | -22.7 | -4.7 | -23.5..-21.8 | 1.67 s (0.88) |

Beds sit within 1.6 dB of each other (consistent mix), no clipping, ~4-5 dB of headroom.
The 1.5-4.3 s periodicity (r 0.57-0.88) is the expected rhythmic pattern; it says nothing about long-session fatigue.

## Cues (solo, and over the draft bed)
| Cue | Solo peak dBFS | Audible | Over bed (max 0.25 s RMS) |
|---|---|---|---|
| onTheClock | -6.1 | 2.00 s | +6.5 dB |
| pickMade | -7.3 | 0.75 s | +3.7 |
| touchdown | -7.8 | 3.00 s | +6.0 |
| fieldGoal | -10.6 | 1.50 s | +4.4 |
| turnover | -10.7 | 1.75 s | +3.3 |
| injury | -9.1 | 1.00 s | +5.4 |
| tradeOffer | -14.3 | 0.75 s | +3.1 |
| signed | -15.0 | 0.75 s | +3.6 |
| newJob | -7.5 | 1.50 s | +5.3 |
| gameWon | -8.1 | 2.25 s | +5.2 |
| gameLost | -10.8 | 1.50 s | +3.9 |
| champion | -5.0 | 6.00 s | +8.5 |

Reading: the ordering matches the stated design (the clock and the championship stand out most). The two quietest
cues, `tradeOffer` and `signed`, are only ~3 dB over the music and are the likeliest to be masked once chants or
a crowd bed are layered; this needs a human ear to judge. Repetition across a long session is unmeasured.

# Coverage Matrix

Evidence levels: **UI** = played in a browser · **SIM** = accelerated/headless exercise · **INSP** = code or static screen review · **—** = not tested.
A passing automated suite is *not* a UI journey. Nothing below is credited until an agent report cites it.

Last updated: 2026-11-07 — no agent evidence received; all cells are "—".

## Per-run log (one row per agent run)

| Run | Agent | Mode | Team / format | Seed | Seasons (start→end) | Stages UI | Stages SIM | Browser interactions | GMs | Save/reload | Blockers | TAFIs |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — | — | — | — | — | — | — |

## Stage × agent grid (fill the best level reached)

Stages (from `stageMachine.ts`): setup/team select · fantasy draft · coaching draft · free agency · training camp · Hooded Figure · depth chart · preseason · league developments · regular season (block 1) · trade deadline · regular season (block 2) · playoffs · season end/awards · re-sign/offseason FA · rookie draft · rollover.

| Stage | A1 | A2 | A3 | A4 | A5 | A6 | A7 | A8 | A9 |
|---|---|---|---|---|---|---|---|---|---|
| Setup / team select | — | — | — | — | — | — | — | — | — |
| Fantasy draft | — | — | — | — | — | — | — | — | — |
| Coaching draft | — | — | — | — | — | — | — | — | — |
| Free agency (both) | — | — | — | — | — | — | — | — | — |
| Training camp | — | — | — | — | — | — | — | — | — |
| Hooded Figure | — | — | — | — | — | — | — | — | — |
| Depth chart / game plan | — | — | — | — | — | — | — | — | — |
| Preseason | — | — | — | — | — | — | — | — | — |
| Regular season | — | — | — | — | — | — | — | — | — |
| Trade deadline | — | — | — | — | — | — | — | — | — |
| Playoffs / bracket | — | — | — | — | — | — | — | — | — |
| Season end / awards | — | — | — | — | — | — | — | — | — |
| Rookie draft | — | — | — | — | — | — | — | — | — |
| Multi-season rollover (2+ yrs) | — | — | — | — | — | — | — | — | — |

## Dimension grid

| Dimension | Required for alpha sign-off | Covered so far |
|---|---|---|
| Single-player, `nfl` 32-team, ≥5 consecutive seasons | yes | — |
| Single-player `humansOnly` | yes | — |
| Multiplayer ≥3 human GMs, full year | yes | — |
| Commissioner pause/resume/vacate | yes | — |
| Save/reload at every turn-based stage | yes | — |
| talentImpact Realistic / Amplified / Extreme | spot-check | — |
| Difficulty casual…Master | spot-check | — |
| Phone width (390/320) and desktop | yes | — |

## Pre-program automated coverage (context only, not credited)

`npm run e2e` Playwright specs (draft, free agency, offseason, playoffs, save-reload, play-by-play, …), `online/test/full-circuit.test.ts`, `humans-only-circuit.test.ts`, `ui-source/src/state/playthrough.test.ts`. These guard regressions; they do not substitute for agent playthroughs.

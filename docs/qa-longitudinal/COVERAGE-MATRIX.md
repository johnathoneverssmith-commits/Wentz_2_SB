# Coverage Matrix

Evidence levels: **UI** = hand-played in a browser · **FIX** = real UI rendered from engine-played fixture saves (not hand-played; added 2026-11-07) · **SIM** = accelerated/headless exercise · **INSP** = code or static screen review · **—** = not tested.
A passing automated suite is *not* a UI journey. Nothing below is credited until an agent report cites it.

Last updated: 2026-11-07 — evidence from Agents 1 and 3 only (both pre-baseline, master `3abcfff`). All other cells "—".

## Per-run log (one row per agent run)

| Run | Agent | Mode | Team / format | Seed | Seasons | Stages UI (hand) | Stages FIX / SIM | Browser interactions | GMs | Save/reload | Blockers | TAFIs |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A1-r1 | 1 | SP, production build, Chromium | BAL only, `nfl` | 4242 (fixture) | 2027 draft→SB + 2028 offseason start, loaded from saves | setup → team select → draft room start (one attempt, abandoned: minutes/pick) | FIX: 23 routes at 1024/768/390/320; fonts-blocked, reduced-motion, keyboard-focus probes | "unknown" (reported qualitatively) | 1 | none reported | no 2nd season played; animations/Gamecast/Hooded Figure/League Developments/other palettes/online lobby (except server-down) not rendered | UI-TAFI-001…022 |
| A3-r1 | 3 | headless, **real engine** | all 32 rosters (unit/staff swaps); KC focal (longitudinal) | unit 5_100_000+rep·1009+team; staff 7_100_000+…; league 9301–9303 | 2026–2030 ×3 leagues ×2 variants | none | SIM: unit swap ≤1,280 pairs; staff 8 arms ×640; 5-season CPU-run leagues; price probe (1 league) | 0 (no UI) | 0 human | n/a | no usable browser stack; draft/FA/trade/MP/human-policy not run | COMP-001…006 (+007 = gap list) |
| A4-r1 | 4 | SP real UI + adapter (real engine), headless engine + Mock, online | BAL, `nfl`; online `humansOnly` 4 teams | 4001, 47547 | UI from creation 2027–2030 (2031 partial); online 2027–2028 (+2029 partial) | most stages through UI incl. 50 reload checks | SIM: 4-season Mock, 2/5/11-season engine | ≈700 SP clicks, ≈1,500 MP driver iterations | 2 GMs + 1 outsider | 50/50 reloads identical until save failed; failure-window reload | Chromium only; Hooded Figure/inactive-GM/disconnect/transfer not exercised live | TAFI-GAP-001…011 |
| A1b-r1 | 1 (presentation session) | real build, Chromium, harness; audio via Web Audio capture | BAL only, `nfl` | fixture saves | baseline `d0727ff` | none hand-played | FIX: 14 screens × 1440/390/320 (42 captures); PA-001…007 verified on real pixels at 1440 and 390; audio loudness measured headless | unknown | 0 | none | no human listening, chants, keyboard/focus, reduced motion, other teams, hand-played journey | PA-001…010 (6 confirmed) |
| A6a-r1 (PR #106, draft, unmerged) | adversarial gameplay session | SP real UI + real engine adapter (`d0727ff`), local | BAL (5 seasons, fantasy draft off), DAL (3 seasons, fantasy draft on), `nfl` | 8724, 31337 | 2027–2031; 2027–2029 (+ one Mock season) | every stage via scripted button-clicking; coaching, FA, deadline and re-signing **delegated to staff** | invariant, standings, box-score, cap and year-over-year checkers on saved states | ≈700 scripted clicks + attack scripts | 0 | browser restarts, tampered records, legacy migration, rapid clicks | not tested: manual trades/contracts/FA bids, online, non-default sizes, other browsers, two tabs, tab closed in the write window | ADV-001, ADV-002 (pending intake) |

## Stage × agent grid (fill the best level reached)

Stages (from `stageMachine.ts`): setup/team select · fantasy draft · coaching draft · free agency · training camp · Hooded Figure · depth chart · preseason · league developments · regular season (block 1) · trade deadline · regular season (block 2) · playoffs · season end/awards · re-sign/offseason FA · rookie draft · rollover.

| Stage | A1 | A2 | A3 | A4 | A5 | A6 | A7 | A8 | A9 |
|---|---|---|---|---|---|---|---|---|---|
| Setup / team select | FIX+UI(partial) | — | — | — | — | — | — | — | — |
| Fantasy draft | FIX+UI(partial) | — | — | — | — | — | — | — | — |
| Coaching draft | FIX | — | — | — | — | — | — | — | — |
| Free agency (both) | FIX | — | — | — | — | — | — | — | — |
| Training camp | FIX | — | — | — | — | — | — | — | — |
| Hooded Figure | — | — | — | — | — | — | — | — | — |
| Depth chart / game plan | FIX | — | — | — | — | — | — | — | — |
| Preseason | FIX | — | — | — | — | — | — | — | — |
| Regular season | FIX | — | SIM | — | — | — | — | — | — |
| Trade deadline | FIX | — | — | — | — | — | — | — | — |
| Playoffs / bracket | FIX | — | SIM | — | — | — | — | — | — |
| Season end / awards | FIX | — | — | — | — | — | — | — | — |
| Rookie draft | FIX | — | — | — | — | — | — | — | — |
| Multi-season rollover (2+ yrs) | — | — | SIM (CPU-run, 5 seasons) | — | — | — | — | — | — |

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

# Agent Status

Last updated: 2026-11-07. Derived from GitHub evidence only. A mission prompt existing ≠ testing started. All results are **pre-baseline** (owner decision D-003).

| # | Agent | Evidence on GitHub | Status | Notes |
|---|---|---|---|---|
| 1 | Aesthetics & UI/UX | PR [#94](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/94) (open): report, scorecard, 22 TAFIs, stadium inventory, 17 screenshots | **Submitted (first pass)** | Declares its own gaps: no hand-played 2nd season, no motion review, BAL only, no Gamecast/Hooded Figure/online beyond server-down. A re-run is needed after Group 08 and on the baseline. |
| 2 | Simulation Realism | none found | Awaiting evidence | Must state sim path (D-006) |
| 3 | Competitiveness | draft PR [#95](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/95) (branch `claude/kind-feynman-ay3w05`): report, 6 TAFIs, harnesses, raw data | **Work in progress** | Real engine, headless. Covered: unit swaps, staff swaps, 5-season CPU leagues, price probe. Not done: UI play, draft/FA/trade, human-policy runs, multiplayer. Final TAFIs pending. |
| 4 | Gaps & Completeness | none found | Awaiting evidence | |
| 5 | Special Features & Fun | none found | Awaiting evidence | |
| 6–9 | Security, Economy, Multiplayer, Audio | none | Not started | |
| 10 | Coordinator | `docs/qa-longitudinal/` (#93 merged) | Active per session only; no continuous monitoring | |

Other open PRs observed (not QA evidence): #92 audit harness (failing required test), #83 redesign prompts, and old infrastructure PRs #3, #6, #8, #9, #10.

## Format deviations (accepted, to normalise at finalisation)
- Agents 1 and 3 used `docs/qa-longitudinal/agent-0N-*/` rather than `agents/agent-NN-*/`, and kept their own ID series (`UI-TAFI-nnn`, `COMP-nnn`). IDs are preserved; no rename needed. Their reports predate `SUBMISSION-FORMAT.md` being merged, so they lack the session-header block (seeds/stages are present in prose). Ask for a header at finalisation.
- Agent 3's PR #95 includes committed harness code (`harness/*.ts`) and raw data. It is measurement code under `docs/`, not production code, but it is code and needs your review before merge. Docs paths passed the repo's file-coverage test in #93; confirm for `.ts` files under `docs/`.

## Follow-up requests (drafted; **not delivered** — I cannot message other sessions from here; paste these)

**To Agent 1**
1. Say which sim produced the fixture league (real engine vs mock; the fixtures show no play-by-play). Add a session header per `SUBMISSION-FORMAT.md`.
2. UI-TAFI-003: reproduce at scroll 0 and scrolled, 1440 and 390, and name the component; confirm cause or mark unknown.
3. UI-TAFI-011: can a player actually get stuck on the awards page? If yes, raise severity.
4. Check which of 001/002/005/017 Group 08 already removes. Re-run after Group 08 on the baseline, with a second team, and render the live Gamecast and the Hooded Figure if reachable.
5. Fill the missing severity/grounding for UI-TAFI-006/014/019/022.

**To Agent 3**
1. Confirm the games came from the real engine (state the import path in the header) and that the price tables you read (`MockSimulationService.ts`) are the ones used by solo play *and* the online server. If the online server uses different tables, COMP-001/002 apply to solo only.
2. COMP-002: run the sign-and-flip simulation before it is described as an exploit.
3. COMP-006: a scripted, cap-constrained human policy, ≥10 seeds × 10 seasons, at talent 1.0 and 1.5.
4. COMP-005: check whether the depth-chart UI already warns or auto-sorts (Agent 4 may know).
5. Fill the remaining talent-1.5 arms and raise P/RB/K to 1,280 pairs. Report the final TAFIs in one pass.

**To Agent 2** — Run `analysis/39_league_metrics.ts` against the real engine; state the sim path; do not treat solo-UI box scores as engine output unless the adapter was reachable.
**To Agent 4** — Check UI-vs-engine parity for depth-chart warnings (COMP-005) and play-by-play availability in solo (issue #74).

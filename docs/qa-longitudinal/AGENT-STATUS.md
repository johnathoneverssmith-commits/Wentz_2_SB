# Agent Status

Last updated: 2026-11-09 (after #104, #108 merged). Derived from GitHub evidence only. A mission prompt existing ≠ testing started. All results are **pre-baseline** (owner decision D-003).

| # | Agent / session | Evidence on GitHub | Status | Notes |
|---|---|---|---|---|
| 1 | Aesthetics & UI/UX | [#94](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/94) (**open, not merged**; base `48fa26e`, **predates master**) | **Submitted; stale** | Its statements on A1-001/002/005/017/023 are superseded by #101/#103 and must not be merged as-is. Re-verify A1-025…037 on current master and bring the PR up to date (D-012) before it merges |
| 1b | Presentation, Audio & Immersion (an Agent 1 session) | [#104](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/104) (**merged** 2026-11-09 01:13 UTC, merge `6e85b44`; final head `be809b0`) | **Submitted (final, merged); registered** (`PA-nnn`) | 6 confirmed, 2 false positives + 1 sub-reading, 2 reclassified. Audio source-inspected and loudness-measured only; BAL only |
| 2 | Simulation Realism | [#102](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/102) (**merged** 2026-11-08) | **Submitted (merged); NOT centrally registered** | `TAFI-REAL-001…017` in `agent-02-realism/TAFI_BACKLOG.md`. Duplicate candidate REAL-017 = GAP-010 = FUN-TAFI-017. REAL-010 conflicts with STRAT-006 |
| 2b | Strategic Depth, Competitiveness & Fun (the "second brief" of Agent 2's label) | [#105](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/105) (**draft**, head `b27d84a`; folder `agents/agent-02-strategic-depth/`) | **Submitted (draft); registered here** (`STRAT-nnn`) | **Not Agent 2 Simulation Realism**; the `agent-02-` folder prefix collides with `agent-02-realism/`. IDs do not clash. Real engine + one labelled Mock experiment + trade-model probes |
| 3 | Competitiveness | [#95](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/95) (**merged** 2026-11-08) | **Submitted (merged); reconciled 2026-11-09** | Register rows replaced with the final `COMP-001…010` (COMP-002a/002b split; 008, 009, 010 added) |
| 4 | Gaps & Completeness | [#99](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/99) (**merged**, `9e2f541`) | **Submitted (merged); registered** | GAP-008 fixed by #101 (`b4846f7`), GAP-011 by #100 (`13e80ea`); both regression-tested in #106 (draft) |
| 5 | Special Features & Fun | [#98](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/98) (**merged** 2026-11-08) | **Submitted (merged); NOT centrally registered** | `FUN-TAFI-001…018` (= `A5-nnn`). Triage FUN-TAFI-014 (information leak) first |
| 5b | Scouting, synergy & scheme identity design | [#107](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/107) (**draft**) | **Design (not a TAFI submission)** | Evidence is design/prototype-level; nothing implemented. Cited in `DEVELOPMENT-BACKLOG.md` |
| 6 | **Cybersecurity** | none | **Not started** | **No security review exists** |
| 6a | **Adversarial Gameplay QA** (a session that used an "Agent 6" label) | [#106](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/106) (**draft**, head `73e5f97`; `agent-06-adversarial/`) | **Submitted (draft)**; ADV-001/002 **pending intake** | **Not the roster's Agent 6 (Cybersecurity).** Cited as regression evidence for GAP-008/011 |
| 7 | Franchise Economy | none | Not started | GH #37/#38 untriaged; STRAT-002 is the first economy-adjacent evidence |
| 8 | Multiplayer Experience | none | Not started | |
| 9 | Audio & Sound Design | none | Not started | [#104](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/104)'s audio items are a pre-assessment only |
| 10 | Coordinator | `docs/qa-longitudinal/` ([#93](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/93), [#96](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/96), [#97](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/97), [#99](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/99), [#108](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/108) merged) | Active per session only; no continuous monitoring | This update |

**Merged (confirmed on GitHub, 2026-11-09):** [#92](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/92) (`151fa73`), [#93](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/93), [#95](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/95), [#96](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/96), [#97](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/97), [#98](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/98), [#99](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/99) (`9e2f541`), [#100](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/100) (`13e80ea`), [#101](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/101) (`b4846f7`), [#102](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/102), [#103](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/103) (`d0727ff`), [#104](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/104) (`6e85b44`), [#108](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/108) (`22f79aa`).
**Open (not merged):** QA drafts [#105](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/105), [#106](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/106), [#107](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/107); stale [#94](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/94); redesign prompts #83; old infrastructure PRs #3, #6, #8, #9, #10. **Production-code drafts, not QA evidence and not approved:** [#109](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/109) (scheme-fit Phase 0, behind master) and [#110](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/110) (dynasty simulator lock + recoverable reset).

## Briefs for development agents (drafted; owner to deliver — I cannot message sessions)
_Status 2026-11-09: the #92 selector fix and Group 08 briefs are **complete** (#92 `151fa73`, #103 `d0727ff`). The #74 Phase 1 and Agent 1 briefs below are still open._

**#92 development agent (D-010).** Scope, nothing more: (1) add a change-selector rule so every tracked `e2e-audit/**` file is covered (`.claude/skills/wentz-verify/select-checks.mjs`; the failing test is `test/verify-selector.test.ts` › "covers every source file tracked in this repository"; 20 files listed in the CI log, run 42396176539); (2) update the branch against current `master` (`d9af7c4` or later); (3) rerun CI and report the `test` result. Do not change `e2e-audit/` behaviour or anything under `ui-source/`, `src/`, `online/`, `server/`; do not merge. Also confirm that adding the Agent 1/3 documentation PRs' files (`.ts` harness code under `docs/`) will not trip the same rule.

**Group 08 development agent (D-009, D-017, D-018).** Dedicated agent. Use `GROUP-08-PLAN.md` together with `00-brief.md` and `08-cleanup.md` read from branch `docs/ui-redesign-prompts` (do not merge #83). Re-check paths/routes against current master.

**Issue #74 Phase 1 development agent (D-020).** Separate agent, separate PR. Brief: `ISSUE-74-PLAN.md` → "Phase 1 assignment". Phases 2–5 are not approved.

**Agent 1 (D-012).** Update #94 against current master, add the session header (sim path, SHA), continue the incomplete browser work (second season by hand, other team palettes, Gamecast, Hooded Figure, League Developments, online screens) and the follow-ups listed below. Treat 001/002/005/017 as owned by Group 08: re-verify after it merges instead of re-reporting.

## Integration status
**Resolved:** [#104](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/104) is merged at `be809b0` (description matches the report, appendix marked SUPERSEDED, count wording fixed); [#108](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/108) is merged; [#95](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/95)'s final register is reconciled (`MASTER-TAFI-REGISTER.md`); [#105](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/105)'s STRAT series is registered as a draft source.

**Still open:**
1. **Findings not yet registered:** Agent 2's `TAFI-REAL-001…017`, Agent 5's `FUN-TAFI-001…018`, #106's `ADV-001/002`, Agent 1's `A1-025…037` (stale #94). Each is listed in `MASTER-TAFI-REGISTER.md` → "Findings awaiting integration".
2. **Duplicate to consolidate:** the same engine log ("non-finite M04/M09 shift … ignoring it") is `GAP-010` (registered), `TAFI-REAL-017` and `FUN-TAFI-017`. Keep all three IDs; link them to one root cause.
3. **Conflict to resolve:** `REAL-010` (thin tails, persistence 0.16–0.22) vs `STRAT-006` / #105 X1 (heavy low tail, persistence 0.39). No experiment was repeated here.
4. **Label and folder collisions:** `agents/agent-02-strategic-depth/` (#105) vs `agent-02-realism/` (#102); the "Agent 6" label on #106 (adversarial gameplay) vs the roster's Agent 6 (Cybersecurity); `agent-01-presentation/` beside `agent-01-aesthetics/` (#94). IDs are preserved; each PR should state which roster role it fills.
5. **Three ID series for "Agent 1":** `UI-TAFI-001…022` (= `A1-001…022`), `A1-023…037` (#94) and `PA-001…010` (#104). New Agent 1 findings should continue at `A1-038`, or register a new prefix here first.
6. **Cross-session disagreements:** UI-TAFI-012 priority (#94 Medium vs #104 P3); horizontal overflow (#94 "0 on 23 routes" vs PA-002); BAL hub contrast (A1-029 vs PA-004a). #94 is stale, so its side of each needs a re-measure on current master.
7. **Unresolved details:** PA-002 has **no identified root cause**; UI-TAFI-004's P1 is **provisional and unverified** until a live-viewport case is shown; PA-001 names only "Your assets (0)" though "Their assets (0)" was also flagged.
8. **Unreviewed by the coordinator:** [#107](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/107)'s design findings, [#109](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/109) and [#110](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/110). They are described from their own PR text and are not independently verified.

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

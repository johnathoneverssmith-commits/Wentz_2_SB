# Agent Status

Last updated: 2026-11-07. Derived from GitHub evidence only. A mission prompt existing ≠ testing started. All results are **pre-baseline** (owner decision D-003).

| # | Agent | Evidence on GitHub | Status | Notes |
|---|---|---|---|---|
| 1 | Aesthetics & UI/UX | PR [#94](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/94) (open): report, scorecard, 22 TAFIs, stadium inventory, 17 screenshots | **Submitted (first pass)** | Declares its own gaps: no hand-played 2nd season, no motion review, BAL only, no Gamecast/Hooded Figure/online beyond server-down. A re-run is needed after Group 08 and on the baseline. |
| 2 | Simulation Realism | none found | Awaiting evidence | Must state sim path (D-006) |
| 3 | Competitiveness | draft PR [#95](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/95) (branch `claude/kind-feynman-ay3w05`): report, 6 TAFIs, harnesses, raw data | **Work in progress** | Real engine, headless. Covered: unit swaps, staff swaps, 5-season CPU leagues, price probe. Not done: UI play, draft/FA/trade, human-policy runs, multiplayer. Final TAFIs pending. |
| 4 | Gaps & Completeness | PR [#99](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/99): report, 11 TAFIs, evidence, harnesses | **Submitted** (3 full SP seasons via real UI + real engine; 2-GM online ×2 seasons) | Critical GAP-008 → fix PR #101; High GAP-011 → fix PR #100 (both draft, unmerged). Untested items listed in its coverage file. |
| 5 | Special Features & Fun | **none on GitHub.** Owner reports a completed 5-season headless investigation with 13 TAFIs (Hooded Figure / special features), not yet pushed | Reported, **unverified — not registered** (D-014) | Will be registered only when its draft PR exists. No TAFI IDs are recorded from hearsay |
| 1b | Presentation, Audio & Immersion (an Agent 1 session) | draft PR [#104](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/104) (`agent-01-presentation/`), head `ab5b2f0` | **Submitted (final)**; registered, PR **not merged** | 6 confirmed, 3 disproven, 2 reclassified. Audio source-inspected and loudness-measured only. BAL only |
| 6–9 | Security, Economy, Multiplayer, Audio | none | Not started | Audio (9) remains not started: #104's audio is a pre-assessment |
| 10 | Coordinator | `docs/qa-longitudinal/` (#93 merged) | Active per session only; no continuous monitoring | |

Other open PRs observed (not QA evidence): #92 audit harness (failing required test), #83 redesign prompts, and old infrastructure PRs #3, #6, #8, #9, #10.

## Briefs for development agents (drafted; owner to deliver — I cannot message sessions)

**#92 development agent (D-010).** Scope, nothing more: (1) add a change-selector rule so every tracked `e2e-audit/**` file is covered (`.claude/skills/wentz-verify/select-checks.mjs`; the failing test is `test/verify-selector.test.ts` › "covers every source file tracked in this repository"; 20 files listed in the CI log, run 42396176539); (2) update the branch against current `master` (`d9af7c4` or later); (3) rerun CI and report the `test` result. Do not change `e2e-audit/` behaviour or anything under `ui-source/`, `src/`, `online/`, `server/`; do not merge. Also confirm that adding the Agent 1/3 documentation PRs' files (`.ts` harness code under `docs/`) will not trip the same rule.

**Group 08 development agent (D-009, D-017, D-018).** Dedicated agent. Use `GROUP-08-PLAN.md` together with `00-brief.md` and `08-cleanup.md` read from branch `docs/ui-redesign-prompts` (do not merge #83). Re-check paths/routes against current master.

**Issue #74 Phase 1 development agent (D-020).** Separate agent, separate PR. Brief: `ISSUE-74-PLAN.md` → "Phase 1 assignment". Phases 2–5 are not approved.

**Agent 1 (D-012).** Update #94 against current master, add the session header (sim path, SHA), continue the incomplete browser work (second season by hand, other team palettes, Gamecast, Hooded Figure, League Developments, online screens) and the follow-ups listed below. Treat 001/002/005/017 as owned by Group 08: re-verify after it merges instead of re-reporting.

## Open integration issues for PR #104 (resolve before merge)
1. **Stale PR description.** It still says "10 new findings (P0:0, P1:1, P2:5, P3:4), 2 visually confirmed, 5 probe-only, 3 source-only". The final report says 6 confirmed, 3 disproven, 2 reclassified.
2. **Disproven items still read as findings.** `REPORT.md` keeps the whole first pass as an appendix ("superseded where it differs") with PA-006, PA-007 and PA-004b still listed as findings (PA-007 at P2) and a roadmap citing "(PA-002, PA-007, UI-TAFI-012)" and "(PA-008, PA-010) P2". Delete the appendix or strike each disproven item inline; the final section's own priorities (PA-008/010 = P3) contradict the appendix.
3. **Count wording.** "3 false positives (and one half of PA-004)": PA-004b is already one of the three (004b, 006, 007). State it once.
4. **Three ID series for "Agent 1".** `UI-TAFI-001…022` (= `A1-001…022`), `A1-023…037` (#94 wave 2) and `PA-001…010` (#104). No numeric collision, but a fourth session could collide. Rule going forward: new Agent 1 findings continue `A1-038+`, or any new prefix is registered here first. IDs are preserved as issued.
5. **Folder/role overlap.** `agent-01-presentation/` sits beside #94's `agent-01-aesthetics/` and covers audio (Agent 9's remit). Accepted for now; say in the status table which session owns follow-ups.
6. **Cross-session disagreements on the same facts:** (a) UI-TAFI-012 priority (#94 Medium vs #104 P3); (b) horizontal overflow (#94 "0 on 23 routes" vs PA-002); (c) BAL hub contrast (A1-029 none vs PA-004a 3.94:1). Each needs one confirming re-measure by the owning agent.
7. **Missing detail:** PA-002 names no element or CSS rule; PA-001 omits "Their assets (0)"; PA-003's first-pass figure (1.40:1 on white) was corrected to 1.25:1 on an opaque background. Only the corrected figure is used here. Do not confuse it with #103's 1.40:1 Methodology disclosure (a different element, now fixed).
8. **Scope held:** #104 changes 13 files, all under `docs/qa-longitudinal/agent-01-presentation/`; master's tip is its base (`d0727ff`), so no sync is needed. It is a draft with no CI evidence yet.

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

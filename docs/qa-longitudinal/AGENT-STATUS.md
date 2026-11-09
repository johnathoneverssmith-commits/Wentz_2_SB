# Agent Status

Last updated: 2026-11-09. Derived from GitHub evidence only. A mission prompt existing ≠ testing started. All results are **pre-baseline** (owner decision D-003).

| # | Agent | Evidence on GitHub | Status | Notes |
|---|---|---|---|---|
| 1 | Aesthetics & UI/UX | PR [#94](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/94) (open, **not merged**; base `48fa26e`, **predates master**): report, scorecard, A1-001…037 | **Submitted; stale** | Its statements on A1-001/002/005/017/023 are superseded by #101/#103 and must not be merged as-is. Re-verify A1-025…037 on `d0727ff` and bring the PR up to date (D-012) before it merges. |
| 2 | Simulation Realism | none found | Awaiting evidence | Must state sim path (D-006) |
| 3 | Competitiveness | PR [#95](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/95) (**merged**): report, final TAFI register on master | **Submitted (merged); NOT reconciled here** | The final register on master differs from the draft rows below: COMP-002 is split into 002a/002b (002b: a *confirmed* K/P trade-model exploit, per Agent 3), COMP-001 downgraded, COMP-005 a confirmed UX gap, COMP-008/009 new. Real engine, headless. See the register section's warning |
| 4 | Gaps & Completeness | PR [#99](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/99) (**merged**, `9e2f541`): report, 11 TAFIs, evidence, harnesses | **Submitted (merged)** | GAP-008 fixed by #101 (`b4846f7`) and GAP-011 by #100 (`13e80ea`); both regression-tested in #106 (draft). Untested items are in its coverage file. |
| 5 | Special Features & Fun | **none on GitHub.** Owner reports a completed 5-season headless investigation with 13 TAFIs (Hooded Figure / special features), not yet pushed | Reported, **unverified — not registered** (D-014) | Will be registered only when its draft PR exists. No TAFI IDs are recorded from hearsay |
| 1b | Presentation, Audio & Immersion (an Agent 1 session) | draft PR [#104](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/104) (`agent-01-presentation/`), **corrected final head `be809b0`** (2026-11-09; `test` running when checked) | **Submitted (final)**; registered, PR **not merged** | 6 confirmed, 2 false positives + 1 sub-reading, 2 reclassified. Audio source-inspected and loudness-measured only. BAL only |
| 6a | Adversarial gameplay & multi-season QA (label to be confirmed) | draft PR [#106](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/106) (`agent-06-adversarial/`), head `73e5f97` | **Submitted (draft)**; ADV-001/002 **pending intake**, evidence cited in the register | 8 real-engine UI seasons; #100/#101 held. The roster's Agent 6 is Cybersecurity: confirm whether this is that role, and that a security review is still outstanding |
| 6–9 | Security, Economy, Multiplayer, Audio | none | Not started | Audio (9) remains not started: #104's audio is a pre-assessment |
| 10 | Coordinator | `docs/qa-longitudinal/` (#93 merged) | Active per session only; no continuous monitoring | |

Merged since the last status: #92 (`151fa73`), #93, #95, #96, #97, #98, #99, #100 (`13e80ea`), #101 (`b4846f7`), #102, #103 (`d0727ff`). Other open PRs observed (not QA evidence): #83 redesign prompts, and old infrastructure PRs #3, #6, #8, #9, #10.

## Briefs for development agents (drafted; owner to deliver — I cannot message sessions)
_Status 2026-11-09: the #92 selector fix and Group 08 briefs are **complete** (#92 `151fa73`, #103 `d0727ff`). The #74 Phase 1 and Agent 1 briefs below are still open._

**#92 development agent (D-010).** Scope, nothing more: (1) add a change-selector rule so every tracked `e2e-audit/**` file is covered (`.claude/skills/wentz-verify/select-checks.mjs`; the failing test is `test/verify-selector.test.ts` › "covers every source file tracked in this repository"; 20 files listed in the CI log, run 42396176539); (2) update the branch against current `master` (`d9af7c4` or later); (3) rerun CI and report the `test` result. Do not change `e2e-audit/` behaviour or anything under `ui-source/`, `src/`, `online/`, `server/`; do not merge. Also confirm that adding the Agent 1/3 documentation PRs' files (`.ts` harness code under `docs/`) will not trip the same rule.

**Group 08 development agent (D-009, D-017, D-018).** Dedicated agent. Use `GROUP-08-PLAN.md` together with `00-brief.md` and `08-cleanup.md` read from branch `docs/ui-redesign-prompts` (do not merge #83). Re-check paths/routes against current master.

**Issue #74 Phase 1 development agent (D-020).** Separate agent, separate PR. Brief: `ISSUE-74-PLAN.md` → "Phase 1 assignment". Phases 2–5 are not approved.

**Agent 1 (D-012).** Update #94 against current master, add the session header (sim path, SHA), continue the incomplete browser work (second season by hand, other team palettes, Gamecast, Hooded Figure, League Developments, online screens) and the follow-ups listed below. Treat 001/002/005/017 as owned by Group 08: re-verify after it merges instead of re-reporting.

## Integration issues for PR #104 (status at corrected head `be809b0`)
**Resolved in `be809b0`:** (1) the PR description now matches the final report; (2) the first-pass text is an appendix explicitly marked **SUPERSEDED**; (3) the count wording is fixed (6 confirmed; 2 false positives PA-006/PA-007 plus the PA-004b sub-reading; 4 harness readings discarded). No finding changed. Still to do: `test` was running on the head and #104 is a draft.

**Still open:**
4. **Three ID series for "Agent 1".** `UI-TAFI-001…022` (= `A1-001…022`), `A1-023…037` (#94) and `PA-001…010` (#104). IDs are preserved as issued. Rule going forward: new Agent 1 findings continue `A1-038+`, or any new prefix is registered here first.
5. **Folder/role overlap.** `agent-01-presentation/` sits beside #94's `agent-01-aesthetics/` and covers audio (Agent 9's remit; Agent 9 not started). Say which session owns follow-ups.
6. **Cross-session disagreements:** (a) UI-TAFI-012 priority (#94 Medium vs #104 P3); (b) horizontal overflow (#94 "0 on 23 routes" vs PA-002); (c) BAL hub contrast (A1-029 vs PA-004a). Each needs one confirming re-measure by the owning agent. (#94 predates master, so its side of (a)–(c) is also stale.)
7. **Unresolved detail:** **PA-002 has no identified root cause** (symptom only); PA-001 names only "Your assets (0)" although "Their assets (0)" was also flagged; **UI-TAFI-004's P1 is provisional and unverified** until a live-viewport case is demonstrated.
8. **Scope held:** #104 changes only `docs/qa-longitudinal/agent-01-presentation/`; it contains master's tip `d0727ff`, so no sync is needed.

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

# Closed-Alpha Readiness

Last updated: 2026-11-09 (after #104 and #108 merged) · **Verdict: NOT ASSESSABLE** (pre-baseline evidence from Agents 1, 2, 3, 4, 5 and an adversarial session; no baseline SHA declared; limitations per row)

## Baseline gate (must all be true before multi-season results count as definitive)

| Gate | State on 2026-11-09 |
|---|---|
| Redesign groups 01–07 merged | Done (#84–#91) |
| Group 08 cleanup | **Done:** [#103](https://github.com/johnathoneverssmith-commits/Wentz_2_SB/pull/103) merged as `d0727ff`. An independent review caught one contrast regression (the Fantasy Draft Summary "Methodology" disclosure), fixed at `95b13f9` before merge. **Outstanding, documented, not fixed:** BAL badge 2.34:1; floating Methodology/Unit Grades tabs (UI-TAFI-004); the shared dark card-header band (PA-001); a stray rule on stacked stat strips; dark shell and dialogs with the retained token-remap block; the root rule `decisions.css:19` (PA-003) |
| #92 audit harness | **Done:** merged as `151fa73` |
| Visual audit on the merged redesign | **Partial.** #104 (**merged**) ran the harness narrowed: BAL, 14 screens, 1440/390/320, fixture saves. The full matrix (10 franchises × 5 widths × conditions) has not been run |
| Playoff consistency and save integrity (GAP-011, GAP-008) | **Fixed** by #100 (`13e80ea`) and #101 (`b4846f7`). Real-engine regression evidence in #106 (draft, unmerged, local): 8 seasons, 0 bracket inconsistencies, saves 6.2 MB with no failed write. Limitations: ADV-001 (New solo dynasty wipes `#prev`), mid-write tab close and two-tab last-writer-wins not retested, growth beyond 5 seasons extrapolated, engine path only (Mock still inconsistent, #74), `humansOnly`/online untested |
| CI green on master | PR CI was green before each of these merges; the push CI for `d0727ff` has not been checked here |
| Designated baseline SHA | **None declared.** Candidate only: `d0727ff` (master tip, includes #92, #99–#101, #103). The owner declares it once the prerequisites below are met |

## Outstanding prerequisites for the definitive baseline (as of 2026-11-09)

| # | Prerequisite | Owner | State |
|---|---|---|---|
| P-1 | Fix #92 selector rule, update vs master, CI green (D-010) | #92 dev agent | **Done** (`151fa73`) |
| P-2 | Owner approval to merge #92 | owner | **Done** |
| P-3 | Group 08 built per `GROUP-08-PLAN.md` (D-009, D-018) | Group 08 dev agent | **Done** (#103) |
| P-4 | Owner approval to merge Group 08 | owner | **Done** |
| P-5 | Full #92 visual/accessibility audit on the post-Group-08 build; High/Critical findings fixed or accepted | #92 harness + Agent 1 | **Open.** Partial (#104). Candidates: UI-TAFI-004 (P1, provisional), PA-001 (P1), PA-003, PA-002 |
| P-6 | #74 and the baseline (D-021): the visual baseline does not wait for #74; definitive realism/competitiveness testing must use the real engine and state its sim path. #74 Phase 1 is approved as its own PR (D-020); Phases 2–5 are not. Its PR status was not checked here | — | **decided** |
| P-7 | Triage #37 (dead money on auto trim) and #38 (CPU releases same-window signings): fix before baseline or accept and document | owner / Agent 7 | open (not re-checked) |
| P-8 | Wave-1 passes: Agent 2/3/4/5 reports and #104 are **merged**; centrally registered: 1, 1b, 3, 4 (and STRAT from the #105 draft); **not yet registered: Agent 2 (REAL), Agent 5 (FUN), #106 (ADV)**; #94 is stale; #105/#106/#107 are drafts | agents | **Mostly done; integration open** |
| P-9 | Standard baseline test matrix agreed: seeds, teams (BAL plus ≥1 with and ≥1 without a stadium photo), `nfl` and `humansOnly`, talentImpact setting, ≥3-GM online league | coordinator proposes, owner approves | not drafted |
| P-10 | Candidate SHA with CI green on `master`; SHA recorded in this file | coordinator | blocked on P-5 and the owner |
| P-11 | #94: bring up to date or supersede before merging (D-012). Its statements on A1-001/002/005/017/023 are obsolete | Agent 1 / owner | open |
| P-12 | Documentation PRs pending owner approval: #105, #106, #107 (drafts) and this update. (#104 and #108 are merged.) Production drafts #109 and #110 are separate decisions and are not documentation | owner | open |

### Why #92 failed (historical: resolved, #92 merged as `151fa73`)
Job `test`, run 42396176539: 1 failed of 1,130 tests. `test/verify-selector.test.ts` › "a path nobody wrote a rule for is never silently ignored" › "covers every source file tracked in this repository" expects `[]` but receives 20 files, all under `e2e-audit/`. The repo's change-selector (`.claude/skills/wentz-verify/`) has no rule for the new `e2e-audit/` directory. The other 51 test files and both advisory Chromium jobs passed. Likely fix (for the #92 author; needs your approval): add a rule for `e2e-audit/**` to the selector. It is test tooling, not game code. #92 is also "behind" master and will need an update.

## Alpha criteria (draft, for owner approval)

- No open P0; no open P1 in save integrity, security, or progression.
- ≥5-season SP and a full-year ≥3-GM MP run completed **in the UI** with no stuck state, incl. save/reload at each turn-based stage. (Today: none.)
- Security review (Agent 6) complete with no unresolved High/Critical.
- Sim realism within agreed tolerances (engine 19/20 metrics within 10% per `CLAUDE.md`; multi-season drift unverified). Evidence must come from the real engine (D-006).
- Economy stable over 15+ seasons (re-verify `docs/AUDIT_multiseason_2026-10.md` on baseline).
- Standalone SP uses the real engine or clearly says it does not (issue #74). **This blocks trustworthy solo realism testing.**

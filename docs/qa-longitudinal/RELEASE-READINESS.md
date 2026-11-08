# Closed-Alpha Readiness

Last updated: 2026-11-07 · **Verdict: NOT ASSESSABLE** (partial pre-baseline evidence from Agents 1 and 3 only)

## Baseline gate (must all be true before multi-season results count as definitive)

| Gate | State on 2026-11-07 |
|---|---|
| Redesign groups 01–07 merged | Done (#84–#91); `master` code at `3abcfff`, docs-only merge `48fa26e` |
| Group 08 cleanup (dead CSS, one token layer, docs) | **Not done.** No Group 08 branch or PR found. The prompts live in open PR #83, which is not on `master`; owner has decided it comes first |
| PR #92 audit harness | **Open, required `test` check FAILING.** See below |
| Visual audit run on the merged redesign | Not done (#92 not merged). Agent 1's audit (PR #94) is a first, partial pass |
| CI green on master | Not verified |
| Designated baseline SHA | **None.** Freeze after Group 08 + #92 + a green audit, then record the SHA here |

## Outstanding prerequisites for the definitive baseline (as of 2026-11-07)

| # | Prerequisite | Owner | State |
|---|---|---|---|
| P-1 | Fix #92: selector rule for `e2e-audit/`, update vs master, CI green (D-010) | #92 dev agent | approved, **not done** |
| P-2 | Owner approval to merge #92 | owner | pending, after P-1 |
| P-3 | Group 08 built per `GROUP-08-PLAN.md`: pixel-diff report, contrast fixes for UI-TAFI-001/002/005/017, CI green (D-009, D-018) | dedicated Group 08 dev agent | planned, **not started**; reads prompts from branch `docs/ui-redesign-prompts`, #83 stays unmerged (D-017) |
| P-4 | Owner approval to merge Group 08 | owner | pending, after P-3 |
| P-5 | #92 visual/accessibility audit run on the post-Group-08 build; High/Critical findings fixed or accepted | #92 harness + Agent 1 | blocked on P-2, P-4 |
| P-6 | #74 and the baseline (D-021): the **visual** baseline does not wait for #74. **Definitive realism/competitiveness testing** must use the real engine (headless, UI + adapter, or online) and state its sim path. #74 Phase 1 is approved as its own PR (D-020); Phases 2–5 are not | — | **decided** |
| P-7 | Triage #37 (dead money on auto trim) and #38 (CPU releases same-window signings): fix before baseline or accept and document | owner / Agent 7 | open |
| P-8 | Wave-1 first passes complete: Agent 3 final, Agent 5 draft PR, Agent 1 update and re-run, Agents 2 and 4 first reports | agents | A1 submitted; A3 WIP; A5 unpushed; A2/A4 none |
| P-9 | Standard baseline test matrix agreed: seeds, teams (BAL plus ≥1 with and ≥1 without a stadium photo), `nfl` and `humansOnly`, talentImpact setting, ≥3-GM online league | coordinator proposes, owner approves | not drafted |
| P-10 | Candidate SHA with CI green on `master`; SHA recorded in this file | coordinator | not possible yet |
| P-11 | Merge #94 once updated and verified (findings are preserved either way) | owner | pending Agent 1 update |

### Why #92 fails (diagnosed from the CI log; nothing changed)
Job `test`, run 42396176539: 1 failed of 1,130 tests. `test/verify-selector.test.ts` › "a path nobody wrote a rule for is never silently ignored" › "covers every source file tracked in this repository" expects `[]` but receives 20 files, all under `e2e-audit/`. The repo's change-selector (`.claude/skills/wentz-verify/`) has no rule for the new `e2e-audit/` directory. The other 51 test files and both advisory Chromium jobs passed. Likely fix (for the #92 author; needs your approval): add a rule for `e2e-audit/**` to the selector. It is test tooling, not game code. #92 is also "behind" master and will need an update.

## Alpha criteria (draft, for owner approval)

- No open P0; no open P1 in save integrity, security, or progression.
- ≥5-season SP and a full-year ≥3-GM MP run completed **in the UI** with no stuck state, incl. save/reload at each turn-based stage. (Today: none.)
- Security review (Agent 6) complete with no unresolved High/Critical.
- Sim realism within agreed tolerances (engine 19/20 metrics within 10% per `CLAUDE.md`; multi-season drift unverified). Evidence must come from the real engine (D-006).
- Economy stable over 15+ seasons (re-verify `docs/AUDIT_multiseason_2026-10.md` on baseline).
- Standalone SP uses the real engine or clearly says it does not (issue #74). **This blocks trustworthy solo realism testing.**

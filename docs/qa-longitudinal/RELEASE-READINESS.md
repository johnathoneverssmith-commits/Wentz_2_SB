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

### Why #92 fails (diagnosed from the CI log; nothing changed)
Job `test`, run 42396176539: 1 failed of 1,130 tests. `test/verify-selector.test.ts` › "a path nobody wrote a rule for is never silently ignored" › "covers every source file tracked in this repository" expects `[]` but receives 20 files, all under `e2e-audit/`. The repo's change-selector (`.claude/skills/wentz-verify/`) has no rule for the new `e2e-audit/` directory. The other 51 test files and both advisory Chromium jobs passed. Likely fix (for the #92 author; needs your approval): add a rule for `e2e-audit/**` to the selector. It is test tooling, not game code. #92 is also "behind" master and will need an update.

## Alpha criteria (draft, for owner approval)

- No open P0; no open P1 in save integrity, security, or progression.
- ≥5-season SP and a full-year ≥3-GM MP run completed **in the UI** with no stuck state, incl. save/reload at each turn-based stage. (Today: none.)
- Security review (Agent 6) complete with no unresolved High/Critical.
- Sim realism within agreed tolerances (engine 19/20 metrics within 10% per `CLAUDE.md`; multi-season drift unverified). Evidence must come from the real engine (D-006).
- Economy stable over 15+ seasons (re-verify `docs/AUDIT_multiseason_2026-10.md` on baseline).
- Standalone SP uses the real engine or clearly says it does not (issue #74). **This blocks trustworthy solo realism testing.**

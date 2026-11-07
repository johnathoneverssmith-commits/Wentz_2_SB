# Closed-Alpha Readiness

Last updated: 2026-11-07 · **Verdict: NOT ASSESSABLE** (no longitudinal evidence yet)

## Baseline gate (must be true before multi-season results count as definitive)

| Gate | State on 2026-11-07 (GitHub evidence) |
|---|---|
| Redesign groups 01–07 merged | Done: #84 (01), #85/#91 (02a/02b), #86 (03), #90 (04), #89 (05), #88 (06), #87 (07), all merged; `master` = `3abcfff` |
| Group 08 cleanup (dead CSS, one token layer, docs) | **Not found merged** — verify; planned in PR #83 prompts (`docs/ui-redesign/`, PR #83 still open, not on master) |
| Visual & accessibility audit harness | PR #92 open, "behind" master, CI not run, no baseline screenshots |
| Visual audit actually run on merged redesign | Not done |
| CI green on master | Not verified by this program — check Actions before declaring a baseline |
| Designated baseline SHA | **None declared.** Proposal: freeze after 08 + #92 + a green audit, record the SHA here |

Until the gate passes, agent runs are valid as **pre-baseline** findings (record the SHA), and anything UI-visual may be stale after later merges.

## Alpha criteria (draft, for owner approval)

- No open P0; no open P1 in save integrity, security, or progression.
- ≥5-season SP and a full-year ≥3-GM MP run completed in UI with no stuck state, incl. save/reload at each turn-based stage.
- Security review (Agent 6) complete with no unresolved High/Critical.
- Sim realism within agreed tolerances (engine currently 19/20 metrics within 10% per `CLAUDE.md`; multi-season drift unverified).
- Economy stable over 15+ seasons (earlier audit: `docs/AUDIT_multiseason_2026-10.md`; re-verify on baseline).
- Standalone SP uses the real engine or clearly says it does not (issue #74).

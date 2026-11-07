# Decisions

Only the project owner's explicit approvals/rejections are recorded here.

| ID | Date | Decision | Conditions | Linked |
|---|---|---|---|---|
| D-001 | 2026-11-07 | **Approved:** merge framework PR #93 | required checks green; docs-only | #93 (merged as `48fa26e`) |
| D-002 | 2026-11-07 | **Approved sequencing:** finish Group 08 UI cleanup and resolve PR #92 *before* freezing the definitive baseline | #92 currently fails required `test` (see RELEASE-READINESS) | #83, #92 |
| D-003 | 2026-11-07 | **Approved:** Agents 1–5 continue exploratory testing now; results labelled *pre-baseline* and preserved | record the SHA on every run | — |
| D-004 | 2026-11-07 | **Noted:** Agent 3's work in progress is tracked as WIP; final results and TAFIs pending | — | #95 |
| D-005 | 2026-11-07 | **Approved:** `SUBMISSION-FORMAT.md` is the standard format for all agents | — | — |
| D-006 | 2026-11-07 | **Directive:** distinguish the real engine from the UI's mock fallback in every realism finding (issue #74) | now a required header field | #74 |
| D-007 | 2026-11-07 | **Standing:** no gameplay change and no merge of any other PR without explicit approval | — | — |

## Proposals awaiting a decision
See `PRIORITY-ROADMAP.md` → "Open decisions". Nothing about game behaviour is approved for implementation.

## Standing authorisations
- Coordinator may: inspect GitHub, organise/dedup, edit `docs/qa-longitudinal/`, draft follow-ups and recommendations.
- Requires approval each time: gameplay fixes, balance/rating changes, new features, schema/CI/dependency changes, merging (other than D-001), deploying, repository settings.

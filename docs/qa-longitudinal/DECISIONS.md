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
| D-008 | 2026-11-07 | **Approved:** merge #96 (checks green, docs-only) | — | #96 (merged `d9af7c4`) |
| D-009 | 2026-11-07 | **Approved:** organise Group 08 now; fold in Agent 1's confirmed visual inconsistencies it can reasonably absorb (esp. unreadable dark status bars); no unrelated features or redesign expansion | executed by a development agent, not the coordinator | `GROUP-08-PLAN.md` |
| D-010 | 2026-11-07 | **Approved:** narrow test-tooling fix to #92 — add change-selector coverage for `e2e-audit/`, update branch vs master, rerun CI; implemented by the #92 development agent | do **not** merge #92 without further approval | #92 |
| D-011 | 2026-11-07 | **Requirement:** standalone single-player must eventually use the real engine. Prepare a separate plan; do not implement. Document mock-fallback limits meanwhile | parity, game plans, play-by-play, reproducibility, backward compatibility | `ISSUE-74-PLAN.md`, #74 |
| D-012 | 2026-11-07 | **Approved:** preserve #94; merge once updated and verified. Agent 1 continues incomplete browser testing independently | not merged yet | #94 |
| D-013 | 2026-11-07 | **Noted:** #95 stays draft; Agent 3 finishes investigations before final review | — | #95 |
| D-014 | 2026-11-07 | **Noted:** Agent 5 reports 13 TAFIs from a five-season headless investigation. **Not pushed, so not registered.** Agent 5 will submit a draft PR | register only after the PR exists | — |
| D-015 | 2026-11-07 | **Process:** coordinator stays on shared docs, tracking and cross-agent issues; agents investigate, reproduce and propose before handing off | see README → Handoff standard | — |
| D-016 | 2026-11-07 | **Approved:** merge #97 once required CI is green and it remains docs-only | no other file types | #97 |
| D-017 | 2026-11-07 | **Decided:** do **not** merge #83 to give the Group 08 agent its prompts; the agent reads `docs/ui-redesign/08-cleanup.md` (and `00-brief.md`) directly from branch `docs/ui-redesign-prompts` | supersedes the #83 option in `GROUP-08-PLAN.md` | #83 |
| D-018 | 2026-11-07 | **Decided:** Group 08 is done by a dedicated development agent, not the coordinator; scope = the agreed cleanup plus the relevant Agent 1 findings only | per `GROUP-08-PLAN.md` | — |
| D-019 | 2026-11-07 | **Confirmed:** #92 development agent implements the selector fix, updates from master, gets green CI; no merge of #92 without further approval | restates D-010 | #92 |
| D-020 | 2026-11-07 | **Approved: Issue #74 Phase 1 only** — explicit, versioned player-pool input, byte-identical engine behaviour. Its own development assignment and its own PR. Phases 2–5 **not** approved | see `ISSUE-74-PLAN.md` → Phase 1 assignment | #74 |
| D-021 | 2026-11-07 | **Decided:** the *visual* baseline need not wait for #74. *Definitive* realism and competitiveness testing must use the real engine and state its simulation path | supersedes the open question P-6 | `RELEASE-READINESS.md` |
| D-022 | 2026-11-07 | **Reaffirmed:** agents complete their own investigations and TAFIs; coordinator = documentation, shared dependencies, final prioritisation | restates D-015 | — |
| D-007 | 2026-11-07 | **Standing:** no gameplay change and no merge of any other PR without explicit approval | — | — |

## Proposals awaiting a decision
See `PRIORITY-ROADMAP.md` → "Open decisions". Nothing about game behaviour is approved for implementation.

## Standing authorisations
- Coordinator may: inspect GitHub, organise/dedup, edit `docs/qa-longitudinal/`, draft follow-ups and recommendations.
- Requires approval each time: gameplay fixes, balance/rating changes, new features, schema/CI/dependency changes, merging (other than D-001), deploying, repository settings.

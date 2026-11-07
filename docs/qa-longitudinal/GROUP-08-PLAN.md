# Group 08 cleanup — organisation plan

Status 2026-11-07: **planned, not started.** No Group 08 branch or PR exists. Owner decision D-009: organise now; include Agent 1's *confirmed* visual inconsistencies that the cleanup can reasonably absorb; no unrelated features, no wider redesign. The coordinator does not implement; a Group 08 development agent does, after the owner starts it.

Source brief: `docs/ui-redesign/08-cleanup.md` and `00-brief.md`, which exist **only on branch `docs/ui-redesign-prompts`** (open PR #83; its base is old master `f7c9a85`). Owner decision D-017: **#83 is not merged**; the agent reads those files from that branch (`git show origin/docs/ui-redesign-prompts:docs/ui-redesign/08-cleanup.md`). Note the prompts were written against an older master, so the agent re-checks every path and route against current master before relying on it. Owner decision D-018: a dedicated development agent builds this, not the coordinator.

## Scope: the original nine tasks (unchanged)
Dead CSS removal · pixel-diff proof · one token layer · one page shell (`GdPage`) · dev screens (`ScreenGallery`, `VisualLab`) · delete unused components/assets · keep e2e selectors resolving · CLAUDE.md "UI design system" section · retire the prompts.

## Amendment: Agent 1 findings folded in
The original brief demands *pixel-identical* output "except where this file says otherwise". This amendment is that exception, and only for these:

| Agent 1 TAFI | Fits because | Intended change |
|---|---|---|
| UI-TAFI-001 dark stat strips unreadable (`/draft`, `/free-agency-board`, `/free-agency`, `/trade-deadline`; `DraftRoom`, `FreeAgencyBoardTurns`, `TradeDeadlineRoom`) | Task 3 says a surviving dark page must be reported; Task 1 deletes the dark variant's CSS | Use the light `gd-stats` strip; keep one accent cell in team colour; values meet 4.5:1 contrast |
| UI-TAFI-002 Fantasy Draft Summary on old dark design | Task 4 (one page shell) | Convert to `GdPage` + masthead. **Layout/grade logic unchanged** (no new "stamped grade" animation — that is an enhancement, not cleanup) |
| UI-TAFI-005 default browser-blue link in setup notice | Task 3 (token layer) | Use the link token |
| UI-TAFI-017 primary button colour inconsistent | Task 3 (token layer) | One primary-button token |
| UI-TAFI-010 Season Complete "theme breaks" | Only if it is a leftover dark/old-theme page | **Conditional:** include the theme fix only; moving the champion higher is a layout change → out of scope unless the owner says so. Ask Agent 1 to confirm which it is |

**Explicitly out of scope** (stay in the TAFI register for later, separate PRs): 003 clipped on-the-clock overlay (a behaviour/positioning fix, not leftover CSS), 004, 006–009, 011–016, 018, 019, 020, 021, 022. Mention: 018 is a one-character text fix and 012/013 are the redesign's own rules; both are cheap but unrelated, so not bundled.

## Hard rules for the Group 08 agent
- Every route screenshot at 1440 / 390 / 320, reduced motion, before and after, pixel-diffed. Differences must be zero **or** one of the table rows above, each shown before/after.
- Prefer the PR #92 capture matrix once #92 is fixed (prerequisite P-2) rather than building a second one.
- Report CSS size before/after and every rule kept although it looked dead.
- No game-logic, engine, online, schema, dependency or CI change. `howItWorks.ts` stays true.
- Small commits per CSS file. Not merged without owner approval.

## Dependencies and order
1. #92 fixed and green (so the pixel-diff/accessibility harness is available) — owner decision D-010.
2. The agent reads the prompts from branch `docs/ui-redesign-prompts` (D-017); #83 stays unmerged.
3. Group 08 PR → owner approval → merge.
4. Agent 1 re-verifies 001/002/005/017 on the result; #92 harness run; baseline can then be frozen.

## Acceptance (adds to `00-brief.md` §8)
- Contrast probe passes on the four routes in UI-TAFI-001 and on `/fantasy-draft-summary`.
- e2e: all existing specs resolve (`npm run e2e`, and CI's advisory Chromium job).
- `npm --prefix ui-source run typecheck` (`tsc -b`) and UI tests green.

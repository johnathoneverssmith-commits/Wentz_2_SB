# Longitudinal QA Program (TAFI)

Coordination hub for the multi-season testing initiative that gets Wentz 2 SB ready for closed alpha.
Nine specialist agents play and probe the game; **Agent 10 (coordinator)** collects, de-duplicates,
prioritises and tracks what they find. This directory is documentation only: nothing here changes game code.

**TAFI** = a single tracked finding (bug, concern, or improvement) with evidence and a status.

## Files

| File | Purpose |
|---|---|
| `MASTER-TAFI-REGISTER.md` | One-line index of every TAFI, sorted by priority |
| `AGENT-STATUS.md` | Who is assigned what, and what evidence has actually arrived |
| `COVERAGE-MATRIX.md` | What has genuinely been tested, and how |
| `PRIORITY-ROADMAP.md` | Ranked improvement batches (Phases A–E) |
| `DECISIONS.md` | Owner-approved and rejected proposals |
| `RELEASE-READINESS.md` | Closed-alpha go/no-go assessment |
| `SUBMISSION-FORMAT.md` | **The template every agent uses to report** |
| `TEMPLATE-TAFI.md` | Blank full TAFI record (the coordinator expands submissions into this) |
| `agents/` | One folder or file per agent: `agent-NN-<name>/report-YYYY-MM-DD.md` |
| `tafis/` | One file per confirmed TAFI: `<AGENT-ID>.md` (agent's original ID preserved) |

## Rules

1. **Evidence only.** No invented repro steps, results or coverage. Unknown stays "unknown".
2. **Baseline.** The definitive longitudinal baseline is an approved `master` build *after* the UI redesign work is merged and verified (see `RELEASE-READINESS.md` → Baseline gate). Findings from earlier builds are recorded with their SHA and flagged "pre-baseline".
3. **Agents write only inside their own `agents/` folder.** Only the coordinator edits the register, roadmap, coverage and `tafis/`. This avoids merge collisions.
4. **No gameplay, balance, schema or CI change without owner approval**, recorded in `DECISIONS.md`.
5. **Passing automated tests are not a playthrough.** Coverage is credited only by the categories in `COVERAGE-MATRIX.md`.
6. Dedup: duplicates are cross-linked, never deleted. One root cause may carry several agents' observations.

## Priority levels

| P | Meaning | Examples | Target |
|---|---|---|---|
| P0 | Critical blocker | corrupt/unrecoverable save, stuck league, unauthorised access, multiplayer info leak, broken progression | before anything else |
| P1 | Major gameplay problem | sim inconsistency, competitive exploit, dead core mechanic, cap/roster bug, repeatedly failing MP action, severe usability | before closed alpha |
| P2 | High-value improvement | strategic feedback, stats views, stadium imagery, draft announcements, atmosphere | scheduled by impact ÷ effort |
| P3 | Polish / future | minor animation, decoration, large speculative features | separate backlog |

Rule of thumb: aesthetic volume must never outrank a correctness or security defect. Security and save-integrity issues are P0/P1 regardless of how many cosmetic items exist.

## Triage workflow

`New → Triaged → Reproduced → Proposed → Approved → In Progress → Fixed → Verified → Closed`

1. Agent submits (see `SUBMISSION-FORMAT.md`).
2. Coordinator checks grounding (played in UI / controlled sim / test-reproduced / code-inspected / idea only), dedups, assigns severity + priority, writes `tafis/<ID>.md`, updates the register.
3. Weak submissions get a targeted follow-up request (missing repro, seed, data).
4. Solutions are evaluated: root cause? side effects? simpler option? SP and MP? worth the effort?
5. Owner approves in `DECISIONS.md`; implementation happens in separate, reviewable PRs.
6. "Fixed" is only moved to "Verified" after checking the merged PR on GitHub and re-running the TAFI's regression check.

## Existing material this program builds on (not duplicated)

- `docs/AUDIT_multiseason_2026-10.md` – earlier headless multi-season audit
- `docs/DEPLOYED_MULTIPLAYER_PLAYTEST_FINDINGS.md`, `DEPLOYED_FRANCHISE_AUDIT_HANDOFF.md` – human/AI playtests of the deployed site (repo root)
- `docs/MULTIPLAYER_RELIABILITY*.md`, `docs/REDESIGN_CHANGE_LOG.md`, `docs/decisions.md`
- `e2e/` (Playwright journeys), PR #92 `e2e-audit/` (visual/accessibility harness, open)
- Open GitHub issues #37, #38, #44, #74 (see register "Pre-existing known issues")

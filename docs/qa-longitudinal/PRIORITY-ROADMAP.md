# Priority Roadmap

Last updated: 2026-11-07. **Provisional.** Evidence so far: Agent 1 (22 UI TAFIs) and Agent 3 (6, WIP) only, all pre-baseline. No batch is ranked or approved. Phases are initial categories; they will be re-cut from actual evidence. No item here is approved for implementation.

## Batch template (one per independently reviewable PR)

- Batch ID / title
- TAFIs · Problem solved · Recommended approach · Complexity (S/M/L)
- Dependencies · Risks · Acceptance criteria · Regression tests · Expected player benefit
- Owner approval: pending / approved (link to `DECISIONS.md`)

## Phases

| Phase | Scope | Entry condition | Batches |
|---|---|---|---|
| A. Critical correctness & security | save integrity, authz/MP leaks, progression blockers, exploits | any P0/P1 security or integrity TAFI | _none yet_ |
| B. Simulation & competitive balance | realism, strategy impact, development, economy | Agents 2/3/7 reports | _none yet_ |
| C. Gameplay completeness | missing mechanics, engine↔UI parity, MP function | Agents 4/8 reports | _none yet_ |
| D. Experience | UI polish, special features, transitions, audio | Agents 1/5/9 reports | _none yet_ |
| E. Closed-alpha verification | regression, multi-season runs, security re-check | A–D done | _none yet_ |

## Cross-agent investigations to plan once evidence exists

- Realism × Competitiveness: rating-gap vs win-probability (QB upgrade value). Baseline already exists: `analysis/30_win_probability.ts`, `analysis/38_unit_links.ts`.
- Economy × Realism: rating inflation vs salary demands across 10+ seasons.
- Gaps × Security: UI-hidden actions still reachable via API (`online/src`).
- Special features × MP: Hooded Figure effect on human-GM balance (it targets losing human teams only).
- Aesthetics × Audio: draft/ceremony moments as one coordinated design.

## Audio programme (Agent 9) — evaluation criteria

Treat as one coordinated experience: announcer personalities, voiced draft picks, dynamic crowd, ducking, transition cues, settings.
Evaluate each proposal on: licensing (original or properly licensed only; **no cloning of real announcers without authorisation**), bundle size/performance on phones, autoplay/user-gesture limits, accessibility (captions, per-channel volume, mute, reduced-sensory mode), dev cost, and whether it reinforces an existing mechanic (e.g. pick reveal, comeback moments) rather than adding noise.

## Open decisions (need the owner)

| ID | Question | Recommendation |
|---|---|---|
| O-1 | Are Agent 1's dark-strip / token findings (UI-TAFI-001, 002, 005, 017) part of Group 08, or a separate PR? | Check Group 08 scope first; do not duplicate. 001 is small and affects the draft/FA/deadline turn readout, so it should ship before alpha. |
| O-2 | Who fixes #92's failing test (selector rule for `e2e-audit/`)? | The #92 author; small, tooling-only. |
| O-3 | Issue #74: should solo play ship with the real engine, or an explicit "simulated (mock)" label? | Decide before Agent 2/4 baseline runs; it decides whether solo realism can be tested at all. |
| O-4 | Review/merge of #94 and #95 (documentation PRs from Agents 1 and 3)? | #94 once checks are green (docs only). Hold #95 until Agent 3 finalises and its harness code is reviewed. |

## Draft batches (nothing approved)

- **B-A1 Turn-readout contrast** (UI-TAFI-001, maybe 002/003): Small–Medium. Acceptance: contrast probe passes on the four routes; e2e specs unchanged. Depends on Group 08.
- **B-B1 Pricing validation** (COMP-001/002 + Agent 7): investigation first, no constants changed. Acceptance: a budget-matched QB build and a sign-and-flip simulation produce numbers. Depends on confirming online uses the same tables.
- **B-C1 Depth-chart guard** (COMP-005): Small, conditional on Agent 4 confirming the UI lacks one.

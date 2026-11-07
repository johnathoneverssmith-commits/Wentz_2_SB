# Priority Roadmap

Last updated: 2026-11-07. **Skeleton only — no findings yet, so no batches are ranked.** Phases are initial categories; they will be re-cut from actual evidence. No item here is approved for implementation.

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

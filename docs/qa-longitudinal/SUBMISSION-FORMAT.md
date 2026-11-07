# Agent submission format

Copy this block into `docs/qa-longitudinal/agents/agent-NN-<name>/report-YYYY-MM-DD.md`.
One report file per session; one `### Finding` block per issue. Keep your own ID series
(`A1-001`, `A2-001`, … = agent number + sequence). Never renumber after submitting.

```markdown
# Agent NN – <specialty> – Report YYYY-MM-DD

## Session header
- Build: commit SHA <full SHA>, branch, deployed URL or local (command used)
- Mode: single-player | multiplayer (GM count) | headless sim
- League: format (nfl/humansOnly), team(s), difficulty, talentImpact, seed(s)
- Seasons covered: start year → end year (list the seasons actually completed)
- Stages completed in the UI (list) / simulated headless (list) / only inspected (list)
- Approx. browser interactions: <number or "unknown">
- Save/reload scenarios exercised: <list or none>
- Blockers hit: <list or none>
- Artifacts: <paths to screenshots, saves, logs, scripts>

## Summary (≤5 lines for the project owner, plain language)

## Findings

### Finding A#-### — <specific title>
- Class: bug | realism | balance | UX | security | enhancement
- Suggested severity: Critical | High | Medium | Low
- Mode: SP | MP | both
- Screen/system: <route, stage, module/file if known>
- Grounding: played-in-UI | controlled-sim | test-reproduced | code-inspected | idea-only
- Observed: <what happened, with numbers>
- Expected: <what should happen and why (real-NFL reference if realism)>
- Repro: <numbered steps; "reproducibility: always/sometimes/once/unknown">
- Evidence: <file paths, log excerpts, stat tables with sample size>
- Root cause: confirmed | suspected | unknown — <detail>
- Proposed solution: <specific>
- Alternatives: <other options>
- Difficulty: S | M | L
- Expected benefit: <player impact>
- Related: <other TAFIs / agents / PRs>
- Regression check: <how a fix would be verified>
- Uncertainty: <what you did NOT verify>

## Positive observations (things that work well; protects against accidental regressions)

## Suggested cross-agent follow-ups
```

Rules: no fabricated evidence; mark gaps "unknown". Do not edit files outside your folder.
Security agent (6): do **not** put working exploit payloads or real credentials in the repo; describe impact and
repro at a level a maintainer can act on, and flag Critical items to the coordinator directly.

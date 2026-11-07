# FUN-TAFI register (Agent 5) — v2

Full finding blocks (format per `SUBMISSION-FORMAT.md`) are in `../agents/agent-05-special-features/report-2026-11-07.md`. IDs are shared: FUN-TAFI-00N = A5-00N. Labels: **DEFECT** (reproduced misbehaviour), **DESIGN** (works as coded, questionable), **ENHANCE** (new idea), **GAP** (not tested).

| ID | Title | Label | Severity | Grounding |
|---|---|---|---|---|
| 001 | One-human league: the figure's streak counts every season, including a title year | DEFECT (suspected; spec unavailable) | High | played-in-UI (real engine) + controlled |
| 002 | Offer screen says "I can help" but never states the range of results | DESIGN | Low | played-in-UI |
| 003 | Low-tier outcomes rarely touch the payer (1-game absences, K/P) | DESIGN | Medium | controlled-sim |
| 004 | Position-group boost can land on K or P | DESIGN | Low | controlled-sim |
| 005 | Convex value: $10M is always tier 4; "pay the max" is dominant | DESIGN | Medium | controlled-sim |
| 006 | No season-long ledger or retrospective for a bargain | ENHANCE | Medium | played-in-UI + code |
| 007 | The reveal never tells the payer which news is theirs | DESIGN/UX | Medium | played-in-UI |
| 008 | Repetition: a poor team sees the figure 8.6×/10 seasons, 92% back to back | DESIGN | Medium | controlled-sim |
| 009 | "On the clock" overlay is identical for every pick | UX | Low | played-in-UI (static screens only) |
| 010 | Game-moment stakes labelling | GAP | — | code-inspected; not watched |
| 011 | Retirements not scaled by franchise history | ENHANCE | Medium | code-inspected |
| 012 | No persistent franchise storyline / records / rivalries | ENHANCE | Medium | code-inspected |
| 013 | Live multiplayer special-event testing not done | GAP | Medium | n/a |
| 014 | Redacted league still carries `hoodedFigure.unavailable` before the reveal | DEFECT (information leak) | Medium | test-reproduced |
| 015 | Absence filter ignores phase: a "1-game" absence also sits the player in preseason week 1 | DEFECT (low impact) | Low | test-reproduced |
| 016 | `resolveHoodedFigureEncounter` has no idempotence guard | DEFECT (hardening) | Low | test-reproduced |
| 017 | Engine adapter log shows "non-finite M04/M09 shift … ignoring it" | cross-agent note | Low | log-observed |
| 018 | Tier-4 negative = a CPU team loses 53 players for the season | DESIGN | Medium–High | controlled-sim |

Changes from v1: 002 downgraded (UI is honest that it's secret); 005 re-scoped (the clamp is deliberate; the finding is convexity); 007 merged with the old 007/017 idea (seen now); 009 revised after seeing the overlay; 013 split into 014–016 plus the remaining gap; 018 and 017 added.

# Agent 4 — Gaps & Completeness

Start with **`report-2026-11-07.md`** (SUBMISSION-FORMAT, one block per finding, TAFI-GAP-001…011).

| File | What |
|---|---|
| `report-2026-11-07.md` | Session header, summary, every finding, positives, follow-ups |
| `save-integrity-report.md` | GAP-008: storage mechanism, limit, growth over 10 seasons, failure reproduction, solutions |
| `simulation-fallback-report.md` | GAP-001/002/003/004/005 and exactly what Issue #74 would and would not fix |
| `rules-and-scoring-integrity.md` | Scoring/rules checks, real engine vs Mock |
| `playtest-and-multiplayer-coverage.md` | What was played in the UI, what was a fixture, what was headless, what is untested; live multiplayer |
| `engine-ui-matrix-and-inventory.md` | Feature inventory + engine-to-UI capability map |
| `roadmap.md` | Proposed order of work and tests still owed |
| `evidence/` | Logs, size series, repro transcript, screenshots, JSON |
| `harness/` | Playwright/Node scripts and vitest harnesses (`*.test.ts.txt` are kept as text so they are never run by CI; copy into `ui-source/src/state/_qa_*.test.ts` to use, never commit there) |

No production code, pinned data, simulation rule or permission was changed. Local results are not CI.

# Adversarial gameplay, engine integrity & multi-season QA — QA PR

Baseline: `master` @ `d0727ff` (Group 08, PR #103; includes #99, #100, #101). Date: 2026-11-08. No production code was changed.

| File | What |
|---|---|
| [`REPORT.md`](REPORT.md) | Session header (SUBMISSION-FORMAT), multi-season playtest report, what was and was not played in the UI |
| [`COVERAGE-MATRIX.md`](COVERAGE-MATRIX.md) | Every area asked for: how it was exercised, grounding, result |
| [`TAFI-INVENTORY.md`](TAFI-INVENTORY.md) | New confirmed defects (`ADV-nnn`), re-verified existing TAFIs, suspected items, untested hypotheses |
| [`RISK-PR100-PR101.md`](RISK-PR100-PR101.md) | Updated risk assessment of #100 (playoff consistency) and #101 (IndexedDB saves) |
| [`ROADMAP.md`](ROADMAP.md) | Prioritised remediation roadmap |
| [`scripts/`](scripts/) | Reproduction + checking scripts (real-Chromium driver, invariant checkers, attack scripts) |
| [`evidence/`](evidence/) | Driver logs and checker outputs from the runs quoted in the report (no save files committed; they are 4–6 MB each and regenerate from the driver) |

IDs: `ADV-nnn` (this report). Agent numbers in this folder name do not imply a position in the `A#-###` series; the coordinator may alias.

## Headline

* **8 full seasons were played through the real UI against the real engine adapter** (two leagues, 5 + 3), with browser-restart resumes in between. The engine path produced **zero** invariant failures across 16 saved states.
* **2 new confirmed defects** (both Medium/Low), **0 data-corruption or progression-blocking defects** found in the real-engine path.
* Most serious: **ADV-001** — "New solo dynasty" destroys the live save *and* the `#prev` recovery copy within 300 ms, so the durable-save safety net from #101 does not cover the single most destructive action in the app.
* Existing TAFIs GAP-001/003/004/005/006/007 were **re-verified** (not re-reported as new); the #74 re-test adds a stronger, quantified reproduction (a real-engine dynasty silently continued on Mock for a full season).

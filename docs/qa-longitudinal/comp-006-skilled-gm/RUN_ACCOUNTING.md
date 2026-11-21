# COMP-006 run accounting (every league-run attempted for the reported data)

> **Current data = the regeneration in section 6.** Sections 1-5 describe the earlier batches (policy v1/v2); those skilled, control and ablation runs are **superseded and not used** by the numbers in `REPORT.md`. Only the 20 idle runs from batch 3 are carried into the final set.

A "run" = one (arm, seed, talent) league played for the stated number of seasons. Seeds 9601-9610; talents 1 and 1.5. Sources: the orchestrator logs
(`run.sh` output) and the per-run JSON. The earlier PR update said "the 20 control runs are complete and unchanged" and the first version of REPORT.md said
"the 24 completed runs from that policy were discarded". **The second sentence was wrong**: of the 24 runs that completed in the first batch, 20 were control runs
(reused) and only 4 were skilled runs (discarded).

## Batch 1 (40 attempted: 10 seeds x 2 talents x {skilled, control}, 10 seasons)
| Result | Runs | Disposition |
|---|---|---|
| Completed, control | 20 (all seeds, both talents) | **Reused** in the final data. Control never executes any skilled-policy code. Spot check: control s9601 and s9605 at 1.5 re-run with the final code reproduce the stored rows byte for byte (`verify`, below). |
| Completed, skilled (first policy) | 4: `s9601_t1`, `s9601_t1.5`, `s9602_t1`, `s9607_t1.5` | **Discarded** (first policy version, no cap discipline). Files kept only in the local scratch directory, not used anywhere. |
| Aborted, skilled | 16: s9602 t1.5; s9603 t1, t1.5; s9604 t1, t1.5; s9605 t1, t1.5; s9606 t1, t1.5; s9607 t1; s9608 t1, t1.5; s9609 t1, t1.5; s9610 t1, t1.5 | **Discarded, no data.** 15 stopped on "roster not legal ... over the salary cap" at a free-agency summary, 1 on "No deal can pay more than $95.7M a year". |

## Policy revision (before batch 2)
Added to the skilled policy: value-aware cap cuts at the summaries (`capCuts`), a cap-feasibility check on trades, and a max-contract clamp on free-agency bids.

## Batch 2 (all 20 skilled runs re-attempted with the revised policy)
19 completed and are in the final data. 1 aborted: `skilled s9608 t1.5` (DAL, "$2.0M over the salary cap" at the offseason free-agency summary, after cuts and the staff fix).

## Driver revision (before batch 3)
Added a last-resort **restructure fallback** to the reconciliation step (restructure the six largest cap hits, then record `cap.stuckReconcile` and continue instead of aborting). It executes only after cuts and the staff fix have failed to make the roster legal.

## Batch 3
| Run | Disposition |
|---|---|
| `skilled s9608 t1.5` re-run | Completed; **in the final data**. This is the only run in which the fallback executed (see REPORT section 4). |
| idle, 20 runs (10 seeds x 2 talents, 10 seasons) | All completed first time; in the final data. |
| ablations, 36 runs (6 seeds 9601-9606 x talent 1.5 x 6 module sets, 8 seasons) | All completed first time; in the final data. |

## Final data set: 96 league-runs
control 20 (batch 1) + skilled 20 (19 from batch 2, 1 from batch 3) + idle 20 + ablations 36. Separate, not pooled: a 12-run pilot (seeds 9611-9613, 3 seasons, control + skilled at both talents; produced with the first policy version).
Totals attempted in the study: 40 + 20 + 1 + 20 + 36 = 117 league-runs for the main study, plus the 12-run pilot and a few unreported smoke runs (seeds 101-103, 2-3 seasons) used only to debug the harness. Not in the final data: 4 discarded + 16 aborted + 1 aborted = 21.

## Were runs produced under older driver code still valid?
The 19 batch-2 skilled runs and the 20 controls were produced before the restructure fallback and `--max-season` edits. The edits touch only a path that had aborted. Check: skilled and control, seeds 9601 and 9605, talent 1.5, 10 seasons, re-run with the final committed code (the PR head) into a fresh directory: rows, seat ledgers and league fingerprints are **identical** for all four (`verify`).

## 6. Regeneration after the review fixes (current data)
Codex review of the PR found four defects: the policy read a hidden field (`potential`, via `focusGroupValue`), the draft counters leaked across seasons, control seats were not censored when a CPU GM was replaced, and the section 3c denominators were unmatched. Fixes: the driver now runs every policy call against a client-equivalent view (no `potential`, no prospect `trueOverall`), the draft tracking resets per season, each season row records the seat's GM (`seatGm`) in every arm and control `censoredFrom` is computed from the first CPU GM change, and `analyze.py` censors a seat-season when the GM changed in either arm.

| Set | Runs | Disposition |
|---|---|---|
| control, 10 seeds x 2 talents x 10 seasons | 20 | **Re-run** with GM tracking. Season rows for seasons 1-3 are identical to the old controls in all 20 files (`seatGm` removed from the comparison); later seasons only gain the censoring field. Old files superseded. |
| skilled, 10 seeds x 2 talents x 10 seasons | 20 | **Re-run** with the redacted view and fixed counters. All completed first time, 0 failed. |
| ablations, 6 seeds x talent 1.5 x 6 module sets x 8 seasons | 36 | **Re-run** (they use the same policy code). All completed. |
| idle, 10 seeds x 2 talents x 10 seasons | 20 | **Reused** from batch 3 (idle executes no policy code). |
| Old skilled/control/ablation runs | 20 + 20 + 36 (+ the earlier 21 discarded) | Superseded; kept only in local scratch. |

76 runs executed in this round (6,210 s wall on 4 workers). Every run file asserts the talent scale it saw (1.0 or 1.5 only) and zero Mock game simulations. The restructure fallback ran in two skilled 1.0 runs (seed 9602 PIT x1, seed 9604 CAR x2); `cap.stuckReconcile` is 0 everywhere, so no run ended with an illegal roster.

Total executed over the whole study: 117 (batches 1-3) + 76 (regeneration) = 193 league-runs, plus the 12-run pilot and unreported smoke runs.

## 7. Policy / code version of every arm in the final data
Harness commits: `6076c5b` (first harness), `b8ca703` (review round 1), `c32c176` (moved under `docs/`, same logic), `31d6401` (review fixes).
| Arm | Runs | Version | Notes |
|---|---|---|---|
| skilled | 20 | `31d6401` policy: cap discipline + restructure fallback + client-equivalent redacted view + per-season draft counters | Policy v3. Regenerated. |
| skilled ablations | 36 | `31d6401`, module subsets | Regenerated with v3. |
| control | 20 | `31d6401` driver (adds per-season GM tracking); runs no policy code | Regenerated; seasons 1-3 identical to the earlier controls. |
| idle | 20 | (superseded by section 8: regenerated) Produced in batch 3 with the harness at `b8ca703`-era driver (before the redaction, counters and GM tracking); no `seatGm` field | **Reused.** Idle calls the production autopilot path only and no skilled policy code. Check: `idle seed 9601, talent 1.5, 10 seasons` re-run with the `31d6401` code gives an identical fingerprint, identical season rows (ignoring the new `seatGm` field) and identical ledgers. Only that one run was re-checked; the other 19 are reused on that evidence and on the identical-control result. |
| pilot (separate) | 12 | `6076c5b` policy v1 | Not pooled. |
Superseded and unused: policy v1 (first, no cap discipline) and policy v2 (`b8ca703`, cap discipline, reads `potential`) skilled/ablation runs and the old controls.

## 8. Final regeneration for the snapshot-timing fix (current data)
Codex found that "start of season" strength was read after the opening nine-week block (which applies injuries; strength excludes injured players). `driver.ts` now captures it at the last pre-season stage. Because that changes every run's output files, **all 96 runs were regenerated** (control 20, skilled 20, idle 20, ablations 36); the 20 idle runs from section 6 are no longer reused. The job was killed by worker restarts several times and resumed with the resumable orchestrator; runs finish atomically (JSON is written once at the end), so a killed run is simply redone.

Accounting of the progress count: the first orchestrator call covers 60 runs (control, skilled, idle); the 36 ablations are six later calls. "4 done, 56 remaining" referred to the first call only; with the ablations that was 92 of 96 remaining.

Driver version of every retained run: `harness/driver.ts` sha256 `23a9076f7f6925fc7790b29eeb550f1bb5ba916fbf8c1dbd8b8a4282d6043ed2`, unchanged from before the first run started to after the last finished. All 96 files have a modification time later than the driver file, parse, and report no failure. Policy version for every skilled/ablation run: `skilled.ts` as in the commit that carries this table (policy v3); control and idle execute no skilled code.
Equivalence check against the previous (superseded) data set: wins, losses, ties, points, playoff results, champions and end-of-season strength identical in all 96 runs; only start-of-season strength differs.

# COMP-006 run accounting (every league-run attempted for the reported data)

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

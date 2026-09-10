# M23 — Full-simulation league validation (Phase E)

Generated 2026-09-10. 150 simulated games, rating modifiers = 0 (§22).

> No current game player ratings were used — this is the average-rating baseline check.

| metric | empirical 2023–25 | sim | rel err | within 10% |
| --- | ---: | ---: | ---: | :---: |
| dropback_rate | 0.5984 | 0.5888 | -1.6% | ✅ |
| completion_pct | 0.647 | 0.6486 | +0.2% | ✅ |
| yards_per_attempt | 7.057 | 7.1648 | +1.5% | ✅ |
| air_yards_per_attempt | 7.7112 | 7.7731 | +0.8% | ✅ |
| int_rate_per_att | 0.0223 | 0.0228 | +2.2% | ✅ |
| sack_rate_per_dropback | 0.0663 | 0.0663 | +0.0% | ✅ |
| yards_per_carry | 4.2761 | 4.4669 | +4.5% | ✅ |
| explosive_rush_rate | 0.0438 | 0.0428 | -2.4% | ✅ |
| explosive_pass_rate | 0.0894 | 0.0959 | +7.2% | ✅ |
| fg_make_pct | 0.8517 | 0.8602 | +1.0% | ✅ |
| rz_td_rate | 0.5599 | 0.5198 | -7.2% | ✅ |
| plays_per_team_game | 61.9951 | 66.55 | +7.3% | ✅ |
| drives_per_team_game | 10.7433 | 10.4533 | -2.7% | ✅ |
| points_per_team_game | 22.5643 | 19.7833 | -12.3% | ❌ |
| points_sd | 9.9268 | 8.2678 | -16.7% | ❌ |
| pass_attempts_per_team_game | 32.8192 | 30.4967 | -7.1% | ✅ |
| rush_attempts_per_team_game | 23.9902 | 23.9933 | +0.0% | ✅ |
| penalties_per_team_game | 6.1618 | 4.51 | -26.8% | ❌ |
| penalty_yards_per_team_game | 50.0245 | 38.447 | -23.1% | ❌ |
| dpi_per_team_game | 0.5239 | 0.3967 | -24.3% | ❌ |

**15/20 metrics within 10%** (15/17 of the core football metrics; the three penalty-volume metrics are the Model 25 V1.5 check).

## engine V1 gaps (tracked for the next Phase E iteration)

- **penalties/team-game & penalty yд run ~15–20% low.** M25a/M25b are per-raw-stream-row hazards; the engine's scrimmage-snap population is smaller, and the deterministic accept/decline trims more. `PENALTY_HAZARD_SCALE` is left at 1.0 on purpose — scaling it to hit the empirical count pushes points from −10% to −16%, because the physical-outcome resolvers are fit penalty-FREE (§6.2) and this engine's drive model over-punishes offensive fouls. Reconciling the two needs gained-conditioned hazards (V1.6).
- **points/team-game ~12% low — V1.6 (`drive_baseline.json`, `lib_py/drives.py`).** Per-drive instrumentation + the shared drive-table comparison fixed two punt bugs (touchback put the receiver at the opponent's 1; a return moved them *backward*), taking drive start field position to within ~1 yд of empirical and points/drive from −6.8% to **−4.2%** (1.86 v 1.94). A per-play trace then showed the residual is **not** per-play football: on drives starting ≥ own 30, the engine's down-state mix, play-call, run yardage, per-state conversion and turnover rate all match empirical. The FD/drive deficit (1.70 v 1.91) is *exactly* the ~0.17 penalty first downs/drive the engine doesn't produce — penalties run −25% volume. **Next: re-test `PENALTY_HAZARD_SCALE`** now that field position is fixed (the old −16%-points result predates the punt fixes). Separately: −3% fewer drives (M24 clock) and ~1pp too few return TDs. See `docs/v16_points_gap_plan.md`. No 2-point tries (EV-neutral).
- **points_sd ~15–17% low** — expected: the average-rating engine runs two identical teams, so scores regress to the mean (no blowouts/shutouts). Variance widens once rating modifiers are on (real team-quality spread) — that is the §23 rating-layer check.
- `qb_hit` and `pass_location` sampled from marginals (Models 06/08 not wired in);
- kickoff / XP / sack-yards are hard-coded empiricals (Models 22/23 not fitted);
- individual-player attribution omitted (team aggregates only) — the §24 stat-integrity tests need it and come with the shippable engine.

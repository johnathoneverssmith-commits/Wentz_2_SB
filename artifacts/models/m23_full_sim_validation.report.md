# M23 — Full-simulation league validation (Phase E)

Generated 2026-09-09. 200 simulated games, rating modifiers = 0 (§22).

> No current game player ratings were used — this is the average-rating baseline check.

| metric | empirical 2023–25 | sim | rel err | within 10% |
| --- | ---: | ---: | ---: | :---: |
| dropback_rate | 0.5984 | 0.5882 | -1.7% | ✅ |
| completion_pct | 0.647 | 0.6549 | +1.2% | ✅ |
| yards_per_attempt | 7.057 | 7.2323 | +2.5% | ✅ |
| air_yards_per_attempt | 7.7112 | 7.6988 | -0.2% | ✅ |
| int_rate_per_att | 0.0223 | 0.0231 | +3.3% | ✅ |
| sack_rate_per_dropback | 0.0663 | 0.0669 | +0.9% | ✅ |
| yards_per_carry | 4.2761 | 4.482 | +4.8% | ✅ |
| explosive_rush_rate | 0.0438 | 0.0418 | -4.6% | ✅ |
| explosive_pass_rate | 0.0894 | 0.0976 | +9.2% | ✅ |
| fg_make_pct | 0.8517 | 0.8529 | +0.1% | ✅ |
| rz_td_rate | 0.5599 | 0.5191 | -7.3% | ✅ |
| plays_per_team_game | 61.9951 | 66.3725 | +7.1% | ✅ |
| drives_per_team_game | 10.7433 | 10.4075 | -3.1% | ✅ |
| points_per_team_game | 22.5643 | 19.9125 | -11.8% | ❌ |
| points_sd | 9.9268 | 8.3301 | -16.1% | ❌ |
| pass_attempts_per_team_game | 32.8192 | 30.315 | -7.6% | ✅ |
| rush_attempts_per_team_game | 23.9902 | 23.9775 | -0.1% | ✅ |
| penalties_per_team_game | 6.1618 | 4.5875 | -25.5% | ❌ |
| penalty_yards_per_team_game | 50.0245 | 39.3026 | -21.4% | ❌ |
| dpi_per_team_game | 0.5239 | 0.39 | -25.6% | ❌ |

**15/20 metrics within 10%** (15/17 of the core football metrics; the three penalty-volume metrics are the Model 25 V1.5 check).

## engine V1 gaps (tracked for the next Phase E iteration)

- **penalties/team-game & penalty yд run ~15–20% low.** M25a/M25b are per-raw-stream-row hazards; the engine's scrimmage-snap population is smaller, and the deterministic accept/decline trims more. `PENALTY_HAZARD_SCALE` is left at 1.0 on purpose — scaling it to hit the empirical count pushes points from −10% to −16%, because the physical-outcome resolvers are fit penalty-FREE (§6.2) and this engine's drive model over-punishes offensive fouls. Reconciling the two needs gained-conditioned hazards (V1.6).
- **points/team-game ~12% low — V1.6 in progress (`drive_baseline.json`, `lib_py/drives.py`).** Per-drive instrumentation + the shared drive-table comparison found two punt bugs (touchback put the receiver at the opponent's 1; a return moved them *backward*) — fixed, which took drive start field position from clearly wrong to within ~1 yд of empirical and points/drive from −6.8% to **−4.2%** (1.86 v 1.94). The residual team-game gap ≈ −4% drive conversion at *fixed* field position (the pts/drive-by-start-FP curve sits below through the own-20-to-midfield bands) + −3% fewer drives (clock runs hot, `end_of_half` 9.3% v 6.85%) + ~1pp too few return-TD drives. Momentum is ruled out (measured intra-drive ρ≈0). Next probe: within-drive down/distance state mix and first-downs-per-drive. See `docs/v16_points_gap_plan.md`. No 2-point tries (EV-neutral).
- **points_sd ~15–17% low** — expected: the average-rating engine runs two identical teams, so scores regress to the mean (no blowouts/shutouts). Variance widens once rating modifiers are on (real team-quality spread) — that is the §23 rating-layer check.
- `qb_hit` and `pass_location` sampled from marginals (Models 06/08 not wired in);
- kickoff / XP / sack-yards are hard-coded empiricals (Models 22/23 not fitted);
- individual-player attribution omitted (team aggregates only) — the §24 stat-integrity tests need it and come with the shippable engine.

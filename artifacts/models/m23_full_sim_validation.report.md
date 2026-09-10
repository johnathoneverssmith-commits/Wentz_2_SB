# M23 — Full-simulation league validation (Phase E)

Generated 2026-09-10. 250 simulated games, rating modifiers = 0 (§22).

> No current game player ratings were used — this is the average-rating baseline check.

| metric | empirical 2023–25 | sim | rel err | within 10% |
| --- | ---: | ---: | ---: | :---: |
| dropback_rate | 0.5984 | 0.5888 | -1.6% | ✅ |
| completion_pct | 0.647 | 0.6515 | +0.7% | ✅ |
| yards_per_attempt | 7.057 | 7.2641 | +2.9% | ✅ |
| air_yards_per_attempt | 7.7112 | 7.8088 | +1.3% | ✅ |
| int_rate_per_att | 0.0223 | 0.0215 | -3.7% | ✅ |
| sack_rate_per_dropback | 0.0663 | 0.0698 | +5.3% | ✅ |
| yards_per_carry | 4.2761 | 4.4499 | +4.1% | ✅ |
| explosive_rush_rate | 0.0438 | 0.0408 | -6.8% | ✅ |
| explosive_pass_rate | 0.0894 | 0.0942 | +5.3% | ✅ |
| fg_make_pct | 0.8517 | 0.8534 | +0.2% | ✅ |
| rz_td_rate | 0.5599 | 0.5468 | -2.3% | ✅ |
| plays_per_team_game | 67.8186 | 69.478 | +2.4% | ✅ |
| drives_per_team_game | 10.7433 | 10.876 | +1.2% | ✅ |
| points_per_team_game | 22.5643 | 21.16 | -6.2% | ✅ |
| points_sd | 9.9268 | 8.3804 | -15.6% | ❌ |
| pass_attempts_per_team_game | 32.8192 | 31.606 | -3.7% | ✅ |
| rush_attempts_per_team_game | 23.9902 | 25.078 | +4.5% | ✅ |
| penalties_per_team_game | 6.1618 | 4.91 | -20.3% | ❌ |
| penalty_yards_per_team_game | 50.0245 | 42.116 | -15.8% | ❌ |
| dpi_per_team_game | 0.5239 | 0.412 | -21.4% | ❌ |

**16/20 metrics within 10%** (16/17 of the core football metrics; the three penalty-volume metrics are the Model 25 V1.5 check).

## engine V1 gaps (tracked for the next Phase E iteration)

- **penalties/team-game & penalty yд run ~15–20% low.** M25a/M25b are per-raw-stream-row hazards; the engine's scrimmage-snap population is smaller, and the deterministic accept/decline trims more. `PENALTY_HAZARD_SCALE` is left at 1.0 on purpose — scaling it to hit the empirical count pushes points from −10% to −16%, because the physical-outcome resolvers are fit penalty-FREE (§6.2) and this engine's drive model over-punishes offensive fouls. Reconciling the two needs gained-conditioned hazards (V1.6).
- **points/team-game −6% (was −12%) — V1.6 (`docs/v16_points_gap_plan.md`).** Fixed two punt bugs (field position), split the RZ `air_yards` table finely (goal-line throws track the end zone), and — the big one — `CLOCK_SCALE = 0.958`: the M24 snap gaps ran ~1 s/play long, so drives ate too much wall clock and ~0.5 fewer fit per team-game. drives/team-game −3.3% → +1.2%; points/drive −2.5%; `rz_td_rate` −2.3%. Ruled out: within-drive momentum (ρ≈0), scaling `PENALTY_HAZARD_SCALE`. `plays_per_team_game` empirical filter fixed to like-for-like (was scrimmage-only, 62 → 68). Residual: `end_of_half` 8.8 v 6.85%, RZ pass-TD ~−20pp yl 5–20 (diffuse M05/M09/M10), return-TD rate ~10× low. No 2-pt tries.
- **points_sd ~15–17% low** — expected: the average-rating engine runs two identical teams, so scores regress to the mean (no blowouts/shutouts). Variance widens once rating modifiers are on (real team-quality spread) — that is the §23 rating-layer check.
- `qb_hit` and `pass_location` sampled from marginals (Models 06/08 not wired in);
- kickoff / XP / sack-yards are hard-coded empiricals (Models 22/23 not fitted);
- individual-player attribution omitted (team aggregates only) — the §24 stat-integrity tests need it and come with the shippable engine.

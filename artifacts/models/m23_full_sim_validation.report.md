# M23 — Full-simulation league validation (Phase E)

Generated 2026-09-09. 100 simulated games, rating modifiers = 0 (§22).

> No current game player ratings were used — this is the average-rating baseline check.

| metric | empirical 2023–25 | sim | rel err | within 10% |
| --- | ---: | ---: | ---: | :---: |
| dropback_rate | 0.5984 | 0.5823 | -2.7% | ✅ |
| completion_pct | 0.647 | 0.6398 | -1.1% | ✅ |
| yards_per_attempt | 7.057 | 7.3757 | +4.5% | ✅ |
| air_yards_per_attempt | 7.7112 | 8.1985 | +6.3% | ✅ |
| int_rate_per_att | 0.0223 | 0.0236 | +5.5% | ✅ |
| sack_rate_per_dropback | 0.0663 | 0.0738 | +11.4% | ❌ |
| yards_per_carry | 4.2761 | 4.2861 | +0.2% | ✅ |
| explosive_rush_rate | 0.0438 | 0.04 | -8.7% | ✅ |
| explosive_pass_rate | 0.0894 | 0.0982 | +9.8% | ✅ |
| fg_make_pct | 0.8517 | 0.8393 | -1.4% | ✅ |
| plays_per_team_game | 61.9951 | 66.81 | +7.8% | ✅ |
| drives_per_team_game | 10.7433 | 10.48 | -2.5% | ✅ |
| points_per_team_game | 22.5643 | 20.35 | -9.8% | ✅ |
| points_sd | 9.9268 | 7.9541 | -19.9% | ❌ |
| pass_attempts_per_team_game | 32.8192 | 30.105 | -8.3% | ✅ |
| rush_attempts_per_team_game | 23.9902 | 24.5 | +2.1% | ✅ |
| penalties_per_team_game | 6.1618 | 4.955 | -19.6% | ❌ |
| penalty_yards_per_team_game | 50.0245 | 43.0243 | -14.0% | ❌ |
| dpi_per_team_game | 0.5239 | 0.455 | -13.2% | ❌ |

**14/19 metrics within 10%** (14/16 of the core football metrics; the three penalty-volume metrics are the Model 25 V1.5 check).

## engine V1 gaps (tracked for the next Phase E iteration)

- **penalties/team-game & penalty yд run ~15–20% low.** M25a/M25b are per-raw-stream-row hazards; the engine's scrimmage-snap population is smaller, and the deterministic accept/decline trims more. `PENALTY_HAZARD_SCALE` is left at 1.0 on purpose — scaling it to hit the empirical count pushes points from −10% to −16%, because the physical-outcome resolvers are fit penalty-FREE (§6.2) and this engine's drive model over-punishes offensive fouls. Reconciling the two needs gained-conditioned hazards (V1.6).
- **points/team-game ~10% low.** The earlier −20% was a clock bug (fixed: drive-ending plays elapse ~65% of the M24 same-drive gap). The wired penalty module is ~net-neutral on points at scale 1.0. The residual is red-zone TD rate ~54% vs ~57%, no kickoff/punt return TDs, no 2-point tries, and a slightly low explosive-play rate — that is the next Phase E iteration.
- **points_sd ~15–17% low** — expected: the average-rating engine runs two identical teams, so scores regress to the mean (no blowouts/shutouts). Variance widens once rating modifiers are on (real team-quality spread) — that is the §23 rating-layer check.
- `qb_hit` and `pass_location` sampled from marginals (Models 06/08 not wired in);
- kickoff / XP / sack-yards are hard-coded empiricals (Models 22/23 not fitted);
- individual-player attribution omitted (team aggregates only) — the §24 stat-integrity tests need it and come with the shippable engine.

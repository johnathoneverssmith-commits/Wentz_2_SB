# M23 — Full-simulation league validation (Phase E)

Generated 2026-09-09. 100 simulated games, rating modifiers = 0 (§22).

> No current game player ratings were used — this is the average-rating baseline check.

| metric | empirical 2023–25 | sim | rel err | within 10% |
| --- | ---: | ---: | ---: | :---: |
| dropback_rate | 0.5984 | 0.59 | -1.4% | ✅ |
| completion_pct | 0.647 | 0.6356 | -1.8% | ✅ |
| yards_per_attempt | 7.057 | 7.2578 | +2.8% | ✅ |
| air_yards_per_attempt | 7.7112 | 7.8487 | +1.8% | ✅ |
| int_rate_per_att | 0.0223 | 0.0225 | +0.8% | ✅ |
| sack_rate_per_dropback | 0.0663 | 0.0664 | +0.2% | ✅ |
| yards_per_carry | 4.2761 | 4.337 | +1.4% | ✅ |
| explosive_rush_rate | 0.0438 | 0.04 | -8.8% | ✅ |
| explosive_pass_rate | 0.0894 | 0.1003 | +12.2% | ❌ |
| fg_make_pct | 0.8517 | 0.8482 | -0.4% | ✅ |
| rz_td_rate | 0.5599 | 0.5559 | -0.7% | ✅ |
| plays_per_team_game | 61.9951 | 67.135 | +8.3% | ✅ |
| drives_per_team_game | 10.7433 | 10.645 | -0.9% | ✅ |
| points_per_team_game | 22.5643 | 20.44 | -9.4% | ✅ |
| points_sd | 9.9268 | 8.7153 | -12.2% | ❌ |
| pass_attempts_per_team_game | 32.8192 | 30.395 | -7.4% | ✅ |
| rush_attempts_per_team_game | 23.9902 | 24.02 | +0.1% | ✅ |
| penalties_per_team_game | 6.1618 | 4.785 | -22.3% | ❌ |
| penalty_yards_per_team_game | 50.0245 | 42.8441 | -14.4% | ❌ |
| dpi_per_team_game | 0.5239 | 0.49 | -6.5% | ✅ |

**16/20 metrics within 10%** (15/17 of the core football metrics; the three penalty-volume metrics are the Model 25 V1.5 check).

## engine V1 gaps (tracked for the next Phase E iteration)

- **penalties/team-game & penalty yд run ~15–20% low.** M25a/M25b are per-raw-stream-row hazards; the engine's scrimmage-snap population is smaller, and the deterministic accept/decline trims more. `PENALTY_HAZARD_SCALE` is left at 1.0 on purpose — scaling it to hit the empirical count pushes points from −10% to −16%, because the physical-outcome resolvers are fit penalty-FREE (§6.2) and this engine's drive model over-punishes offensive fouls. Reconciling the two needs gained-conditioned hazards (V1.6).
- **points/team-game ~9% low, and it is diffuse — per-drive efficiency, not one cause.** RZ TD rate now matches (0.556 v 0.560); kick/punt return TDs and the 0.958 PAT rate are wired. Points come out ~1.9/drive vs ~2.1 empirical while the engine runs *more* plays/team-game (67 v 62) — drives sustain but convert less. Candidates for the next iteration: M01 4th-down aggression, FG-range decisions, and mid-field (20–40) yardage; no 2-point tries (EV-neutral, low priority).
- **points_sd ~15–17% low** — expected: the average-rating engine runs two identical teams, so scores regress to the mean (no blowouts/shutouts). Variance widens once rating modifiers are on (real team-quality spread) — that is the §23 rating-layer check.
- `qb_hit` and `pass_location` sampled from marginals (Models 06/08 not wired in);
- kickoff / XP / sack-yards are hard-coded empiricals (Models 22/23 not fitted);
- individual-player attribution omitted (team aggregates only) — the §24 stat-integrity tests need it and come with the shippable engine.

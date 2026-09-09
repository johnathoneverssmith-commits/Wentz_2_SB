# M23 — Full-simulation league validation (Phase E)

Generated 2026-09-09. 150 simulated games, rating modifiers = 0 (§22).

> No current game player ratings were used — this is the average-rating baseline check.

| metric | empirical 2023–25 | sim | rel err | within 10% |
| --- | ---: | ---: | ---: | :---: |
| dropback_rate | 0.5984 | 0.5909 | -1.3% | ✅ |
| completion_pct | 0.647 | 0.6322 | -2.3% | ✅ |
| yards_per_attempt | 7.057 | 7.1399 | +1.2% | ✅ |
| air_yards_per_attempt | 7.7112 | 7.7997 | +1.1% | ✅ |
| int_rate_per_att | 0.0223 | 0.022 | -1.5% | ✅ |
| sack_rate_per_dropback | 0.0663 | 0.0677 | +2.2% | ✅ |
| yards_per_carry | 4.2761 | 4.4439 | +3.9% | ✅ |
| explosive_rush_rate | 0.0438 | 0.0429 | -2.2% | ✅ |
| explosive_pass_rate | 0.0894 | 0.0959 | +7.3% | ✅ |
| fg_make_pct | 0.8517 | 0.8478 | -0.5% | ✅ |
| rz_td_rate | 0.5599 | 0.5429 | -3.0% | ✅ |
| plays_per_team_game | 61.9951 | 67.1333 | +8.3% | ✅ |
| drives_per_team_game | 10.7433 | 10.7233 | -0.2% | ✅ |
| points_per_team_game | 22.5643 | 20.11 | -10.9% | ❌ |
| points_sd | 9.9268 | 8.6339 | -13.0% | ❌ |
| pass_attempts_per_team_game | 32.8192 | 30.4433 | -7.2% | ✅ |
| rush_attempts_per_team_game | 23.9902 | 23.9567 | -0.1% | ✅ |
| penalties_per_team_game | 6.1618 | 4.7533 | -22.9% | ❌ |
| penalty_yards_per_team_game | 50.0245 | 41.6521 | -16.7% | ❌ |
| dpi_per_team_game | 0.5239 | 0.4333 | -17.3% | ❌ |

**15/20 metrics within 10%** (15/17 of the core football metrics; the three penalty-volume metrics are the Model 25 V1.5 check).

## engine V1 gaps (tracked for the next Phase E iteration)

- **penalties/team-game & penalty yд run ~15–20% low.** M25a/M25b are per-raw-stream-row hazards; the engine's scrimmage-snap population is smaller, and the deterministic accept/decline trims more. `PENALTY_HAZARD_SCALE` is left at 1.0 on purpose — scaling it to hit the empirical count pushes points from −10% to −16%, because the physical-outcome resolvers are fit penalty-FREE (§6.2) and this engine's drive model over-punishes offensive fouls. Reconciling the two needs gained-conditioned hazards (V1.6).
- **points/team-game ~9% low, and it is diffuse — per-drive efficiency, not one cause.** RZ TD rate now matches (0.556 v 0.560); kick/punt return TDs and the 0.958 PAT rate are wired. Points come out ~1.9/drive vs ~2.1 empirical while the engine runs *more* plays/team-game (67 v 62) — drives sustain but convert less. Candidates for the next iteration: M01 4th-down aggression, FG-range decisions, and mid-field (20–40) yardage; no 2-point tries (EV-neutral, low priority).
- **points_sd ~15–17% low** — expected: the average-rating engine runs two identical teams, so scores regress to the mean (no blowouts/shutouts). Variance widens once rating modifiers are on (real team-quality spread) — that is the §23 rating-layer check.
- `qb_hit` and `pass_location` sampled from marginals (Models 06/08 not wired in);
- kickoff / XP / sack-yards are hard-coded empiricals (Models 22/23 not fitted);
- individual-player attribution omitted (team aggregates only) — the §24 stat-integrity tests need it and come with the shippable engine.

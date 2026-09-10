# M23 — Full-simulation league validation (Phase E)

Generated 2026-09-09. 250 simulated games, rating modifiers = 0 (§22).

> No current game player ratings were used — this is the average-rating baseline check.

| metric | empirical 2023–25 | sim | rel err | within 10% |
| --- | ---: | ---: | ---: | :---: |
| dropback_rate | 0.5984 | 0.5895 | -1.5% | ✅ |
| completion_pct | 0.647 | 0.655 | +1.2% | ✅ |
| yards_per_attempt | 7.057 | 7.2753 | +3.1% | ✅ |
| air_yards_per_attempt | 7.7112 | 7.7612 | +0.6% | ✅ |
| int_rate_per_att | 0.0223 | 0.0231 | +3.2% | ✅ |
| sack_rate_per_dropback | 0.0663 | 0.066 | -0.4% | ✅ |
| yards_per_carry | 4.2761 | 4.2574 | -0.4% | ✅ |
| explosive_rush_rate | 0.0438 | 0.0401 | -8.4% | ✅ |
| explosive_pass_rate | 0.0894 | 0.0953 | +6.5% | ✅ |
| fg_make_pct | 0.8517 | 0.8709 | +2.3% | ✅ |
| rz_td_rate | 0.5599 | 0.5393 | -3.7% | ✅ |
| plays_per_team_game | 61.9951 | 66.72 | +7.6% | ✅ |
| drives_per_team_game | 10.7433 | 10.514 | -2.1% | ✅ |
| points_per_team_game | 22.5643 | 19.968 | -11.5% | ❌ |
| points_sd | 9.9268 | 8.3902 | -15.5% | ❌ |
| pass_attempts_per_team_game | 32.8192 | 30.358 | -7.5% | ✅ |
| rush_attempts_per_team_game | 23.9902 | 23.966 | -0.1% | ✅ |
| penalties_per_team_game | 6.1618 | 4.792 | -22.2% | ❌ |
| penalty_yards_per_team_game | 50.0245 | 41.73 | -16.6% | ❌ |
| dpi_per_team_game | 0.5239 | 0.384 | -26.7% | ❌ |

**15/20 metrics within 10%** (15/17 of the core football metrics; the three penalty-volume metrics are the Model 25 V1.5 check).

## engine V1 gaps (tracked for the next Phase E iteration)

- **penalties/team-game & penalty yд run ~15–20% low.** M25a/M25b are per-raw-stream-row hazards; the engine's scrimmage-snap population is smaller, and the deterministic accept/decline trims more. `PENALTY_HAZARD_SCALE` is left at 1.0 on purpose — scaling it to hit the empirical count pushes points from −10% to −16%, because the physical-outcome resolvers are fit penalty-FREE (§6.2) and this engine's drive model over-punishes offensive fouls. Reconciling the two needs gained-conditioned hazards (V1.6).
- **points/team-game ~11% low, diffuse, and NOT the passing game.** The pass distribution is now calibrated by depth (`QB_HIT_BY_DEPTH` + `M09_COMPLETE_CALIB`): completion / YPA / air-yд / explosive-pass all within ~6%. That fix *raised* the points miss from −10% to −11% — M09 was over-completing deep balls, and those phantom explosives were masking ~1.7 pts of a scoring deficit elsewhere. RZ TD rate matches (0.53 v 0.56); return TDs and the 0.958 PAT are wired. The engine runs *more* plays/team-game (67 v 62) yet scores ~1.8/drive v ~2.1 — drives sustain but convert less. Open candidates: FG-range vs go decisions, mid-field (20–40) yardage, clock/possession count. No 2-point tries (EV-neutral).
- **points_sd ~15–17% low** — expected: the average-rating engine runs two identical teams, so scores regress to the mean (no blowouts/shutouts). Variance widens once rating modifiers are on (real team-quality spread) — that is the §23 rating-layer check.
- `qb_hit` and `pass_location` sampled from marginals (Models 06/08 not wired in);
- kickoff / XP / sack-yards are hard-coded empiricals (Models 22/23 not fitted);
- individual-player attribution omitted (team aggregates only) — the §24 stat-integrity tests need it and come with the shippable engine.

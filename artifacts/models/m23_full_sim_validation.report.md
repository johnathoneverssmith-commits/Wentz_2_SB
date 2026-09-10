# M23 — Full-simulation league validation (Phase E)

Generated 2026-09-10. 250 simulated games, rating modifiers = 0 (§22).

> No current game player ratings were used — this is the average-rating baseline check.

| metric | empirical 2023–25 | sim | rel err | within 10% |
| --- | ---: | ---: | ---: | :---: |
| dropback_rate | 0.5984 | 0.5895 | -1.5% | ✅ |
| completion_pct | 0.647 | 0.6534 | +1.0% | ✅ |
| yards_per_attempt | 7.057 | 7.3166 | +3.7% | ✅ |
| air_yards_per_attempt | 7.7112 | 7.8098 | +1.3% | ✅ |
| int_rate_per_att | 0.0223 | 0.0233 | +4.2% | ✅ |
| sack_rate_per_dropback | 0.0663 | 0.0669 | +1.0% | ✅ |
| yards_per_carry | 4.2761 | 4.4819 | +4.8% | ✅ |
| explosive_rush_rate | 0.0438 | 0.0425 | -3.1% | ✅ |
| explosive_pass_rate | 0.0894 | 0.0986 | +10.3% | ❌ |
| fg_make_pct | 0.8517 | 0.8608 | +1.1% | ✅ |
| rz_td_rate | 0.5599 | 0.517 | -7.7% | ✅ |
| plays_per_team_game | 61.9951 | 66.478 | +7.2% | ✅ |
| drives_per_team_game | 10.7433 | 10.392 | -3.3% | ✅ |
| points_per_team_game | 22.5643 | 19.906 | -11.8% | ❌ |
| points_sd | 9.9268 | 8.3211 | -16.2% | ❌ |
| pass_attempts_per_team_game | 32.8192 | 30.312 | -7.6% | ✅ |
| rush_attempts_per_team_game | 23.9902 | 23.93 | -0.3% | ✅ |
| penalties_per_team_game | 6.1618 | 4.648 | -24.6% | ❌ |
| penalty_yards_per_team_game | 50.0245 | 39.8548 | -20.3% | ❌ |
| dpi_per_team_game | 0.5239 | 0.38 | -27.5% | ❌ |

**14/20 metrics within 10%** (14/17 of the core football metrics; the three penalty-volume metrics are the Model 25 V1.5 check).

## engine V1 gaps (tracked for the next Phase E iteration)

- **penalties/team-game & penalty yд run ~15–20% low.** M25a/M25b are per-raw-stream-row hazards; the engine's scrimmage-snap population is smaller, and the deterministic accept/decline trims more. `PENALTY_HAZARD_SCALE` is left at 1.0 on purpose — scaling it to hit the empirical count pushes points from −10% to −16%, because the physical-outcome resolvers are fit penalty-FREE (§6.2) and this engine's drive model over-punishes offensive fouls. Reconciling the two needs gained-conditioned hazards (V1.6).
- **points/team-game ~12% low — V1.6 (`docs/v16_points_gap_plan.md`).** Fixed two punt bugs (touchback → opponent's 1; return sign) → drive start field position now within ~1 yд of empirical, points/drive −6.8% → −3.5%, `never_crossed_mid` exact. Ruled out: within-drive momentum (ρ≈0), and scaling `PENALTY_HAZARD_SCALE` (the defensive-foul first downs it adds are cancelled by the offensive fouls). Split the RZ `air_yards` table finely (gl1..gl4) so goal-line throws track the end zone — `pass_comp TD/pl` yl 3–4 0.56 → 0.63 (tradeoff: `explosive_pass_rate` +9→+10%, kept). Remaining: RZ pass-TD still ~−20pp yl 5–20 (diffuse M05/M09/M10, deferred); drives/team-game −3.3% (M24 clock, next); return-TD rate ~10× low. No 2-pt tries.
- **points_sd ~15–17% low** — expected: the average-rating engine runs two identical teams, so scores regress to the mean (no blowouts/shutouts). Variance widens once rating modifiers are on (real team-quality spread) — that is the §23 rating-layer check.
- `qb_hit` and `pass_location` sampled from marginals (Models 06/08 not wired in);
- kickoff / XP / sack-yards are hard-coded empiricals (Models 22/23 not fitted);
- individual-player attribution omitted (team aggregates only) — the §24 stat-integrity tests need it and come with the shippable engine.

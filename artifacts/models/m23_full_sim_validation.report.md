# M23 — Full-simulation league validation (Phase E)

Generated 2026-09-10. 250 simulated games, rating modifiers = 0 (§22).

> No current game player ratings were used — this is the average-rating baseline check.

| metric | empirical 2023–25 | sim | rel err | within 10% |
| --- | ---: | ---: | ---: | :---: |
| dropback_rate | 0.5984 | 0.593 | -0.9% | ✅ |
| completion_pct | 0.647 | 0.6615 | +2.2% | ✅ |
| yards_per_attempt | 7.057 | 7.367 | +4.4% | ✅ |
| air_yards_per_attempt | 7.7112 | 7.8488 | +1.8% | ✅ |
| int_rate_per_att | 0.0223 | 0.0229 | +2.3% | ✅ |
| sack_rate_per_dropback | 0.0663 | 0.0687 | +3.7% | ✅ |
| yards_per_carry | 4.2761 | 4.5138 | +5.6% | ✅ |
| explosive_rush_rate | 0.0438 | 0.0443 | +1.0% | ✅ |
| explosive_pass_rate | 0.0894 | 0.0967 | +8.2% | ✅ |
| fg_make_pct | 0.8517 | 0.8643 | +1.5% | ✅ |
| rz_td_rate | 0.5599 | 0.5352 | -4.4% | ✅ |
| plays_per_team_game | 67.8186 | 69.654 | +2.7% | ✅ |
| drives_per_team_game | 10.7433 | 10.948 | +1.9% | ✅ |
| points_per_team_game | 22.5643 | 22.122 | -2.0% | ✅ |
| points_sd | 9.9268 | 8.3775 | -15.6% | ❌ |
| pass_attempts_per_team_game | 32.8192 | 31.588 | -3.8% | ✅ |
| rush_attempts_per_team_game | 23.9902 | 24.582 | +2.5% | ✅ |
| penalties_per_team_game | 6.1618 | 4.904 | -20.4% | ❌ |
| penalty_yards_per_team_game | 50.0245 | 42.4059 | -15.2% | ❌ |
| dpi_per_team_game | 0.5239 | 0.44 | -16.0% | ❌ |

**16/20 metrics within 10%** (16/17 of the core football metrics; the three penalty-volume metrics are the Model 25 V1.5 check).

## engine V1 gaps (tracked for the next Phase E iteration)

- **penalties/team-game & penalty yд run ~15–20% low.** M25a/M25b are per-raw-stream-row hazards; the engine's scrimmage-snap population is smaller, and the deterministic accept/decline trims more. `PENALTY_HAZARD_SCALE` is left at 1.0 on purpose — scaling it to hit the empirical count pushes points from −10% to −16%, because the physical-outcome resolvers are fit penalty-FREE (§6.2) and this engine's drive model over-punishes offensive fouls. Reconciling the two needs gained-conditioned hazards (V1.6).
- **points/team-game −2% (was −12%) — V1.6 (`docs/v16_points_gap_plan.md`).** By impact: `CLOCK_SCALE = 0.958` (M24 snap gaps ran ~1 s/play long → drives/team-game −3.3% → +1.9%); `rz_yac` table (RZ completions caught short score at the empirical goal-line-reach rate); end-of-half clock management (2-min-drill timeouts / spikes / kick unit — `end_of_half` 8.8% → 7.9%); two punt bugs (field position); RZ `air_yards` split (gl1..gl4); `PICK_SIX_RATE`/`SCOOP_SIX_RATE` were ~5× low. Ruled out: momentum (ρ≈0), scaling `PENALTY_HAZARD_SCALE`. `plays_per_team_game` empirical filter fixed like-for-like (62 → 68). Residual: RZ pass-TD ~10 pp short yl 5–20 (M05 depth); `opp_touchdown` matched (relabel of punt-return-TD drives). No 2-pt.
- **points_sd ~15–17% low** — expected: the average-rating engine runs two identical teams, so scores regress to the mean (no blowouts/shutouts). Variance widens once rating modifiers are on (real team-quality spread) — that is the §23 rating-layer check.
- `qb_hit` and `pass_location` sampled from marginals (Models 06/08 not wired in);
- kickoff / XP / sack-yards are hard-coded empiricals (Models 22/23 not fitted);
- individual-player attribution omitted (team aggregates only) — the §24 stat-integrity tests need it and come with the shippable engine.

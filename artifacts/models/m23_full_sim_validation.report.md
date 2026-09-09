# M23 — Full-simulation league validation (Phase E)

Generated 2026-09-09. 40 simulated games, rating modifiers = 0 (§22).

> No current game player ratings were used — this is the average-rating baseline check.

| metric | empirical 2023–25 | sim | rel err | within 10% |
| --- | ---: | ---: | ---: | :---: |
| dropback_rate | 0.5984 | 0.5869 | -1.9% | ✅ |
| completion_pct | 0.647 | 0.6316 | -2.4% | ✅ |
| yards_per_attempt | 7.057 | 7.1367 | +1.1% | ✅ |
| air_yards_per_attempt | 7.7112 | 7.7095 | -0.0% | ✅ |
| int_rate_per_att | 0.0223 | 0.0226 | +1.0% | ✅ |
| sack_rate_per_dropback | 0.0663 | 0.0639 | -3.5% | ✅ |
| yards_per_carry | 4.2761 | 4.2554 | -0.5% | ✅ |
| explosive_rush_rate | 0.0438 | 0.0404 | -7.9% | ✅ |
| explosive_pass_rate | 0.0894 | 0.0882 | -1.4% | ✅ |
| fg_make_pct | 0.8517 | 0.8819 | +3.5% | ✅ |
| plays_per_team_game | 61.9951 | 62.0625 | +0.1% | ✅ |
| drives_per_team_game | 10.7433 | 10.4 | -3.2% | ✅ |
| points_per_team_game | 22.5643 | 18.175 | -19.5% | ❌ |
| points_sd | 9.9268 | 9.033 | -9.0% | ✅ |
| pass_attempts_per_team_game | 32.8192 | 29.35 | -10.6% | ❌ |
| rush_attempts_per_team_game | 23.9902 | 23.5375 | -1.9% | ✅ |

**14/16 metrics within 10% of the empirical league baseline.**

## engine V1 gaps (tracked for the next Phase E iteration)

- **points/team-game reads ~20% low** while plays, drives, YPA, YPC, sack/INT rate all match — so the miss is *drive finishing* (red-zone TD rate), not volume. Next: audit the near-goal-line buckets in the M14 / M10 exact-yard PMFs and the goal-line run/pass mix.
- pass attempts run ~10% low (drives skew a touch run-heavy near the goal line — same root cause);
- no penalties (V1.5) — a real source of sustained drives and free first downs;
- `qb_hit` and `pass_location` sampled from marginals (Models 06/08 not wired in);
- kickoff / XP / sack-yards are hard-coded empiricals (Models 22/23 not fitted);
- clock is running-clock only; stoppage/2-min rules simplified;
- individual-player attribution omitted (team aggregates only) — the §24 stat-integrity tests need it and come with the shippable engine.

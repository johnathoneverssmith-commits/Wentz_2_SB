# M23 — Full-simulation league validation (Phase E)

Generated 2026-09-09. 100 simulated games, rating modifiers = 0 (§22).

> No current game player ratings were used — this is the average-rating baseline check.

| metric | empirical 2023–25 | sim | rel err | within 10% |
| --- | ---: | ---: | ---: | :---: |
| dropback_rate | 0.5984 | 0.5783 | -3.4% | ✅ |
| completion_pct | 0.647 | 0.6276 | -3.0% | ✅ |
| yards_per_attempt | 7.057 | 7.0672 | +0.1% | ✅ |
| air_yards_per_attempt | 7.7112 | 7.8549 | +1.9% | ✅ |
| int_rate_per_att | 0.0223 | 0.0233 | +4.1% | ✅ |
| sack_rate_per_dropback | 0.0663 | 0.0691 | +4.3% | ✅ |
| yards_per_carry | 4.2761 | 4.4281 | +3.6% | ✅ |
| explosive_rush_rate | 0.0438 | 0.0461 | +5.2% | ✅ |
| explosive_pass_rate | 0.0894 | 0.0947 | +5.9% | ✅ |
| fg_make_pct | 0.8517 | 0.8883 | +4.3% | ✅ |
| plays_per_team_game | 61.9951 | 65.635 | +5.9% | ✅ |
| drives_per_team_game | 10.7433 | 10.61 | -1.2% | ✅ |
| points_per_team_game | 22.5643 | 20.15 | -10.7% | ❌ |
| points_sd | 9.9268 | 8.5427 | -13.9% | ❌ |
| pass_attempts_per_team_game | 32.8192 | 30.505 | -7.1% | ✅ |
| rush_attempts_per_team_game | 23.9902 | 25.265 | +5.3% | ✅ |

**14/16 metrics within 10% of the empirical league baseline.**

## engine V1 gaps (tracked for the next Phase E iteration)

- **points/team-game ~10% low.** Root cause of the earlier −20% was a clock bug (M24's elapsed model is trained on same-drive snap gaps ~35s incl. huddle; the engine was applying that to drive-ending plays too, ~250s/game overrun → too few plays/drives). Fixed: drive-ending plays elapse ~65% of the sampled gap. Residual −10% is now:
  - **no penalties (V1.5, spec §25)** — DPI / holding / roughing are ~2 free first downs and ~15 yд/game for the offense → ~2 of the ~2.3 missing points;
  - red-zone TD rate ~54% vs ~57% (~1 pt); kickoff/punt return TDs not modelled (~0.5 pt); no 2-point tries.
- **points_sd ~15–17% low** — expected: the average-rating engine runs two identical teams, so scores regress to the mean (no blowouts/shutouts). Variance widens once rating modifiers are on (real team-quality spread) — that is the §23 rating-layer check.
- `qb_hit` and `pass_location` sampled from marginals (Models 06/08 not wired in);
- kickoff / XP / sack-yards are hard-coded empiricals (Models 22/23 not fitted);
- individual-player attribution omitted (team aggregates only) — the §24 stat-integrity tests need it and come with the shippable engine.

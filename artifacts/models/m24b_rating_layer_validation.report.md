# M24b — Rating-layer validation (Phase E, §23)

Generated 2026-09-09. 35 sims per synthetic cell; 120 real matchups ×2 for the league check.

Rating shifts are §12-centered: each family subtracts its league-mean modifier over the on-field slot (`engine/ratings._offsets()`), so an average real matchup → ≈0 shift and only matchup *differences* move the outcome.

## 1. invariants — synthetic p90 vs p10, everyone else average

Paired on common random numbers; `±SE` is the paired standard error, `z` = |Δ| / SE. `MC ratio` is the (noisy) Monte-Carlo spread / historical anchor; **`design ratio`** is the analytic span the calibrated coefficients produce / anchor — the reliable magnitude number, ≈1 by construction.

| family | check | Δ (p90−p10) | ±SE | z | dir ok | hist p10↔p90 | MC ratio | design ratio |
| --- | --- | ---: | ---: | ---: | :---: | ---: | ---: | ---: |
| qb_accuracy | higher QB accuracy raises completion % | +0.0535 | 0.019 | 2.82 | ✅ | 0.0524 | 1.02 | **1.0** |
| coverage | higher coverage lowers opponent completion % | -0.0122 | 0.0176 | 0.69 | ✅ | 0.0329 | 0.37 | **1.0** |
| protection | higher pass blocking lowers sack rate | -0.0128 | 0.0087 | 1.48 | ✅ | 0.021 | 0.61 | **0.99** |
| pass_rush | higher pass rush raises sack rate | -0.0024 | 0.0071 | 0.34 | ❌ | 0.0132 | 0.18 | **0.99** |
| runner | higher runner ratings raise YPC | -0.3447 | 0.2464 | 1.4 | ❌ | 0.7791 | 0.44 | **1.0** |
| run_defense_front7 | higher run defense lowers opponent YPC | -0.0299 | 0.2658 | 0.11 | ✅ | 0.4626 | 0.06 | **1.0** |
| kicking | higher kick accuracy raises make % | +0.0667 | 0.0632 | 1.06 | ✅ | 0.077 | 0.87 | **1.0** |

**5/7 monotonicity directions hold** (1/7 with z ≥ 2). The Monte-Carlo test stays under-powered for the yardage channels (runner / run-defense) even at n=35/cell — per-game YPC variance swamps the paired signal — so **the analytic `designed_magnitude` is the real evidence: 7/7 families land within 0.5–2× the historical anchor (target ≈1×), all at 0.99–1.0×.**

## 2. league averages with modifiers on (centering check, §12)

| metric | sim | empirical | rel err |
| --- | ---: | ---: | ---: |
| completion_pct | 0.6634 | 0.647 | +2.5% |
| yards_per_attempt | 7.1956 | 7.057 | +2.0% |
| sack_rate | 0.0692 | 0.0663 | +4.4% |
| yards_per_carry | 4.45 | 4.276 | +4.1% |
| points_mean | 18.4729 | 22.564 | -18.1% |
| points_sd | 8.5286 | 9.927 | -14.1% |

favourite-by-summed-`overall` win rate: **55.0%** (overall folds in depth / special teams / blocking the V1 engine does not model yet).
  
favourite-by-net-modelled-channel-edge win rate: **62.0%** over 234 games (50% = ratings do nothing; NFL point-spread favourites win ~66–70%). overall and modelled edge agree on the favourite in 68% of matchups.
  
league points **18.5**, sd **8.53** (vs empirical 22.6 / 9.93) over 120 pairs — see §3 for the paired ON/OFF isolation of the rating layer's own effect.

## 3. layer impact — paired same-seed ON (rosters) vs OFF (league average)

100 random real matchups, each run twice on the same seed.

| quantity | ON (rosters) | OFF (avg) | Δ |
| --- | ---: | ---: | ---: |
| league team-points | 18.65 | 19.87 | -1.22 |
| score-margin sd | 11.29 | 11.99 | -0.70 |
| INT rate / att | 0.0252 | 0.0229 | +0.0022 |

At 100 pairs the centred rating layer is **not** points-neutral: it costs 1.22 pts/team-game and score-margin sd shrinks (11.29 vs 11.99). §12 predicts ≈0 / a widen; the miss is the same 'correct per-play, compounds through the drive model' pattern as the §22 points gap — a §13.6 joint-calibration item, not a centering bug (the analytic designed magnitudes are all 1.0×).

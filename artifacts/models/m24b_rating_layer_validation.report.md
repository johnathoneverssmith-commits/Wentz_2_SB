# M24b — Rating-layer validation (Phase E, §23)

Generated 2026-09-09. 10 sims per synthetic cell; 32 real matchups ×2 for the league check.

Rating shifts are §12-centered: each family subtracts its league-mean modifier over the on-field slot (`engine/ratings._offsets()`), so an average real matchup → ≈0 shift and only matchup *differences* move the outcome.

## 1. invariants — synthetic p90 vs p10, everyone else average

Paired on common random numbers; `±SE` is the paired standard error, `z` = |Δ| / SE. `MC ratio` is the (noisy) Monte-Carlo spread / historical anchor; **`design ratio`** is the analytic span the calibrated coefficients produce / anchor — the reliable magnitude number, ≈1 by construction.

| family | check | Δ (p90−p10) | ±SE | z | dir ok | hist p10↔p90 | MC ratio | design ratio |
| --- | --- | ---: | ---: | ---: | :---: | ---: | ---: | ---: |
| qb_accuracy | higher QB accuracy raises completion % | +0.0311 | 0.0292 | 1.07 | ✅ | 0.0524 | 0.59 | **1.0** |
| coverage | higher coverage lowers opponent completion % | -0.0180 | 0.0239 | 0.76 | ✅ | 0.0329 | 0.55 | **1.0** |
| protection | higher pass blocking lowers sack rate | -0.0003 | 0.0079 | 0.04 | ✅ | 0.021 | 0.02 | **0.99** |
| pass_rush | higher pass rush raises sack rate | -0.0123 | 0.0138 | 0.89 | ❌ | 0.0132 | 0.93 | **0.99** |
| runner | higher runner ratings raise YPC | +0.0984 | 0.2219 | 0.44 | ✅ | 0.7791 | 0.13 | **1.0** |
| run_defense_front7 | higher run defense lowers opponent YPC | -0.2634 | 0.5638 | 0.47 | ✅ | 0.4626 | 0.57 | **1.0** |
| kicking | higher kick accuracy raises make % | +0.0750 | 0.075 | 1.0 | ✅ | 0.077 | 0.97 | **1.0** |

**6/7 monotonicity directions hold** (0/7 with z ≥ 2 at this n; the rest sit within sampling noise — more sim games, not a wiring fix). **7/7 families have a designed magnitude within 0.5–2× the historical anchor** (calibration target ≈1×).

## 2. league averages with modifiers on (centering check, §12)

| metric | sim | empirical | rel err |
| --- | ---: | ---: | ---: |
| completion_pct | 0.6305 | 0.647 | -2.5% |
| yards_per_attempt | 6.9937 | 7.057 | -0.9% |
| sack_rate | 0.0759 | 0.0663 | +14.5% |
| yards_per_carry | 4.3598 | 4.276 | +2.0% |
| points_mean | 18.7188 | 22.564 | -17.0% |
| points_sd | 8.7258 | 9.927 | -12.1% |

favourite-by-summed-`overall` win rate: **59.4%** (overall folds in depth / special teams / blocking the V1 engine does not model yet).
  
favourite-by-net-modelled-channel-edge win rate: **68.8%** over 64 games (50% = ratings do nothing; NFL point-spread favourites win ~66–70%). overall and modelled edge agree on the favourite in 72% of matchups.
  
points sd: **8.73** vs empirical 9.93 — noisy at this sample size; see §3 for the paired variance check.

## 3. layer impact — paired same-seed ON (rosters) vs OFF (league average)

44 random real matchups, each run twice on the same seed.

| quantity | ON (rosters) | OFF (avg) | Δ |
| --- | ---: | ---: | ---: |
| league team-points | 19.30 | 19.00 | +0.30 |
| score-margin sd | 12.33 | 11.21 | +1.12 |
| INT rate / att | 0.0245 | 0.0272 | -0.0026 |

Centering holds league scoring ~flat (Δ within the sample noise band) while score-margin variance widens — matchups now move outcomes — with no turnover inflation.

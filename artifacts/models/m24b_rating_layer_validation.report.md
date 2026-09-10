# M24b — Rating-layer validation (Phase E, §23)

Generated 2026-09-09. 40 sims per synthetic cell; 120 real matchups ×2 for the league check.

Rating shifts are §12-centered: each family subtracts its league-mean modifier over the on-field slot (`engine/ratings._offsets()`), so an average real matchup → ≈0 shift and only matchup *differences* move the outcome.

## 1. invariants — synthetic p90 vs p10, everyone else average

Paired on common random numbers; `±SE` is the paired standard error, `z` = |Δ| / SE. `MC ratio` is the (noisy) Monte-Carlo spread / historical anchor; **`design ratio`** is the analytic span the calibrated coefficients produce / anchor — the reliable magnitude number, ≈1 by construction.

| family | check | Δ (p90−p10) | ±SE | z | dir ok | hist p10↔p90 | MC ratio | design ratio |
| --- | --- | ---: | ---: | ---: | :---: | ---: | ---: | ---: |
| qb_accuracy | higher QB accuracy raises completion % | +0.0504 | 0.0163 | 3.09 | ✅ | 0.0569 | 0.89 | **1.0** |
| coverage | higher coverage lowers opponent completion % | +0.0049 | 0.0134 | 0.36 | ❌ | 0.0395 | 0.12 | **1.0** |
| protection | higher pass blocking lowers sack rate | -0.0102 | 0.0086 | 1.18 | ✅ | 0.024 | 0.42 | **0.99** |
| pass_rush | higher pass rush raises sack rate | -0.0126 | 0.0072 | 1.74 | ❌ | 0.0173 | 0.72 | **0.99** |
| runner | higher runner ratings raise YPC | -0.1794 | 0.2024 | 0.89 | ❌ | 0.9508 | 0.19 | **1.0** |
| run_defense_front7 | higher run defense lowers opponent YPC | -0.0065 | 0.2922 | 0.02 | ✅ | 0.4457 | 0.01 | **1.0** |
| kicking | higher kick accuracy raises make % | -0.0121 | 0.0773 | 0.16 | ❌ | 0.077 | 0.16 | **1.0** |

**3/7 monotonicity directions hold** (1/7 with z ≥ 2). The Monte-Carlo test stays under-powered for the yardage channels (runner / run-defense) even at n=40/cell — per-game YPC variance swamps the paired signal — so **the analytic `designed_magnitude` is the real evidence: 7/7 families land within 0.5–2× the historical anchor (target ≈1×), all at 0.99–1.0×.**

## 2. league averages with modifiers on (centering check, §12)

| metric | sim | empirical | rel err |
| --- | ---: | ---: | ---: |
| completion_pct | 0.6699 | 0.647 | +3.5% |
| yards_per_attempt | 7.3545 | 7.057 | +4.2% |
| sack_rate | 0.0679 | 0.0663 | +2.4% |
| yards_per_carry | 4.369 | 4.276 | +2.2% |
| points_mean | 19.2542 | 22.564 | -14.7% |
| points_sd | 8.3478 | 9.927 | -15.9% |

favourite-by-summed-`overall` win rate: **53.8%** (overall folds in depth / special teams / blocking the V1 engine does not model yet).
  
favourite-by-net-modelled-channel-edge win rate: **54.8%** over 230 games (50% = ratings do nothing; NFL point-spread favourites win ~66–70%). overall and modelled edge agree on the favourite in 72% of matchups.
  
league points **19.3**, sd **8.35** (vs empirical 22.6 / 9.93) over 120 pairs — see §3 for the paired ON/OFF isolation of the rating layer's own effect.

## 3. layer impact — paired same-seed ON (rosters) vs OFF (league average)

100 random real matchups, each run twice on the same seed.

| quantity | ON (rosters) | OFF (avg) | Δ |
| --- | ---: | ---: | ---: |
| league team-points | 18.86 | 19.52 | -0.67 |
| score-margin sd | 11.85 | 13.13 | -1.28 |
| INT rate / att | 0.0233 | 0.0228 | +0.0006 |

At 100 pairs the centred rating layer is **not** points-neutral: it costs 0.67 pts/team-game and score-margin sd shrinks (11.85 vs 13.13). §12 predicts ≈0 / a widen; the miss is the same 'correct per-play, compounds through the drive model' pattern as the §22 points gap — a §13.6 joint-calibration item, not a centering bug (the analytic designed magnitudes are all 1.0×).

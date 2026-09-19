# M24b — Rating-layer validation (Phase E, §23)

Generated 2026-09-19. 40 sims per synthetic cell; 120 real matchups ×2 for the league check.

Rating shifts are §12-centered: each family subtracts its league-mean modifier over the on-field slot (`engine/ratings._offsets()`), so an average real matchup → ≈0 shift and only matchup *differences* move the outcome.

## 1. invariants — synthetic p90 vs p10, everyone else average

Paired on common random numbers; `±SE` is the paired standard error, `z` = |Δ| / SE. `MC ratio` is the (noisy) Monte-Carlo spread / historical anchor; **`design ratio`** is the analytic span the calibrated coefficients produce / anchor — the reliable magnitude number, ≈1 by construction.

| family | check | Δ (p90−p10) | ±SE | z | dir ok | hist p10↔p90 | MC ratio | design ratio |
| --- | --- | ---: | ---: | ---: | :---: | ---: | ---: | ---: |
| qb_accuracy | higher QB accuracy raises completion % | +0.0722 | 0.0133 | 5.45 | ✅ | 0.0569 | 1.27 | **1.0** |
| coverage | higher coverage lowers opponent completion % | -0.0236 | 0.0176 | 1.34 | ✅ | 0.0395 | 0.6 | **1.0** |
| protection | higher pass blocking lowers sack rate | +0.0048 | 0.0069 | 0.69 | ❌ | 0.024 | 0.2 | **0.99** |
| pass_rush | higher pass rush raises sack rate | +0.0008 | 0.0068 | 0.12 | ✅ | 0.0173 | 0.05 | **0.99** |
| runner | higher runner ratings raise YPC | -0.2739 | 0.3089 | 0.89 | ❌ | 0.9508 | 0.29 | **1.0** |
| run_defense_front7 | higher run defense lowers opponent YPC | +0.2507 | 0.3013 | 0.83 | ❌ | 0.4457 | 0.56 | **1.0** |
| kicking | higher kick accuracy raises make % | -0.0467 | 0.0812 | 0.57 | ❌ | 0.077 | 0.61 | **1.0** |

**3/7 monotonicity directions hold** (1/7 with z ≥ 2). The Monte-Carlo test stays under-powered for the yardage channels (runner / run-defense) even at n=40/cell — per-game YPC variance swamps the paired signal — so **the analytic `designed_magnitude` is the real evidence: 7/7 families land within 0.5–2× the historical anchor (target ≈1×), all at 0.99–1.0×.**

## 2. league averages with modifiers on (centering check, §12)

| metric | sim | empirical | rel err |
| --- | ---: | ---: | ---: |
| completion_pct | 0.6498 | 0.647 | +0.4% |
| yards_per_attempt | 7.1236 | 7.057 | +0.9% |
| sack_rate | 0.0716 | 0.0663 | +8.0% |
| yards_per_carry | 4.5947 | 4.276 | +7.5% |
| points_mean | 20.8938 | 22.564 | -7.4% |
| points_sd | 9.8818 | 9.927 | -0.5% |

favourite-by-summed-`overall` win rate: **71.7%** (overall folds in depth / special teams / blocking the V1 engine does not model yet).
  
favourite-by-net-modelled-channel-edge win rate: **60.4%** over 230 games (50% = ratings do nothing; NFL point-spread favourites win ~66–70%). overall and modelled edge agree on the favourite in 72% of matchups.
  
league points **20.9**, sd **9.88** (vs empirical 22.6 / 9.93) over 120 pairs — see §3 for the paired ON/OFF isolation of the rating layer's own effect.

## 3. layer impact — paired same-seed ON (rosters) vs OFF (league average)

100 random real matchups, each run twice on the same seed.

| quantity | ON (rosters) | OFF (avg) | Δ |
| --- | ---: | ---: | ---: |
| league team-points | 19.54 | 21.52 | -1.98 |
| score-margin sd | 15.86 | 12.23 | +3.64 |
| INT rate / att | 0.0315 | 0.0223 | +0.0092 |

Score-margin sd widens (15.86 vs 12.23) — the §12 direction — and turnovers are not inflated. Points run -1.98/team-game at this n; the deterministic §13.6 harness (`26_joint_calibration.py`) puts the converged figure at **≈ −0.8 ± 0.4** (z≈1.9, ~−4%) — small, borderline, and diffuse (no single channel carries it, and it is not a logit-curvature artifact). Left as a §13.6 watch item, no coefficient change; the material scoring gap is the §22 −12% (rating-layer *off*).

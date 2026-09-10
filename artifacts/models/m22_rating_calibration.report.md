# M22 — Rating-effect calibration (Phase D)

Generated 2026-09-09.

> No current game player ratings were used to fit the nflverse baseline or the step-1 residual spreads.

## step 1 — historical residual skill variance (§13.2)

Per-unit mean of (actual − expected-from-Phase-B-model), empirical-Bayes shrunk by opportunity count. The p10↔p90 span is the variance budget for that unit's rating layer.

| unit | n units | opp | shrunk sd | p10 | p90 | p10↔p90 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| m09_qb_completion (QB adjusted completion rate (obs − expected)) | 97 | 135,950 | 0.0236 | -0.0360 | +0.0209 | 0.0569 |
| m09_def_completion (Defense adjusted completion rate allowed) | 256 | 141,231 | 0.0157 | -0.0212 | +0.0183 | 0.0395 |
| m09_qb_interception (QB adjusted interception rate) | 97 | 135,950 | 0.0054 | -0.0044 | +0.0103 | 0.0147 |
| m10_receiver_yac (Receiver adjusted YAC per reception (yards)) | 345 | 73,094 | 0.5271 | -0.6899 | +0.6696 | 1.3594 |
| m14_rusher_yards (Rusher adjusted yards per carry) | 211 | 90,664 | 0.3778 | -0.5729 | +0.3778 | 0.9508 |
| m14_defense_rush_yards (Defense adjusted rush yards allowed per carry) | 103 | 44,779 | 0.1778 | -0.2055 | +0.2402 | 0.4457 |
| m20_kicker_make (Kicker adjusted make rate) | 62 | 7,938 | 0.0298 | -0.0508 | +0.0261 | 0.0770 |
| m04_offense_sack (Offense adjusted sack rate (protection)) | 256 | 158,432 | 0.0093 | -0.0131 | +0.0109 | 0.0240 |
| m04_defense_sack (Defense adjusted sack rate (pass rush)) | 256 | 158,432 | 0.0071 | -0.0106 | +0.0067 | 0.0173 |

## step 2 — coefficient set (§13.4)

`beta_per_z` is the logit (or yards) shift per 1 SD of the standardized attribute, anchored so a synthetic player at the 90th attribute percentile moves the outcome by ~half the historical p10↔p90 residual span for that matchup side. Sign-constrained per §23.

| family | resolver→target | units | family effect @ z+1.28 | attributes (weight) |
| --- | --- | --- | ---: | --- |
| qb_accuracy | M09→COMPLETE | logit | +0.1248 | throw_accuracy_short(0.34), throw_accuracy_mid(0.3), throw_accuracy_deep(0.22), awareness(0.14) |
| receiver_hands_routes | M09→COMPLETE | logit | +0.0867 | catching(0.4), route_running_short(0.2), route_running_mid(0.2), route_running_deep(0.12), release(0.08) |
| coverage | M09→COMPLETE | logit | -0.0867 | man_coverage(0.3), zone_coverage(0.3), press(0.15), play_recognition(0.25) |
| qb_ball_security | M09→INTERCEPTION | logit | -0.3427 | awareness(0.55), throw_accuracy_mid(0.25), throw_accuracy_deep(0.2) |
| protection | M04→SACK | logit | -0.1923 | pass_block(0.32), pass_block_power(0.16), pass_block_finesse(0.16), anchor(0.12), awareness(0.12), line_calls(0.12) |
| pass_rush | M04→SACK | logit | +0.1391 | power_moves(0.22), finesse_moves(0.22), block_shedding(0.16), speed(0.12), acceleration(0.12), play_recognition(0.16) |
| runner | M14→_yards | yards | +0.4754 | ball_carrier_vision(0.26), break_tackle(0.24), speed(0.16), acceleration(0.14), agility(0.12), strength(0.08) |
| run_defense_front7 | M14→_yards | yards | -0.2228 | run_defense(0.24), block_shedding(0.2), tackle(0.18), pursuit(0.16), play_recognition(0.12), strength(0.1) |
| yac_ballcarrier | M10→_yards | yards | +0.6797 | yac(0.3), break_tackle(0.22), speed(0.2), acceleration(0.16), agility(0.12) |
| open_field_tackling | M10→_yards | yards | -0.6797 | tackle(0.34), pursuit(0.28), speed(0.2), acceleration(0.18) |
| kicking | M20→MADE | logit | +0.3046 | kick_accuracy(0.62), kick_power(0.38) |

## step 3 — synthetic percentile-player sensitivity (§13.5)

All attributes in a family set to the same percentile; outcome vs an average matchup.

| family | p10 | p50 | p90 | p99 | monotonic | max single-attr share |
| --- | ---: | ---: | ---: | ---: | :---: | ---: |
| qb_accuracy | 0.6202 | 0.6491 | 0.677 | 0.6988 | yes | 0.34 |
| receiver_hands_routes | 0.6291 | 0.6491 | 0.6686 | 0.684 | yes | 0.4 |
| coverage | 0.6686 | 0.6491 | 0.6291 | 0.6125 | yes | 0.3 |
| qb_ball_security | 0.0305 | 0.0219 | 0.0156 | 0.0119 | yes | 0.55 |
| protection | 0.0799 | 0.0668 | 0.0558 | 0.0481 | yes | 0.32 |
| pass_rush | 0.0587 | 0.0668 | 0.076 | 0.0844 | yes | 0.22 |
| runner | -0.475 | 0.0 | 0.475 | 0.862 | yes | 0.26 |
| run_defense_front7 | 0.223 | -0.0 | -0.223 | -0.404 | yes | 0.24 |
| yac_ballcarrier | -0.68 | 0.0 | 0.68 | 1.233 | yes | 0.3 |
| open_field_tackling | 0.68 | -0.0 | -0.68 | -1.233 | yes | 0.34 |
| kicking | 0.8089 | 0.8517 | 0.8862 | 0.9089 | yes | 0.62 |

## invariants (§23)

- higher QB accuracy must not lower completion — ok
- higher coverage must not raise opponent completion — ok
- higher protection must not raise sack prob — ok
- higher pass rush must not lower sack prob — ok
- higher kick accuracy must not lower make prob — ok

## deferred to Phase E
- §13.6 joint calibration loss across all resolvers simultaneously.
- Simulation-level distribution targets (§22): completion %, YPA, sack rate, YPC, explosive rates, etc. with the modifiers on.
- Per-attribute weights within a family are v0 judgement; the joint loss will move them.
- HGB resolvers (M09/M10/M14) need a portable export before the TS engine can apply these logit/yards modifiers on top of their baseline output.

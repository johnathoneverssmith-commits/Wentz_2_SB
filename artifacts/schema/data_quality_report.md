# Data-quality report — nflverse PBP 2023–2025 + players_local_final.csv

Generated 2026-09-08 by `analysis/00_schema_audit.ts` (spec §28 first task).
No models were fitted. **No current game player ratings were used to fit any nflverse baseline** —
this task only inspects the data.

| season | file rows | REG + core-clean rows (§6.1, §6.5) |
| --- | ---: | ---: |
| 2023 | 49,665 | 37,568 |
| 2024 | 49,492 | 36,861 |
| 2025 | 48,771 | 36,259 |

## 1. Are all required PBP variables present in all 3 seasons?

**Yes.** All 90 fields the spec §1.1 lists are present in 2023, 2024 and 2025. All three files carry an identical 372-column schema.

## 2. Which relevant variables have substantial missingness?

Per §6.6: raw (full cleaned-play denominator) and applicable-population figures side by side, 
true nulls and empty-string sentinels counted separately. Showing fields with applicable missingness > 1% 
in any season, plus every §6.6-listed field.

| field | denominator rule | season | raw null | raw "" | raw miss% | applicable miss% (n) |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| `pass_length` | play_type == "pass" | 2023 | 19322 | 0 | 51.43% | 7.18% (19,657) |
|  |  | 2024 | 19123 | 0 | 51.88% | 6.90% (19,052) |
|  |  | 2025 | 18901 | 0 | 52.13% | 6.90% (18,645) |
| `pass_location` | play_type == "pass" | 2023 | 19322 | 0 | 51.43% | 7.18% (19,657) |
|  |  | 2024 | 19123 | 0 | 51.88% | 6.90% (19,052) |
|  |  | 2025 | 18901 | 0 | 52.13% | 6.90% (18,645) |
| `air_yards` | play_type == "pass" | 2023 | 19258 | 0 | 51.26% | 7.18% (19,657) |
|  |  | 2024 | 19052 | 0 | 51.69% | 6.90% (19,052) |
|  |  | 2025 | 18821 | 0 | 51.91% | 6.90% (18,645) |
| `yards_after_catch` | complete_pass == 1 | 2023 | 25760 | 0 | 68.57% | 0.00% (11,808) |
|  |  | 2024 | 25232 | 0 | 68.45% | 0.00% (11,629) |
|  |  | 2025 | 25043 | 0 | 69.07% | 0.01% (11,217) |
| `run_location` | play_type == "run" | 2023 | 23496 | 0 | 62.54% | 0.09% (14,085) |
|  |  | 2024 | 22700 | 0 | 61.58% | 0.08% (14,172) |
|  |  | 2025 | 22185 | 0 | 61.18% | 0.05% (14,081) |
| `run_gap` | play_type == "run" | 2023 | 27216 | 0 | 72.44% | 26.50% (14,085) |
|  |  | 2024 | 26265 | 0 | 71.25% | 25.23% (14,172) |
|  |  | 2025 | 25961 | 0 | 71.60% | 26.87% (14,081) |
| `field_goal_result` | play_type == "field_goal" | 2023 | 36508 | 0 | 97.18% | 0.00% (1,060) |
|  |  | 2024 | 35746 | 0 | 96.98% | 0.00% (1,115) |
|  |  | 2025 | 35171 | 0 | 97.00% | 0.00% (1,088) |
| `kick_distance` | play_type == "field_goal" | 2023 | 34245 | 0 | 91.15% | 0.00% (1,060) |
|  |  | 2024 | 33700 | 0 | 91.42% | 0.00% (1,115) |
|  |  | 2025 | 33238 | 0 | 91.67% | 0.00% (1,088) |
| `passer_player_id` | full cleaned play population | 2023 | 17844 | 0 | 47.50% | 47.50% (37,568) |
|  |  | 2024 | 17738 | 0 | 48.12% | 48.12% (36,861) |
|  |  | 2025 | 17534 | 0 | 48.36% | 48.36% (36,259) |
| `receiver_player_id` | full cleaned play population | 2023 | 20086 | 0 | 53.47% | 53.47% (37,568) |
|  |  | 2024 | 19850 | 0 | 53.85% | 53.85% (36,861) |
|  |  | 2025 | 19650 | 0 | 54.19% | 54.19% (36,259) |
| `rusher_player_id` | full cleaned play population | 2023 | 23055 | 0 | 61.37% | 61.37% (37,568) |
|  |  | 2024 | 22284 | 0 | 60.45% | 60.45% (36,861) |
|  |  | 2025 | 21745 | 0 | 59.97% | 59.97% (36,259) |
| `interception_player_id` | full cleaned play population | 2023 | 37138 | 0 | 98.86% | 98.86% (37,568) |
|  |  | 2024 | 36474 | 0 | 98.95% | 98.95% (36,861) |
|  |  | 2025 | 35879 | 0 | 98.95% | 98.95% (36,259) |
| `sack_player_id` | full cleaned play population | 2023 | 36339 | 0 | 96.73% | 96.73% (37,568) |
|  |  | 2024 | 35694 | 0 | 96.83% | 96.83% (36,861) |
|  |  | 2025 | 35136 | 0 | 96.90% | 96.90% (36,259) |
| `half_sack_1_player_id` | full cleaned play population | 2023 | 37398 | 0 | 99.55% | 99.55% (37,568) |
|  |  | 2024 | 36724 | 0 | 99.63% | 99.63% (36,861) |
|  |  | 2025 | 36104 | 0 | 99.57% | 99.57% (36,259) |
| `half_sack_2_player_id` | full cleaned play population | 2023 | 37398 | 0 | 99.55% | 99.55% (37,568) |
|  |  | 2024 | 36724 | 0 | 99.63% | 99.63% (36,861) |
|  |  | 2025 | 36104 | 0 | 99.57% | 99.57% (36,259) |
| `kicker_player_id` | full cleaned play population | 2023 | 36508 | 0 | 97.18% | 97.18% (37,568) |
|  |  | 2024 | 35746 | 0 | 96.98% | 96.98% (36,861) |
|  |  | 2025 | 35171 | 0 | 97.00% | 97.00% (36,259) |
| `punter_player_id` | full cleaned play population | 2023 | 35305 | 0 | 93.98% | 93.98% (37,568) |
|  |  | 2024 | 34815 | 0 | 94.45% | 94.45% (36,861) |
|  |  | 2025 | 34326 | 0 | 94.67% | 94.67% (36,259) |
| `penalty_type` | penalty == 1 | 2023 | 36907 | 0 | 98.24% | 0.00% (661) |
|  |  | 2024 | 36172 | 0 | 98.13% | 0.00% (689) |
|  |  | 2025 | 35573 | 0 | 98.11% | 0.00% (686) |
| `penalty_yards` | penalty == 1 | 2023 | 36907 | 0 | 98.24% | 0.00% (661) |
|  |  | 2024 | 36172 | 0 | 98.13% | 0.00% (689) |
|  |  | 2025 | 35573 | 0 | 98.11% | 0.00% (686) |
| `cp` | play_type == "pass" | 2023 | 20086 | 0 | 53.47% | 11.06% (19,657) |
|  |  | 2024 | 19850 | 0 | 53.85% | 10.71% (19,052) |
|  |  | 2025 | 19650 | 0 | 54.19% | 10.92% (18,645) |
| `cpoe` | play_type == "pass" | 2023 | 20086 | 0 | 53.47% | 11.06% (19,657) |
|  |  | 2024 | 19850 | 0 | 53.85% | 10.71% (19,052) |
|  |  | 2025 | 19650 | 0 | 54.19% | 10.92% (18,645) |
| `surface` | full cleaned play population | 2023 | 0 | 4876 | 12.98% | 12.98% (37,568) |
|  |  | 2024 | 0 | 287 | 0.78% | 0.78% (36,861) |
|  |  | 2025 | 0 | 130 | 0.36% | 0.36% (36,259) |
| `temp` | full cleaned play population | 2023 | 16972 | 0 | 45.18% | 45.18% (37,568) |
|  |  | 2024 | 13514 | 0 | 36.66% | 36.66% (36,861) |
|  |  | 2025 | 12834 | 0 | 35.40% | 35.40% (36,259) |
| `wind` | full cleaned play population | 2023 | 16972 | 0 | 45.18% | 45.18% (37,568) |
|  |  | 2024 | 13514 | 0 | 36.66% | 36.66% (36,861) |
|  |  | 2025 | 12834 | 0 | 35.40% | 35.40% (36,259) |
| `xyac_mean_yardage` | pass & complete_pass == 1 | 2023 | 21175 | 0 | 56.36% | 3.47% (11,808) |
|  |  | 2024 | 21043 | 0 | 57.09% | 4.04% (11,629) |
|  |  | 2025 | 20759 | 0 | 57.25% | 4.00% (11,217) |
| `xyac_median_yardage` | pass & complete_pass == 1 | 2023 | 21175 | 0 | 56.36% | 3.47% (11,808) |
|  |  | 2024 | 21043 | 0 | 57.09% | 4.04% (11,629) |
|  |  | 2025 | 20759 | 0 | 57.25% | 4.00% (11,217) |
| `xyac_success` | pass & complete_pass == 1 | 2023 | 21175 | 0 | 56.36% | 3.47% (11,808) |
|  |  | 2024 | 21043 | 0 | 57.09% | 4.04% (11,629) |
|  |  | 2025 | 20759 | 0 | 57.25% | 4.00% (11,217) |
| `xyac_fd` | pass & complete_pass == 1 | 2023 | 21175 | 0 | 56.36% | 3.47% (11,808) |
|  |  | 2024 | 21043 | 0 | 57.09% | 4.04% (11,629) |
|  |  | 2025 | 20759 | 0 | 57.25% | 4.00% (11,217) |
| `xpass` | full cleaned play population | 2023 | 3826 | 0 | 10.18% | 10.18% (37,568) |
|  |  | 2024 | 3637 | 0 | 9.87% | 9.87% (36,861) |
|  |  | 2025 | 3533 | 0 | 9.74% | 9.74% (36,259) |
| `pass_oe` | full cleaned play population | 2023 | 3826 | 0 | 10.18% | 10.18% (37,568) |
|  |  | 2024 | 3637 | 0 | 9.87% | 9.87% (36,861) |
|  |  | 2025 | 3533 | 0 | 9.74% | 9.74% (36,259) |
| `qb_hit_1_player_id` | full cleaned play population | 2023 | 34547 | 0 | 91.96% | 91.96% (37,568) |
|  |  | 2024 | 34000 | 0 | 92.24% | 92.24% (36,861) |
|  |  | 2025 | 33368 | 0 | 92.03% | 92.03% (36,259) |
| `qb_hit_2_player_id` | full cleaned play population | 2023 | 37410 | 0 | 99.58% | 99.58% (37,568) |
|  |  | 2024 | 36739 | 0 | 99.67% | 99.67% (36,861) |
|  |  | 2025 | 36112 | 0 | 99.59% | 99.59% (36,259) |
| `solo_tackle_1_player_id` | full cleaned play population | 2023 | 18560 | 0 | 49.40% | 49.40% (37,568) |
|  |  | 2024 | 18296 | 0 | 49.64% | 49.64% (36,861) |
|  |  | 2025 | 18026 | 0 | 49.71% | 49.71% (36,259) |
| `solo_tackle_2_player_id` | full cleaned play population | 2023 | 37511 | 0 | 99.85% | 99.85% (37,568) |
|  |  | 2024 | 36817 | 0 | 99.88% | 99.88% (36,861) |
|  |  | 2025 | 36207 | 0 | 99.86% | 99.86% (36,259) |
| `assist_tackle_1_player_id` | full cleaned play population | 2023 | 29612 | 0 | 78.82% | 78.82% (37,568) |
|  |  | 2024 | 28815 | 0 | 78.17% | 78.17% (36,861) |
|  |  | 2025 | 28442 | 0 | 78.44% | 78.44% (36,259) |
| `assist_tackle_2_player_id` | full cleaned play population | 2023 | 33171 | 0 | 88.30% | 88.30% (37,568) |
|  |  | 2024 | 31271 | 0 | 84.83% | 84.83% (36,861) |
|  |  | 2025 | 29109 | 0 | 80.28% | 80.28% (36,259) |
| `assist_tackle_3_player_id` | full cleaned play population | 2023 | 37568 | 0 | 100.00% | 100.00% (37,568) |
|  |  | 2024 | 36859 | 0 | 99.99% | 99.99% (36,861) |
|  |  | 2025 | 36258 | 0 | 100.00% | 100.00% (36,259) |
| `assist_tackle_4_player_id` | full cleaned play population | 2023 | 37568 | 0 | 100.00% | 100.00% (37,568) |
|  |  | 2024 | 36859 | 0 | 99.99% | 99.99% (36,861) |
|  |  | 2025 | 36258 | 0 | 100.00% | 100.00% (36,259) |
| `pass_defense_1_player_id` | full cleaned play population | 2023 | 35272 | 0 | 93.89% | 93.89% (37,568) |
|  |  | 2024 | 34662 | 0 | 94.03% | 94.03% (36,861) |
|  |  | 2025 | 34005 | 0 | 93.78% | 93.78% (36,259) |
| `pass_defense_2_player_id` | full cleaned play population | 2023 | 37458 | 0 | 99.71% | 99.71% (37,568) |
|  |  | 2024 | 36774 | 0 | 99.76% | 99.76% (36,861) |
|  |  | 2025 | 36156 | 0 | 99.72% | 99.72% (36,259) |
| `forced_fumble_player_1_player_id` | full cleaned play population | 2023 | 37141 | 0 | 98.86% | 98.86% (37,568) |
|  |  | 2024 | 36455 | 0 | 98.90% | 98.90% (36,861) |
|  |  | 2025 | 35925 | 0 | 99.08% | 99.08% (36,259) |
| `forced_fumble_player_2_player_id` | full cleaned play population | 2023 | 37565 | 0 | 99.99% | 99.99% (37,568) |
|  |  | 2024 | 36859 | 0 | 99.99% | 99.99% (36,861) |
|  |  | 2025 | 36256 | 0 | 99.99% | 99.99% (36,259) |
| `tackle_for_loss_1_player_id` | full cleaned play population | 2023 | 34933 | 0 | 92.99% | 92.99% (37,568) |
|  |  | 2024 | 34222 | 0 | 92.84% | 92.84% (36,861) |
|  |  | 2025 | 33682 | 0 | 92.89% | 92.89% (36,259) |
| `weather` | full cleaned play population | 2023 | 977 | 0 | 2.60% | 2.60% (37,568) |
|  |  | 2024 | 2067 | 0 | 5.61% | 5.61% (36,861) |
|  |  | 2025 | 2700 | 0 | 7.45% | 7.45% (36,259) |

### String empty-string / sentinel scan (all string columns, §6.6)

Counts over the **full** row population per season (not the cleaned subset), so they can exceed the "raw \"\"" column above, which is denominated on cleaned REG rows.

| column | 2023 | 2024 | 2025 |
| --- | ---: | ---: | ---: |
| `surface` | 6182 | 382 | 169 |

## 3. Are any variable definitions/types inconsistent by season?

**Yes** — 1 column(s):

- `goal_to_go`: {"2023":"INT32","2024":"DOUBLE","2025":"DOUBLE"}

## 4. How many clean plays remain for every planned model?

After §6.1 core exclusions + §6.5 REG-only, then each model's §11 population predicate 
(and §6.2 penalty-free where the model fits a physical outcome).

| model | penalty-free | 2023 | 2024 | 2025 | total |
| --- | :---: | ---: | ---: | ---: | ---: |
| M01 Fourth-down action | no | 4046 | 3822 | 3784 | 11,652 |
| M02 Play call: dropback vs designed run | no | 33742 | 33224 | 32726 | 99,692 |
| M03 Shotgun formation | no | 34170 | 33629 | 33159 | 100,958 |
| M04 Dropback terminal action | yes | 20388 | 19824 | 19420 | 59,632 |
| M05 Pass target depth | yes | 18005 | 17508 | 17107 | 52,620 |
| M06 Pass location | yes | 18005 | 17508 | 17107 | 52,620 |
| M07 Target-player selection | yes | 17297 | 16816 | 16414 | 50,527 |
| M08 QB hit on thrown pass | yes | 18006 | 17508 | 17107 | 52,621 |
| M09 Pass result (comp/int/incomplete) | yes | 18006 | 17508 | 17107 | 52,621 |
| M10 Yards after catch | yes | 11643 | 11458 | 11054 | 34,155 |
| M11 Scramble yardage | yes | 981 | 1011 | 1034 | 3,026 |
| M12 Runner selection / designed carry | no | 13050 | 13110 | 12992 | 39,152 |
| M13 Run location / gap | no | 13050 | 13110 | 12992 | 39,152 |
| M14 Designed rushing yardage | yes | 12871 | 12891 | 12800 | 38,562 |
| M17 Sack yardage | yes | 1401 | 1305 | 1279 | 3,985 |
| M20 Field-goal success | no | 1060 | 1115 | 1088 | 3,263 |
| M21 Punt outcome | no | 2263 | 2046 | 1933 | 6,242 |
| M22 Kickoff outcome (2024+ regime) | no | 2698 | 2803 | 2785 | 8,286 |
| M23 Extra point | no | 1169 | 1241 | 1262 | 3,672 |

> Model 22 (kickoff) counts include 2023; per §7 the current-rule kickoff model must **exclude 2023** 
> and use 2024+2025 only. Onside kicks (matched via `desc` "kicks onside") must also be removed — 
> see question 9.

## 5. Are qb_dropback / rush_attempt / qb_scramble / sack classifications mutually coherent?

Counts of each flag combination across the **full** row population (not just clean rows), so genuine 
data contradictions surface:

| combination | 2023 | 2024 | 2025 |
| --- | ---: | ---: | ---: |
| qb_dropback==1 & play_type=='run' | 1096 | 1133 | 1149 |
|   ...of which qb_scramble==1 | 1096 | 1133 | 1149 |
| qb_scramble==1 & qb_dropback==0 | 86 | 78 | 72 |
| qb_scramble==1 & rush_attempt==0 | 86 | 78 | 72 |

**Coherent overall.** `sack & qb_scramble`, `qb_dropback & rush_attempt & !qb_scramble`, `pass_attempt & rush_attempt`, `complete_pass & !pass_attempt` and `sack & !qb_dropback` are all **0** in every season (they do not appear in the table). The one recurring mismatch: **`qb_scramble == 1 & qb_dropback == 0`** (~72–86 / season) — a small set of scrambles nflverse does not flag as dropbacks (and also `rush_attempt == 0`). Model 04's population (`qb_dropback == 1`) would **miss** these; Model 11's population (`qb_scramble == 1`) catches them. The spec's derived `qb_player_id` (§11 M04 / §13.2) already bridges THROW/SACK/SCRAMBLE, but each model script should note whether it keys on `qb_dropback` or `qb_scramble` for its population.

**§28.1 — `qb_dropback == 1 & play_type == "run"`:** these are QB scrambles (nflverse tags the run 
play_type but keeps `qb_dropback == 1`). Model 04's population is `qb_dropback == 1`, so they are 
**included** there; Model 12/14's population is `rush_attempt == 1 & qb_scramble == 0`, so they are 
**excluded** from designed carries. The internally-inconsistent case (`qb_dropback == 1 & 
play_type == "run" & qb_scramble == 0`) is listed individually below.

- 2023: **0** internally-inconsistent rows.
- 2024: **0** internally-inconsistent rows.
- 2025: **0** internally-inconsistent rows.

## 6. How complete are run_gap and run_location?

- `run_location` — 2023: raw 62.5% / applicable 0.1% of 14,085  ·  2024: raw 61.6% / applicable 0.1% of 14,172  ·  2025: raw 61.2% / applicable 0.0% of 14,081
- `run_gap` — 2023: raw 72.4% / applicable 26.5% of 14,085  ·  2024: raw 71.3% / applicable 25.2% of 14,172  ·  2025: raw 71.6% / applicable 26.9% of 14,081

Denominator is `play_type == "run"`. If `run_gap` applicable-missingness is high, §11 Model 13 
says fit LEFT/MIDDLE/RIGHT from `run_location` as the primary V1 target and use `run_gap` only where reliable.

## 7. How complete are air_yards, qb_hit, cp/cpoe, and xyac fields?

- `air_yards` — 2023: raw 51.3% / applicable 7.2% of 19,657  ·  2024: raw 51.7% / applicable 6.9% of 19,052  ·  2025: raw 51.9% / applicable 6.9% of 18,645
- `qb_hit` — 2023: raw 0.0% / applicable 0.0% of 37,568  ·  2024: raw 0.0% / applicable 0.0% of 36,861  ·  2025: raw 0.0% / applicable 0.0% of 36,259
- `cp` — 2023: raw 53.5% / applicable 11.1% of 19,657  ·  2024: raw 53.9% / applicable 10.7% of 19,052  ·  2025: raw 54.2% / applicable 10.9% of 18,645
- `cpoe` — 2023: raw 53.5% / applicable 11.1% of 19,657  ·  2024: raw 53.9% / applicable 10.7% of 19,052  ·  2025: raw 54.2% / applicable 10.9% of 18,645
- `xyac_mean_yardage` — 2023: raw 56.4% / applicable 3.5% of 11,808  ·  2024: raw 57.1% / applicable 4.0% of 11,629  ·  2025: raw 57.3% / applicable 4.0% of 11,217
- `xyac_success` — 2023: raw 56.4% / applicable 3.5% of 11,808  ·  2024: raw 57.1% / applicable 4.0% of 11,629  ·  2025: raw 57.3% / applicable 4.0% of 11,217
- `xyac_fd` — 2023: raw 56.4% / applicable 3.5% of 11,808  ·  2024: raw 57.1% / applicable 4.0% of 11,629  ·  2025: raw 57.3% / applicable 4.0% of 11,217

`cp`, `cpoe`, `xyac_*` are **BENCHMARK_ONLY** (§9) regardless of completeness — compare model output 
to them, do not fit on them.

## 8. How complete are tackle / sack / INT attribution fields?

| field | denominator | 2023 non-null (%) | 2024 non-null (%) | 2025 non-null (%) |
| --- | --- | ---: | ---: | ---: |
| `solo_tackle_1_player_id` | rush / completion / scramble | 20,361 (73.12%) | 20,167 (72.82%) | 20,622 (75.91%) |
| `solo_tackle_2_player_id` | rush / completion / scramble | 58 (0.21%) | 48 (0.17%) | 58 (0.21%) |
| `assist_tackle_1_player_id` | rush / completion / scramble | 8,512 (30.57%) | 8,711 (31.45%) | 8,880 (32.69%) |
| `assist_tackle_2_player_id` | rush / completion / scramble | 4,787 (17.19%) | 6,144 (22.18%) | 8,177 (30.10%) |
| `sack_player_id` | sack == 1 | 1,269 (86.98%) | 1,238 (88.94%) | 1,184 (87.57%) |
| `half_sack_1_player_id` | sack == 1 | 179 (12.27%) | 144 (10.34%) | 159 (11.76%) |
| `half_sack_2_player_id` | sack == 1 | 179 (12.27%) | 144 (10.34%) | 159 (11.76%) |
| `interception_player_id` | interception == 1 | 443 (100.00%) | 405 (100.00%) | 406 (100.00%) |
| `forced_fumble_player_1_player_id` | rush / completion / scramble | 458 (1.64%) | 452 (1.63%) | 396 (1.46%) |
| `tackle_for_loss_1_player_id` | rush / completion / scramble | 2,772 (9.96%) | 2,805 (10.13%) | 2,717 (10.00%) |

These support Models 17–19 stat-credit and validation only; PBP does not name every on-field defender, 
so no per-snap defender-choice model is fittable from PBP (spec §11 M18).

## 9. Do 2024–2025 kickoff fields behave consistently under the new rule regime?

| metric | 2023 | 2024 | 2025 |
| --- | ---: | ---: | ---: |
| kickoff plays | 2,838 | 2,949 | 2,918 |
| onside (by desc) | 44 | 54 | 53 |
| mean kick_distance | 63.3 | 62.9 | 59.8 |
| touchback rate | 73.2% | 63.8% | 20.9% |
| return rate | 21.4% | 33.2% | 74.1% |
| mean return yards | 5.0 | 9.2 | 19.3 |

The 2023 row differs materially (old kickoff rule) — do not pool it. **2024 and 2025 also differ sharply** 
(touchback 64% → 21%, mean return yards 9 → 19): dynamic-kickoff behaviour shifted again 
between 2024 and 2025. Model 22 should carry a season/regime indicator, or fit 2025 alone if 2024 is 
unrepresentative of current behaviour. Onside kicks (`desc` "kicks onside") are a separate event (§11 M22).

### §17.1 — roof / temp / wind

| roof | 2023 n | 2024 n | 2025 n | temp null% (2025) | wind null% (2025) |
| --- | ---: | ---: | ---: | ---: | ---: |
| `closed` | 5,837 | 7,818 | 7,337 | 97.55% | 97.55% |
| `dome` | 9,233 | 9,282 | 8,614 | 100.00% | 100.00% |
| `open` | 1,999 | 0 | 0 | n/a | n/a |
| `outdoors` | 32,596 | 32,392 | 32,820 | 2.07% | 2.07% |

Per §17.1: `temp`/`wind` are structurally null for `roof in {dome, closed}` (confirmed: ~98% and 
100% in 2025) — treat `roof` as a required categorical everywhere temp/wind are used; for dome/closed 
feed a "controlled environment" indicator instead of temp/wind. The spec's predicted `roof == "open"` 
category **is present in 2023** (1,999 rows) but absent in 2024–2025 — the model must accept it.

## 10. Player-sheet metadata inconsistencies affecting roster construction

`players_local_final.csv`: **1987 players**, 71 columns.

**`free_agent` is not a usable roster-status signal in this file.** Distinct values: `true`.

| free_agent | nfl_team is a real team | nfl_team is FA/blank |
| --- | ---: | ---: |
| true | 1984 | 3 |
| false | 0 | 0 |

`free_agent` is `true` for **every** player, and 1984 of 1987 of them carry a real `nfl_team` (the other 3 are on `FA`). The whole league was imported as a fantasy-draft pool, so the flag carries no roster-status information. Per the §1.2 QA rule, build the active-role reference pool and any depth logic from `nfl_team` + the game's roster system, **not** from `free_agent`.

Retired: 0 (0 of them still carry a team).

Position vocabulary (15): CB:229, WR:222, DT:191, ILB:191, EDGE:186, S:175, RB:154, OT:149, TE:133, OG:129, QB:81, C:70, K:41, P:34, OLB:2.

Teams (33): ARI:74, NYG:73, MIA:72, KC:70, NYJ:70, NO:67, CLE:66, DET:66, SF:66, WAS:66, BUF:65, IND:65, ATL:64, GB:63, PIT:62, HOU:62, DAL:60, MIN:60, TEN:60, LAC:59, NE:59, DEN:58, CIN:57, BAL:57, CHI:57, CAR:56, LV:56, LA:56, PHI:55, JAX:55, SEA:54, TB:54, FA:3.

Attribute fill (non-null / total; `null` = "not applicable at this position", not a low rating — §2):

| attribute | non-null | attribute | non-null | attribute | non-null |
| --- | ---: | --- | ---: | --- | ---: |
| `speed` | 1987 | `acceleration` | 1987 | `strength` | 1987 |
| `agility` | 1987 | `awareness` | 1987 | `injury` | 1987 |
| `stamina` | 1987 | `toughness` | 1987 | `jumping` | 1292 |
| `throw_power` | 81 | `throw_accuracy_short` | 81 | `throw_accuracy_mid` | 81 |
| `throw_accuracy_deep` | 81 | `play_action` | 81 | `break_sack` | 81 |
| `scrambling` | 81 | `clutch` | 122 | `carrying` | 154 |
| `break_tackle` | 509 | `ball_carrier_vision` | 154 | `juke_move` | 154 |
| `stiff_arm` | 154 | `spin_move` | 154 | `catching` | 509 |
| `pass_block` | 635 | `yac` | 509 | `route_running_short` | 355 |
| `route_running_mid` | 355 | `route_running_deep` | 355 | `release` | 222 |
| `catch_in_traffic` | 355 | `spectacular_catch` | 355 | `run_block` | 481 |
| `pass_block_power` | 348 | `pass_block_finesse` | 348 | `anchor` | 348 |
| `line_calls` | 348 | `snap_accuracy` | 70 | `power_moves` | 377 |
| `finesse_moves` | 377 | `block_shedding` | 570 | `pursuit` | 974 |
| `tackle` | 974 | `run_defense` | 377 | `hit_power` | 745 |
| `play_recognition` | 974 | `zone_coverage` | 597 | `man_coverage` | 597 |
| `blitz` | 193 | `press` | 229 | `kick_power` | 41 |
| `kick_accuracy` | 41 | `punt_power` | 34 | `punt_accuracy` | 34 |
| `hang_time` | 34 | `coffin_corner` | 34 |  |  |

## §28.2 — two-point / non-down administrative plays

`down is null` (§6.1) must fully capture administrative non-down plays. Verification:

| flag | 2023 count | 2024 count | 2025 count | 2023 with down≠null | 2024 with down≠null | 2025 with down≠null |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `two_point_attempt` | 132 | 148 | 130 | 0 | 0 | 0 |
| `extra_point_attempt` | 1,238 | 1,302 | 1,324 | 0 | 0 | 0 |
| `kickoff_attempt` | 2,838 | 2,949 | 2,918 | 0 | 0 | 0 |

✅ Every two-point, extra-point and kickoff play has `down is null`. Models that rely on the centralized §6.1 filter (rather than filtering `down` themselves) are safe **provided that filter runs first** — each model script must state this dependency explicitly (§28.2).

## Summary of discrepancies vs the spec

1. Data files delivered also include `play_by_play_2020–2022.parquet`; per §0/§6.5 only 2023–2025 are used as the production baseline and only those three were audited.
2. `players_local_final.csv` == the repo's `data/players.local.csv` (byte-identical); kept under the spec's filename in `data/` for reference. Git-ignored (`/data/*.csv`).
3. `free_agent` is uniformly `true` with real teams — not a roster-status signal (question 10).
4. Everything else the audit checked matches the spec; see per-question sections above.

## Sign-off gate

Per §28: **do not proceed to model fitting until this report has been reviewed.**


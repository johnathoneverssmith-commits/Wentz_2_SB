# NFL Simulation Engine — Empirical Modeling & Variable Mapping Specification
## Claude Code Build Contract
### Version 1.0 — based on nflverse play-by-play 2023–2025 + existing player ratings

---

## 0. PURPOSE AND NON-NEGOTIABLE DESIGN RULES

Build the statistical backbone for a stochastic, play-by-play NFL simulation engine.

The engine must **not** generate a final score first and back-fill stats. It must generate each play sequentially, and team/player game statistics must emerge from those simulated events.

There are three distinct layers:

1. **Empirical NFL baseline layer**  
   Learn league-average conditional probabilities and outcome distributions from the 2023, 2024, and 2025 nflverse play-by-play Parquet files.

2. **Existing player-rating layer**  
   Use the already-created player attributes in `players_local_final.csv`. Do **not** derive replacement player ratings from nflverse. Do **not** alter the ratings merely because a historical model produces a different estimate of player quality.

3. **Rating-effect calibration layer**  
   Calibrate how strongly the existing ratings perturb the empirical NFL baselines. nflverse does not contain these game ratings, so these coefficients are not directly identifiable from play-by-play alone. They must be calibrated against historical residual variance and simulation-level distribution targets, with explicit constraints and documentation.

### Non-negotiable rules

- `overall` is UI/franchise information only. Never use `overall` directly in a play-outcome equation.
- Never use a downstream event to predict an upstream event.
- Never use EPA, WPA, final score, betting lines, or post-play score fields as causal inputs to play-resolution models.
- nflverse-derived fields such as `xpass`, `cp`, `cpoe`, and `xyac_*` are initially **benchmark/validation variables**, not automatically model inputs.
- Every probability model must be calibrated and evaluated out of sample.
- Every numeric coefficient used by the simulator must live in config/model artifacts, not as unexplained magic numbers scattered through source code.
- Every simulator function must use a seeded RNG supplied by the game engine.
- The 1999 CSV is a **schema reference only**. Do not use 1999 plays to fit the current-era probability backbone unless explicitly instructed later.
- Primary current-era training data are the 2023–2025 Parquets.
- Kickoff models must treat the 2024 rule change as a separate regime; do not pool 2023 kickoffs with 2024–2025 kickoffs.

---

# 1. INPUT DATA

## 1.1 Empirical play-by-play files

Primary modeling data:

```text
play_by_play_2023.parquet
play_by_play_2024.parquet
play_by_play_2025.parquet
```

Schema reference:

```text
play_by_play_1999.csv
```

The reference CSV contains 372 fields and demonstrates the expected nflverse schema, including:

```text
play_id
game_id
home_team
away_team
season_type
week
posteam
defteam
yardline_100
quarter_seconds_remaining
half_seconds_remaining
game_seconds_remaining
qtr
down
goal_to_go
ydstogo
play_type
yards_gained
shotgun
no_huddle
qb_dropback
qb_kneel
qb_spike
qb_scramble
pass_length
pass_location
air_yards
yards_after_catch
run_location
run_gap
field_goal_result
kick_distance
posteam_timeouts_remaining
defteam_timeouts_remaining
score_differential
interception
fumble_lost
qb_hit
rush_attempt
pass_attempt
sack
touchdown
pass_touchdown
rush_touchdown
field_goal_attempt
kickoff_attempt
punt_attempt
fumble
complete_pass
passer_player_id
receiver_player_id
rusher_player_id
interception_player_id
qb_hit_1_player_id
qb_hit_2_player_id
sack_player_id
half_sack_1_player_id
half_sack_2_player_id
solo_tackle_1_player_id
assist_tackle_*_player_id
pass_defense_*_player_id
forced_fumble_player_*_player_id
kicker_player_id
punter_player_id
return_yards
penalty
penalty_type
penalty_yards
season
cp
cpoe
roof
surface
temp
wind
home_coach
away_coach
out_of_bounds
xyac_mean_yardage
xyac_median_yardage
xyac_success
xyac_fd
xpass
pass_oe
```

The first action in Claude Code must be to verify that the 2023–2025 Parquet schemas contain the required fields and document any differences.

---

## 1.2 Existing player-ratings file

Use:

```text
players_local_final.csv
```

This file contains 1,987 players and 71 columns.

Identity / franchise fields include:

```text
id
name
position
age
nfl_team
years_pro
overall
dev_age_threshold
decline_age_threshold
free_agent
retired
scheme_tags
```

General athletic / mental fields include:

```text
speed
acceleration
strength
agility
awareness
injury
stamina
toughness
jumping
```

Specialized fields include:

```text
anchor
ball_carrier_vision
blitz
block_shedding
break_sack
break_tackle
carrying
catch_in_traffic
catching
clutch
coffin_corner
finesse_moves
hang_time
hit_power
juke_move
kick_accuracy
kick_power
line_calls
man_coverage
pass_block
pass_block_finesse
pass_block_power
play_action
play_recognition
power_moves
press
punt_accuracy
punt_power
pursuit
release
route_running_deep
route_running_mid
route_running_short
run_block
run_defense
scrambling
snap_accuracy
spectacular_catch
spin_move
stiff_arm
tackle
throw_accuracy_deep
throw_accuracy_mid
throw_accuracy_short
throw_power
yac
zone_coverage
```

Do not create new player skill ratings unless a later specification explicitly requests them.

### Important QA rule

Do not assume every metadata field is trustworthy without validation. In particular, validate roster-status fields such as `free_agent` against `nfl_team` before using them for roster construction. Gameplay ability attributes are the authoritative inputs for the rating layer; roster/depth-chart logic should come from the existing game roster system where available.

---

# 2. PLAYER ATTRIBUTE AVAILABILITY BY POSITION

The current player sheet uses position-specific nullable attributes. Treat `null` as “attribute not applicable,” not as a low rating.

The major available groups are:

## QB

```text
speed
acceleration
strength
agility
awareness
stamina
break_sack
play_action
scrambling
throw_accuracy_deep
throw_accuracy_mid
throw_accuracy_short
throw_power
```

## RB

```text
speed
acceleration
strength
agility
awareness
stamina
jumping
ball_carrier_vision
break_tackle
carrying
catching
juke_move
pass_block
spin_move
stiff_arm
yac
```

## WR

```text
speed
acceleration
strength
agility
awareness
stamina
jumping
break_tackle
catch_in_traffic
catching
release
route_running_deep
route_running_mid
route_running_short
spectacular_catch
yac
```

## TE

```text
speed
acceleration
strength
agility
awareness
stamina
jumping
break_tackle
catch_in_traffic
catching
pass_block
route_running_deep
route_running_mid
route_running_short
run_block
spectacular_catch
yac
```

## OT / OG / C

```text
speed
acceleration
strength
agility
awareness
stamina
anchor
line_calls
pass_block
pass_block_finesse
pass_block_power
run_block
```

Centers additionally have:

```text
snap_accuracy
```

## EDGE / DT

```text
speed
acceleration
strength
agility
awareness
stamina
block_shedding
finesse_moves
hit_power
play_recognition
power_moves
pursuit
run_defense
tackle
```

## ILB / OLB

```text
speed
acceleration
strength
agility
awareness
stamina
jumping
blitz
block_shedding
hit_power
man_coverage
play_recognition
pursuit
tackle
zone_coverage
```

## CB

```text
speed
acceleration
strength
agility
awareness
stamina
jumping
man_coverage
play_recognition
press
pursuit
tackle
zone_coverage
```

## S

```text
speed
acceleration
strength
agility
awareness
stamina
jumping
hit_power
man_coverage
play_recognition
pursuit
tackle
zone_coverage
```

## K

```text
kick_accuracy
kick_power
```

plus general athletic fields.

## P

```text
coffin_corner
hang_time
punt_accuracy
punt_power
```

plus general athletic fields.

---

# 3. RATING NORMALIZATION

Do not use the prior provisional transformation `(rating - 80) / 8` as the final method.

Instead, construct a standardized rating variable for every applicable attribute:

```text
attribute_z = (rating - reference_mean_attribute) / reference_sd_attribute
```

with:

```text
attribute_z = clip(attribute_z, -3.0, +3.0)
```

### Reference population

The empirical nflverse baseline reflects actual NFL players receiving snaps, not the mean of every reserve/free agent in the player database. Therefore, zero must represent approximately an **average meaningful-snap NFL player**, not the average of all 1,987 rows.

Build an “active-role reference pool” from the current roster data/depth-chart system. If explicit depth charts already exist in the codebase, use them.

If no depth charts exist yet, use the following temporary reference-pool approximation by team:

```text
QB: top 1
RB: top 2
WR: top 4
TE: top 2
OT: top 2
OG: top 2
C: top 1
EDGE: top 3
DT: top 3
ILB/OLB: top 3 combined
CB: top 4
S: top 3
K: top 1
P: top 1
```

Ranking for this temporary reference pool may use `overall` because this is only defining the active-player population, not resolving plays.

For each attribute, calculate the mean and SD over all players in the active-role reference pool for whom that attribute is non-null.

Examples:

```text
throw_accuracy_short reference pool -> active QBs
catching -> active RB/WR/TE players with catching ratings
route_running_short -> active WR/TE players
pass_block -> active OL/RB/TE players with pass_block ratings
man_coverage -> active CB/S/LB players with man_coverage ratings
tackle -> active defensive players with tackle ratings
```

Persist these reference means/SDs in:

```text
artifacts/ratings/attribute_reference_stats.json
```

Do not silently substitute a value for a null attribute.

---

# 4. EVENT CHRONOLOGY

The simulator must enforce this event order so no downstream outcome leaks into an upstream model.

```text
PRE-SNAP STATE
    |
    +--> Administrative decision
    |       kneel / spike / timeout logic where applicable
    |
    +--> Fourth-down action (only if down == 4)
    |       GO / FIELD_GOAL / PUNT
    |
    +--> Normal offensive play call
    |       DROPBACK / DESIGNED_RUN
    |
    +--> Formation state (V1: SHOTGUN vs NOT_SHOTGUN)
    |
    +--> PASS BRANCH
    |       |
    |       +--> dropback outcome
    |       |       THROW / SACK / SCRAMBLE
    |       |
    |       +--> if THROW:
    |       |       target depth
    |       |       pass location
    |       |       target player/role
    |       |       QB hit on throw
    |       |       pass result: COMPLETE / INT / OTHER_INCOMPLETE
    |       |       if COMPLETE: YAC
    |       |       fumble
    |       |
    |       +--> if SACK:
    |       |       sack yards
    |       |       sack credit
    |       |       fumble
    |       |
    |       +--> if SCRAMBLE:
    |               scramble yards
    |               tackle attribution
    |               fumble
    |
    +--> RUN BRANCH
    |       |
    |       +--> runner selection
    |       +--> run location / gap
    |       +--> rushing yards
    |       +--> tackle attribution
    |       +--> fumble
    |
    +--> STATE UPDATE
            first down
            touchdown
            safety
            possession
            score
            clock
            field position
            stats
```

First downs and touchdowns are normally **deterministic consequences of the simulated yardage and field position**, not separate probability models.

---

# 5. UNIVERSAL PRE-SNAP STATE VARIABLES

These are the primary historical state predictors.

```text
season
season_type
week

game_id
play_id

posteam
defteam
posteam_type

qtr
quarter_seconds_remaining
half_seconds_remaining
game_seconds_remaining

down
ydstogo
yardline_100
goal_to_go

score_differential

posteam_timeouts_remaining
defteam_timeouts_remaining
```

Derived variables may include:

```text
is_home_offense
seconds_remaining_game
seconds_remaining_half
red_zone
backed_up
goal_to_go_flag
score_abs
leading
trailing
score_tied
late_half
late_game
two_minute_state
short_yardage
long_yardage
```

Do not bucket continuous variables merely because it is convenient. Fit nonlinear continuous effects where practical, and use buckets primarily for diagnostics and empirical fallback tables.

---

# 6. GLOBAL DATA CLEANING RULES

Create centralized filtering functions. Do not duplicate ad hoc filters inside each model script.

## 6.1 Core row exclusions

Unless a specific model says otherwise, exclude rows where any of the following apply:

```text
play_deleted == 1
aborted_play == 1
play_type == "no_play"
posteam is null
down is null
yardline_100 is null
```

Exclude administrative rows that are not actual offensive snaps.

## 6.2 Penalties

Penalty handling differs by model.

### Play-choice models

A live-ball penalty can occur after a genuine play call. Therefore:

- exclude `no_play` penalties such as false starts;
- retain a penalty play only when the underlying pass/dropback or designed-run classification is unambiguous.

### Physical outcome models

For V1 baseline fitting, use **penalty-free plays**:

```text
penalty != 1
```

or an equivalent clean-play flag.

Do this for:

```text
completion/pass-result modeling
air-yard modeling
YAC
rush yards
sack yards
scramble yards
punt returns
```

This prevents enforced penalty yardage from contaminating physical-outcome distributions.

Penalties will be added as a separate V1.5 module.

## 6.3 Kneels and spikes

Never treat:

```text
qb_kneel == 1
qb_spike == 1
```

as ordinary rushing/passing plays.

Model or hard-code them separately.

## 6.4 Lateral / rare-event plays

Exclude lateral plays from V1 statistical fitting unless the specific model is explicitly designed for them:

```text
lateral_reception
lateral_rush
lateral_return
lateral_recovery
```

The simulator may handle these as rare-event extensions later.

## 6.5 Season population

Primary production baseline:

```text
season_type == "REG"
season in {2023, 2024, 2025}
```

Postseason data may be used as a robustness check but should not silently change the production baseline.

## 6.6 Missingness convention

All missingness statistics produced anywhere in this project — the schema
audit, the data-quality report, and any later per-model diagnostics — must be
computed against the correct applicable-population denominator for that
field, not against the full play population. Examples:

- `run_gap`, `run_location` → denominator is `play_type == "run"`
- `air_yards`, `pass_length`, `pass_location`, `cp`, `cpoe` → denominator is
  `play_type == "pass"`
- `xyac_mean_yardage`, `xyac_median_yardage`, `xyac_success`, `xyac_fd` →
  denominator is completed passes (`play_type == "pass" and complete_pass == 1`)
- `kick_distance`, `field_goal_result` → denominator is `play_type == "field_goal"`
- `penalty_type`, `penalty_yards` → denominator is `penalty == 1`

Any report that states a missingness percentage must report both the raw
(full-population) figure and the applicable-population figure side by side,
labeled clearly, so the difference is visible rather than silently resolved.

Missingness checks must also test for empty-string and whitespace-only
sentinel values in string/categorical columns, not only true nulls
(`pd.isna`/`NaT`/`None`). Report both counts separately: true-null count and
empty-string/sentinel count. `surface` is a confirmed example in the 2025
data (169 rows with `""` instead of a null or a real surface value) — check
all string columns for this pattern, not just the ones already known to have
it.

---

# 7. DATA SPLIT AND MODEL-SELECTION PROTOCOL

Do not randomly split individual plays across train/test sets.

Use rolling, chronological evaluation:

### Development pass

```text
Train: 2023
Validate: 2024
```

Use this stage to choose:

```text
features
functional form
regularization
distribution family
hyperparameters
```

### Locked evaluation pass

After architecture/hyperparameters are frozen:

```text
Train: 2023 + 2024
Test: 2025
```

Do not tune on the 2025 test results.

### Production refit

After the model passes the locked 2025 evaluation:

```text
Refit final production model on 2023 + 2024 + 2025
```

Store the 2025 holdout results before refitting.

### Kickoff exception

Because of the modern kickoff-rule regime:

```text
2023 kickoff data: do not pool into current-rule model
Development: 2024
Locked test: 2025
Production refit: 2024 + 2025
```

---

# 8. BASELINE MODELING TOOLKIT

Every submodel must begin with the simplest defensible baseline.

## Binary outcomes

Primary candidate:

```text
regularized logistic regression
```

with spline/nonlinear transforms for variables such as:

```text
ydstogo
yardline_100
game_seconds_remaining
score_differential
air_yards
kick_distance
wind
```

A practical implementation is:

```text
sklearn.preprocessing.SplineTransformer
+
OneHotEncoder
+
LogisticRegression
```

Challenger:

```text
HistGradientBoostingClassifier
```

or another well-calibrated tree model already supported in the project.

Do not choose the more complicated model merely because discrimination is slightly higher.

## Multiclass outcomes

Use:

```text
multinomial logistic regression
```

as the baseline, with a tree-based challenger if needed.

## Continuous / yardage outcomes

Do not default to Gaussian regression.

Use:

```text
multistage categorical distribution
+
empirical exact-yard distribution within category
```

or another explicitly distributional model.

This is preferred for V1 because football yardage is discrete, asymmetric, zero-heavy, and long-tailed.

## Model-selection metrics

For binary probabilities:

```text
log loss
Brier score
calibration intercept
calibration slope
reliability curve
expected calibration error
```

ROC-AUC may be reported, but must not drive selection.

For multiclass probabilities:

```text
multiclass log loss
Brier-type probability score
classwise calibration
```

For distributional outputs:

```text
held-out log likelihood when available
CRPS when practical
quantile coverage
Wasserstein distance / distributional distance
mean
variance
key tail frequencies
```

Always compare conditional distributions as well as global averages.

---

# 9. BENCHMARK-ONLY NFLVERSE VARIABLES

The following fields are valuable, but their feature-generation history may not match the simulator chronology. Therefore they are benchmark/validation variables in V1:

```text
xpass
pass_oe

cp
cpoe

xyac_mean_yardage
xyac_median_yardage
xyac_success
xyac_fd
xyac_epa

ep
epa
wp
wpa
vegas_wp
vegas_wpa
```

Rules:

- Compare the new pass-call model to `xpass`.
- Compare the new completion model to `cp`.
- Compare YAC distributions to `xyac_*`.
- Do not automatically place these variables inside the fitted model.
- If Claude later proposes using one directly, first document exactly what information nflverse used to construct it and verify no chronology conflict.

---

# 10. VARIABLES NEVER TO USE AS CORE OUTCOME PREDICTORS

These are downstream, outcome-derived, market-derived, or otherwise inappropriate for the causal simulation chain.

Examples:

```text
posteam_score_post
defteam_score_post
score_differential_post

epa
air_epa
yac_epa
qb_epa
wpa
wp
home_wp
away_wp
vegas_wp
vegas_wpa

success
series_success
series_result

first_down_rush
first_down_pass
third_down_converted
third_down_failed
fourth_down_converted
fourth_down_failed

touchdown
pass_touchdown
rush_touchdown

drive_ended_with_score
fixed_drive_result

spread_line
total_line
result
total

yards_gained
```

`yards_gained` is obviously the target for yardage models, but it must never be used as a predictor for an event that happens earlier in the same play.

The same principle applies to every target: a variable may be valid as a target but invalid as an upstream predictor.

`desc` should be used for QA/debugging only, not as a model feature in V1.

---

# 11. MODEL REGISTRY

The production simulator should contain the following empirical resolvers.

---

## MODEL 01 — Fourth-down action

### Purpose

When `down == 4`, choose:

```text
GO_FOR_IT
FIELD_GOAL
PUNT
```

Administrative kneels/spikes are handled separately.

### Population

```text
down == 4
valid offensive snap/action
not no_play
qb_kneel == 0
qb_spike == 0
```

### Historical target construction

```text
FIELD_GOAL if field_goal_attempt == 1
PUNT if punt_attempt == 1
GO_FOR_IT otherwise if a normal offensive play occurred
```

Exclude `qb_kneel == 1` and `qb_spike == 1` rows entirely — these are not a
GO/FIELD_GOAL/PUNT decision and must not enter this model's population,
consistent with the global rule in §6.3.

### Allowed predictors

```text
ydstogo
yardline_100
goal_to_go
qtr
game_seconds_remaining
half_seconds_remaining
score_differential
posteam_timeouts_remaining
defteam_timeouts_remaining
roof
wind
temp
```

Environment should remain only if it improves held-out calibration.

### Grouping / tendencies

```text
posteam
home_coach / away_coach
season
```

Use these for shrunken team/coach tendency effects, not as permanent fixed-category inputs to the league baseline.

### Model

```text
multinomial logistic regression
```

### Player modifiers

None directly, except a possible later kicker-range feasibility constraint based on:

```text
kick_power
```

Do not let kicker overall determine fourth-down aggression.

### Output

```text
P(go)
P(field_goal)
P(punt)
```

---

## MODEL 02 — Normal play call: dropback vs designed run

### Purpose

For ordinary offensive snaps, choose:

```text
DROPBACK
DESIGNED_RUN
```

### Population

Exclude:

```text
4th-down kicks/punts
qb_kneel
qb_spike
no_play
special teams
```

### Target construction

Preferred:

```text
DROPBACK if qb_dropback == 1
DESIGNED_RUN if rush_attempt == 1 and qb_scramble != 1
```

Audit all ambiguous rows and document their frequency.

### Allowed predictors

```text
down
ydstogo
yardline_100
goal_to_go
qtr
game_seconds_remaining
half_seconds_remaining
score_differential
posteam_timeouts_remaining
defteam_timeouts_remaining
is_home_offense
```

### Do not use

```text
shotgun
no_huddle
air_yards
qb_hit
sack
yards_gained
```

unless formation/tempo is explicitly simulated earlier in chronology.

### Grouping

```text
posteam
season
coach
```

Estimate shrunken offensive tendency residuals.

### Model

Binary logistic/spline model.

Benchmark against:

```text
xpass
pass_oe
```

### Player modifiers

None in V1.

Player talent should primarily determine execution, not cause a hidden feedback loop in which a high overall automatically increases usage.

Team/coach strategy may later be influenced by roster talent in a separate AI layer.

---

## MODEL 03 — Shotgun formation

### Purpose

After the broad play call, select:

```text
SHOTGUN
NOT_SHOTGUN
```

### Target

```text
shotgun
```

### Predictors

```text
play_call
down
ydstogo
yardline_100
goal_to_go
score_differential
game_seconds_remaining
no_huddle if tempo has already been selected
posteam tendency
```

### Model

Binary logistic.

### Why it is separate

Shotgun strongly correlates with pass/run choice. Using it to predict the play call without first simulating formation would constitute chronology leakage.

---

## MODEL 04 — Dropback terminal action

### Purpose

For a dropback, choose:

```text
THROW
SACK
SCRAMBLE
```

### Population

```text
qb_dropback == 1
qb_kneel == 0
qb_spike == 0
penalty-free for the primary physical-outcome fit
```

### Target construction

```text
SACK if sack == 1
SCRAMBLE if qb_scramble == 1
THROW otherwise if a pass attempt/throw occurred
```

Audit mutually inconsistent rows.

### Baseline predictors

```text
down
ydstogo
yardline_100
goal_to_go
qtr
game_seconds_remaining
score_differential
shotgun
```

### Grouping variables

Define a unified `qb_player_id` field before grouping:

```text
qb_player_id = passer_player_id if passer_player_id is not null
               else rusher_player_id
```

This is necessary because `passer_player_id` is null on 100% of SCRAMBLE
rows (nflverse doesn't credit a passer when no throw occurs), while
`rusher_player_id` is populated there instead. `passer_player_id` alone is
sufficient for THROW and SACK rows.

```text
qb_player_id
posteam
defteam
season
```

Use only for residual-variance estimation and tendency diagnostics, not as permanent identity features in the portable baseline.

### Model

Multinomial logistic.

### Player-rating modifiers

#### QB

```text
break_sack
scrambling
awareness
speed
acceleration
agility
```

Use:

- `break_sack` primarily to shift SACK -> THROW/SCRAMBLE.
- `scrambling`, speed, acceleration, agility primarily to shift THROW/SACK -> SCRAMBLE.
- `awareness` may provide a modest sack-avoidance/decision modifier.

#### Offensive protection

Use active blockers:

```text
pass_block
pass_block_finesse
pass_block_power
anchor
awareness
line_calls
```

#### Defensive rush

EDGE/DT:

```text
finesse_moves
power_moves
block_shedding
speed
acceleration
strength
play_recognition
```

Blitzing LB:

```text
blitz
speed
acceleration
block_shedding
play_recognition
```

### Critical limitation

nflverse PBP does not provide a clean universal pass-rush pressure variable or exact blocker/rusher assignments. Therefore V1 must not claim to have fitted individual OL-vs-DL win probabilities from PBP.

The **league baseline** for sack/scramble/throw comes from PBP.

The **current-player OL/DL matchup modifier** is a game-rating layer whose magnitude is calibrated against historical offense/defense residual variance.

---

## MODEL 05 — Pass target depth

### Purpose

If the QB throws, sample intended/realized target depth.

### Population

Clean thrown forward passes:

```text
pass_attempt == 1
sack == 0
qb_spike == 0
air_yards not null
penalty == 0
```

### Target representation

Primary V1 target:

```text
BEHIND_LOS   air_yards < 0
SHORT        0 <= air_yards <= 9
INTERMEDIATE 10 <= air_yards <= 19
DEEP         air_yards >= 20
```

After a category is sampled, sample exact `air_yards` from the held-out-validated empirical distribution for that category and context.

### Predictors

```text
down
ydstogo
yardline_100
goal_to_go
qtr
game_seconds_remaining
score_differential
shotgun
```

Optional team tendency residual.

### Do not use

```text
complete_pass
interception
yards_after_catch
yards_gained
cp
cpoe
```

### Player modifiers

Treat target depth as primarily scheme/usage, not ability.

In V1:

- do not let accuracy ratings directly make a QB “choose” more deep passes;
- `throw_power` may impose a modest feasibility modifier on very deep targets, especially 30+ air yards;
- receiver role/depth usage may modify depth probabilities if the roster/depth-chart system exposes that information.

Do not use WR speed as a generic deep-target-frequency multiplier until a distinct route/usage system exists.

### Model

Multinomial logistic + empirical within-bin sampler.

---

## MODEL 06 — Pass location

### Purpose

Sample:

```text
LEFT
MIDDLE
RIGHT
```

### Population

```text
pass_attempt == 1
sack == 0
qb_spike == 0
pass_location not null
penalty-free
```

### Target

```text
pass_location
```

### Predictors

```text
air_yards
depth_category
down
ydstogo
yardline_100
goal_to_go
shotgun
```

### Model

Multinomial logistic or smoothed empirical conditional table.

### Player modifiers

None in V1 unless explicit route/formation alignment data exist in the game roster system.

This model may be omitted from the first executable engine if pass direction does not yet affect matchups.

---

## MODEL 07 — Target-player / target-role selection

### Purpose

Assign the throw to an eligible receiver while preserving realistic target concentration and situational usage.

### Population

```text
pass_attempt == 1
sack == 0
qb_spike == 0
receiver_player_id not null
penalty-free
```

### Historical target

```text
receiver_player_id
```

### Key limitation

PBP identifies the targeted receiver but does not identify every receiver who ran a route on that play. Therefore a true route-level conditional-choice model cannot be fitted from PBP alone.

Do not pretend all rostered receivers were eligible on every historical pass.

### V1 methodology

Build **historical target-role distributions** instead of a route-participation model.

For each team-season:

1. Count valid targets by receiver.
2. Rank receivers by target volume:
   ```text
   TARGET_ROLE_1
   TARGET_ROLE_2
   TARGET_ROLE_3
   TARGET_ROLE_4
   TARGET_ROLE_5_PLUS
   ```
3. Estimate shrunken target-share distributions by role.
4. Estimate situational adjustments by:
   ```text
   depth category
   red zone
   third down
   distance
   two-minute state
   ```
5. Persist league distributions of role shares.

### Current-roster role assignment

Use an explicit depth chart/usage system if already present.

If no explicit usage system exists, create a temporary role assignment using roster position + receiving ability only for ordering players into roles. This is a fallback, not a final target-share model.

Receiving-role ordering may consider:

```text
route_running_short
route_running_mid
route_running_deep
catching
release
```

but the target-share prior itself should come from the empirical role distribution rather than directly from `overall`.

### Important distinction

```text
ability != usage
```

A highly rated receiver may receive fewer targets because of role, personnel, scheme, or teammates.

### Output

Categorical target probabilities across the eligible active receivers.

---

## MODEL 08 — QB hit on a thrown pass

### Purpose

For passes that are actually thrown, determine whether the QB is recorded as hit.

### Population

```text
THROW branch
pass_attempt == 1
sack == 0
qb_spike == 0
penalty-free
```

### Target

```text
qb_hit
```

### Predictors

```text
air_yards
depth_category
down
ydstogo
yardline_100
shotgun
score_differential
game_seconds_remaining
```

Longer-developing throws should naturally show a different hit rate if supported by data.

### Grouping / residuals

```text
posteam
defteam
passer_player_id
season
```

### Player modifiers

Same protection/rush attribute families as Model 04.

Do not double-count the same rating modifier at excessive magnitude in both sack and hit models. Joint sensitivity calibration must constrain total pass-rush impact.

---

## MODEL 09 — Pass result: completion vs interception vs other incompletion

### Purpose

For an actual thrown pass, resolve:

```text
COMPLETE
INTERCEPTION
OTHER_INCOMPLETE
```

This is preferred over unrelated independent completion and interception rolls because the three outcomes are mutually exclusive.

### Population

```text
pass_attempt == 1
sack == 0
qb_spike == 0
penalty-free
```

### Target construction

```text
INTERCEPTION if interception == 1
COMPLETE if complete_pass == 1
OTHER_INCOMPLETE otherwise
```

### Baseline predictors

```text
air_yards
depth_category
pass_location
qb_hit
down
ydstogo
yardline_100
goal_to_go
shotgun
qtr
game_seconds_remaining
```

Use score/time only if they demonstrate out-of-sample value after the throw-difficulty variables are present.

### Benchmark

Compare marginal completion probabilities to:

```text
cp
```

and player-level residual completion performance to:

```text
cpoe
```

Do not automatically feed `cp` or `cpoe` into the production model.

### Model

Multinomial logistic baseline.

A calibrated tree model may challenge it.

### Player-rating modifiers

#### QB completion logit

Choose accuracy by target depth:

```text
BEHIND_LOS / SHORT -> throw_accuracy_short
INTERMEDIATE       -> throw_accuracy_mid
DEEP               -> throw_accuracy_deep
```

Also allow a modest role for:

```text
awareness
```

#### Receiver completion logit

Use:

```text
catching
route_running_short/mid/deep matched to depth
release when press is active
catch_in_traffic only when the simulator has created a contested/tight-window state
spectacular_catch only in explicit high-difficulty catch states
```

Do not apply every catching attribute on every pass.

#### Defender modifier

Coverage is generated from the defender assigned by the game’s coverage/formation logic.

Use:

```text
man_coverage if man
zone_coverage if zone
press if press
play_recognition
speed/acceleration for deep recovery
```

The PBP baseline already contains league-average defensive coverage. Therefore rating modifiers must be centered around zero so an average matchup leaves the empirical baseline unchanged.

### Interception-specific rating terms

QB:

```text
awareness
depth-specific accuracy
```

Defender:

```text
play_recognition
man_coverage or zone_coverage
jumping
```

There is no dedicated `ball_skills` field in the current player sheet, so do not invent one.

---

## MODEL 10 — Yards after catch

### Purpose

If a pass is completed, sample YAC.

### Population

```text
complete_pass == 1
yards_after_catch not null
penalty-free
```

### Target

```text
yards_after_catch
```

### Predictors

```text
air_yards
depth_category
pass_location
yardline_100
goal_to_go
down
ydstogo
```

Field position is important because YAC is censored by the goal line.

### Benchmarks

```text
xyac_mean_yardage
xyac_median_yardage
xyac_success
xyac_fd
```

### Distribution method

Do not use plain Gaussian or Gamma as the only distribution because YAC can be negative, has a large mass near zero, and has a long right tail.

Recommended V1 outcome bins:

```text
YAC_NEGATIVE       < 0
YAC_0_TO_2         0..2
YAC_3_TO_5         3..5
YAC_6_TO_10        6..10
YAC_11_TO_20       11..20
YAC_21_PLUS        >=21
```

Fit category probabilities, then sample exact integer YAC from the empirical within-category distribution conditioned on broad context.

Claude may revise bin cutoffs if the 2023–2025 data show poor sample balance; document any change.

### Player modifiers

Ballcarrier:

```text
yac
speed
acceleration
agility
break_tackle
```

RB may additionally use later:

```text
juke_move
spin_move
stiff_arm
```

but keep these out of the first calibration pass to avoid overparameterization.

Primary defender / pursuit:

```text
tackle
pursuit
speed
acceleration
```

Do not infer a primary historical tackler as the coverage defender from PBP; those are not equivalent concepts.

---

## MODEL 11 — Scramble yardage

### Purpose

If Model 04 selects SCRAMBLE, sample QB rushing yards.

### Population

```text
qb_scramble == 1
penalty-free
```

### Target

```text
yards_gained
```

### Predictors

```text
down
ydstogo
yardline_100
goal_to_go
score_differential
game_seconds_remaining
shotgun
```

### Distribution

Use a categorical yardage distribution + empirical exact-yard sampler.

Suggested initial classes:

```text
LOSS_OR_ZERO <= 0
SHORT         1..4
MEDIUM        5..9
FIRST_DOWN    10..19
EXPLOSIVE     >=20
```

Re-estimate bins if data support better cutoffs.

### Player modifiers

```text
scrambling
speed
acceleration
agility
awareness
```

Defense:

```text
pursuit
tackle
speed
```

---

## MODEL 12 — Runner selection / designed-carry usage

### Purpose

Assign a designed rushing attempt to a current offensive player.

### Historical population

```text
rush_attempt == 1
qb_scramble == 0
qb_kneel == 0
```

### Historical target

```text
rusher_player_id
```

### Limitation

PBP does not identify all players in the huddle or the designed play package. Therefore use a role-share method analogous to target selection.

### V1 methodology

For each team-season:

1. Count designed rush attempts by rusher.
2. Rank:
   ```text
   CARRY_ROLE_1
   CARRY_ROLE_2
   CARRY_ROLE_3
   OTHER
   ```
3. Estimate shrunken carry-share distributions.
4. Estimate situational role changes for:
   ```text
   goal to go
   short yardage
   red zone
   late-game lead
   ```

### Current roster mapping

Use explicit depth chart/role data if available.

Do not make `break_tackle`, `speed`, etc. directly determine carry frequency in the execution engine.

Ability controls outcomes; usage controls opportunities.

---

## MODEL 13 — Run location / gap

### Purpose

For designed rushes, sample the intended location.

### Population

```text
rush_attempt == 1
qb_scramble == 0
qb_kneel == 0
```

### Historical targets

```text
run_location
run_gap
```

Expected values include:

```text
run_location: left / middle / right
run_gap: end / tackle / guard
```

### Missingness rule

Audit missingness in 2023–2025 before choosing the final target.

If `run_gap` is too incomplete, fit:

```text
LEFT
MIDDLE
RIGHT
```

as the primary V1 location model and use run_gap only where reliable.

### Predictors

```text
down
ydstogo
yardline_100
goal_to_go
score_differential
game_seconds_remaining
shotgun
```

### Model

Multinomial logistic or smoothed empirical table.

### Player modifiers

None in V1.

This is primarily a play-calling/scheme decision.

---

## MODEL 14 — Designed rushing yardage

### Purpose

Sample the result of an ordinary designed rush.

### Population

```text
rush_attempt == 1
qb_scramble == 0
qb_kneel == 0
penalty-free
```

### Target

```text
yards_gained
```

### Predictors

```text
run_location
run_gap if reliable
down
ydstogo
yardline_100
goal_to_go
shotgun
qtr
score_differential
game_seconds_remaining
```

### Distribution method

Do not use Normal.

Recommended V1 classes:

```text
MAJOR_LOSS   <= -2
STUFF        -1..1
SHORT_GAIN    2..3
NORMAL_GAIN   4..7
GOOD_GAIN     8..14
EXPLOSIVE    >=15
```

Fit multinomial category probabilities.

Then sample exact integer yards from the empirical distribution inside the selected class and broad context.

The end zone provides a hard upper bound.

### Player modifiers

#### Runner

Primary V1:

```text
ball_carrier_vision
break_tackle
speed
acceleration
agility
strength
```

Do not apply `juke_move`, `spin_move`, and `stiff_arm` until the core rushing model is calibrated.

#### Offensive blocking

OL:

```text
run_block
strength
awareness
```

TE if participating:

```text
run_block
strength
```

#### Front-seven defense

EDGE/DT:

```text
run_defense
block_shedding
strength
play_recognition
pursuit
tackle
```

LB:

```text
block_shedding
play_recognition
pursuit
tackle
strength
```

### Matchup logic

Only players relevant to the selected run location should receive full weight.

Do not average all 11 offensive/defensive players into one generic team rating.

The exact location-to-blocker mapping belongs in the simulation engine, not the PBP baseline model.

---

## MODEL 15 — Fumble occurrence

### Purpose

After a ballcarrier event, determine whether the player fumbles.

### Separate populations

Fit separate baseline hazards for:

```text
designed rush
QB scramble
reception
sack
```

### Target

```text
fumble
```

### Predictors

Use only context logically available by the end of the physical play, e.g.:

```text
event_type
yards_gained or YAC when the fumble roll occurs after yardage
qb_hit / sack state
yardline_100
weather only if supported
```

### Model

Regularized logistic.

Rare-event calibration is required.

### Player modifiers

Ballcarrier:

```text
carrying
```

only when that attribute exists.

Do not fabricate `carrying` ratings for WR/TE/QB.

For positions without `carrying`, retain the position/event baseline unless a later player-specific ball-security attribute is added.

Defender:

```text
hit_power
tackle
```

may modify forced-fumble probability when an identified tackler exists.

### Notes

`fumble_forced` and forced-fumble player IDs may be used for defensive-stat attribution and validation, not as upstream predictors.

---

## MODEL 16 — Fumble recovery / lost

### Purpose

After a fumble, determine possession.

### Targets

```text
fumble_lost
fumble_recovery_1_team
fumble_recovery_1_yards
```

### V1 method

Start with an empirical conditional probability based on event type and field context.

Do not assign recovery probability from player overall.

Rare complex recovery advances may initially be simplified.

---

## MODEL 17 — Sack yardage and sack credit

### Sack yardage

Population:

```text
sack == 1
penalty-free
```

Target:

```text
yards_gained
```

Sample from an empirical discrete distribution conditioned on broad field/down context.

### Sack credit

Use:

```text
sack_player_id
half_sack_1_player_id
half_sack_2_player_id
```

to estimate historical single-vs-split sack frequencies.

For the current simulation, choose the credited defender from the actual active rushers.

Weight candidate rushers by applicable standardized ratings:

EDGE/DT:

```text
finesse_moves
power_moves
block_shedding
speed/acceleration
```

Blitzing LB:

```text
blitz
speed
block_shedding
```

The event probability and the stat-credit selection are separate steps.

---

## MODEL 18 — Tackle / assist attribution

### Purpose

Produce individual defensive tackle statistics after rushes, scrambles, and completed passes.

### Historical fields

```text
solo_tackle
assist_tackle
solo_tackle_1_player_id
solo_tackle_2_player_id
assist_tackle_1_player_id
assist_tackle_2_player_id
assist_tackle_3_player_id
assist_tackle_4_player_id
tackle_with_assist_*
tackle_for_loss_*_player_id
```

### Historical analysis

Estimate:

```text
P(solo only)
P(solo + assist)
P(multiple assists)
```

by play family and gain range.

PBP does not provide every active defender, so do not fit a true per-snap defender-choice model from historical PBP alone.

### Current-simulation attribution

Choose among defenders relevant to the ball location and defensive formation.

Weights may use:

```text
pursuit
tackle
play_recognition
speed
```

For runs near the line:

```text
block_shedding
run_defense where available
```

Use TFL credit only if the simulated gain qualifies as a loss and the selected defender was involved.

---

## MODEL 19 — Interception credit

### Historical target

```text
interception_player_id
```

### Current-simulation attribution

If Model 09 produces an interception, select among defenders logically in coverage.

Weight by:

```text
play_recognition
man_coverage or zone_coverage
jumping
```

Coverage assignment must constrain candidate defenders.

Do not let an off-ball defender with no coverage responsibility randomly receive an interception solely because his rating is high.

---

## MODEL 20 — Field-goal success

### Population

```text
field_goal_attempt == 1
field_goal_result not null
```

### Target

```text
MADE vs NOT_MADE
```

Handle blocked kicks separately if sample size/modeling permits.

### Predictors

```text
kick_distance
roof
wind
temp
yardline_100
```

Use nonlinear distance effect.

### Model

Logistic with spline for `kick_distance`.

### Player modifiers

```text
kick_accuracy
kick_power
```

`kick_power` should have increasing importance at longer distances.

Do not permit accuracy alone to fully overcome insufficient range.

### Kicker random-effect analysis

Use `kicker_player_id` to estimate the historical residual spread among kickers after controlling for distance/environment. Use this variance to calibrate the magnitude of current `kick_accuracy` / `kick_power` modifiers.

---

## MODEL 21 — Punt outcome

### Population

```text
punt_attempt == 1
punt_blocked == 0 for ordinary punt-distance fit
```

### Historical targets

```text
kick_distance
touchback
punt_inside_twenty
punt_in_endzone
punt_out_of_bounds
punt_downed
punt_fair_catch
return_yards
```

### Modeling sequence

Suggested:

```text
punt distance
-> landing/end-zone context
-> returnability state
-> return yards if returned
```

### Predictors

```text
yardline_100
roof
wind
temp
```

Field position is mandatory because punters intentionally shorten kicks near the opponent goal line.

### Player modifiers

```text
punt_power
punt_accuracy
coffin_corner
hang_time
```

Suggested roles:

- `punt_power` -> distance
- `punt_accuracy` / `coffin_corner` -> placement, touchback/out-of-bounds/downed probabilities
- `hang_time` -> returnability and return-yard suppression

Calibrate each against historical punter residual variance rather than assigning arbitrary percentage boosts.

---

## MODEL 22 — Kickoff outcome

### Rule regime

Use only:

```text
2024 + 2025
```

for the current-rule model.

Do not pool 2023 kickoffs into this model.

### Onside kick exclusion

nflverse does not provide a dedicated onside-kick flag. Derive one during
the cleaning stage (not as a runtime model feature — this is a one-time
population-construction step, consistent with §19's restriction on using
`desc` as a model input) by matching `desc` for the literal phrase
"kicks onside", cross-checked against `kick_distance` being unusually short
for the rule regime in force. Confirmed in 2025: 53 of 2,918 kickoffs
(1.8%) are onside kicks this way.

Exclude onside-kick rows from the standard kickoff distance/return model.
If onside kicks are needed for the simulator (e.g. late-game strategy),
model them as a separate, explicitly-labeled event with their own
recovery-probability logic — do not pool them into Model 22's standard
kickoff distribution.

### Historical fields

```text
kickoff_attempt
kick_distance
touchback
kickoff_inside_twenty
kickoff_in_endzone
kickoff_out_of_bounds
kickoff_downed
kickoff_fair_catch
return_yards
kickoff_returner_player_id
```

### Modeling sequence

```text
touchback / return / out-of-bounds
-> return yards if returned
```

The simulator must separately implement the applicable NFL kickoff placement rules.

Do not infer rule placement solely from historic yardage.

---

## MODEL 23 — Extra point / two-point conversion

### Extra point

Target:

```text
extra_point_result
```

Predictors:

```text
kicker
environment
```

Player modifiers:

```text
kick_accuracy
kick_power
```

### Two-point decision

Initially use game logic / coaching decision rules, not a single league-average random choice.

### Two-point result

A full offensive play resolver may eventually handle the conversion from the appropriate field state.

If V1 needs a simpler implementation, use an empirical success probability as a temporary placeholder and clearly mark it.

---

## MODEL 24 — Clock runoff

### Purpose

Generate realistic game duration and possession timing.

### Derive

Within each game, sort plays by:

```text
order_sequence if reliable
otherwise play_id
```

Construct time to next meaningful snap using:

```text
game_seconds_remaining
quarter_seconds_remaining
end_clock_time
```

Audit clock discontinuities at:

```text
quarter boundaries
halftime
timeouts
scores
changes of possession
two-minute warning
```

### Condition runoff distributions on

```text
run in bounds
completed pass in bounds
out of bounds
incomplete pass
sack
scramble
touchdown
timeout
no_huddle
late-game hurry-up state
```

### Rule architecture

The engine should use deterministic NFL clock-stop/start rules plus empirical distributions for:

```text
play duration
huddle/runoff
snap tempo
```

Do not simply sample one global “seconds per play” distribution.

---

## MODEL 25 — Penalties (V1.5, not required before core calibration)

Do not allow penalty complexity to block V1.

After core football distributions validate, add:

```text
P(penalty | play family, situation)
penalty_type distribution
penalty_yards / enforcement
```

Historical fields:

```text
penalty
penalty_team
penalty_player_id
penalty_type
penalty_yards
first_down_penalty
```

Do not create a player “discipline” rating unless one is later added to the player model.

---

# 12. PLAYER-RATING MODIFIER ARCHITECTURE

The empirical baseline and the rating layer must remain mathematically separate.

For a binary event:

```text
baseline_logit = fitted_empirical_model(context)

simulation_logit =
    baseline_logit
    + sum(beta_i * standardized_player_attribute_i)
    + matchup_terms

P(event) = sigmoid(simulation_logit)
```

For a multiclass model:

```text
baseline_logits = fitted_empirical_multiclass_model(context)

simulation_logits_k =
    baseline_logits_k
    + rating_modifiers_k

P(k) = softmax(simulation_logits)
```

For yardage-category models:

```text
baseline_class_logits
+
rating modifiers
->
modified class probabilities
->
sample class
->
sample exact yards from empirical within-class distribution
```

### Centering rule

If all participating players are average for their active-role reference pools, total rating modifier should be approximately zero.

Therefore an average matchup reproduces the nflverse baseline by construction.

---

# 13. HOW TO CALIBRATE RATING EFFECT SIZES WITHOUT RE-DERIVING RATINGS

This is a critical statistical requirement.

The current game ratings are not present in nflverse historical PBP. Therefore Claude must **not** claim that a coefficient such as:

```text
+0.28 * throw_accuracy_short
```

was directly estimated from nflverse.

Instead use the following calibration procedure.

## 13.1 Fit context-only baseline

For each resolver, first fit the baseline using only valid contextual variables.

Example:

```text
P(complete/int/incomplete | air_yards, qb_hit, location, state)
```

No current game ratings.

## 13.2 Estimate historical residual skill variance

After the context model is fitted, estimate shrunken residual effects for the relevant historical units.

Examples:

### Pass result

Estimate residual effects for:

```text
QB
receiver
defense/team
```

after controlling for throw difficulty.

### Sack / QB hit

Estimate residual effects for:

```text
QB
offense team-season
defense team-season
```

Any QB-level residual estimate that needs to span THROW, SACK, *and*
SCRAMBLE outcomes jointly must use the derived `qb_player_id` from Model
04 (§11), not `passer_player_id` alone — `passer_player_id` is null on
100% of scramble rows.

### Rush yards

Estimate residual effects for:

```text
rusher
offense team-season
defense team-season
```

### YAC

Estimate residual effects for:

```text
receiver
defense team-season
```

### Kicking

Estimate residual effect for:

```text
kicker
```

### Punting

Estimate residual effect for:

```text
punter
```

Use hierarchical shrinkage / empirical Bayes so small samples regress toward zero.

A full Bayesian GLMM is acceptable if already supported, but do not make the build depend on a heavy Bayesian stack unnecessarily.

A practical V1 fallback is:

1. calculate expected events/yards from the baseline model;
2. aggregate actual-minus-expected residuals by player/team;
3. apply empirical-Bayes shrinkage based on opportunity count;
4. estimate the SD and percentile spread of the shrunken residual distribution.

## 13.3 Use residual variance as the rating-layer variance budget

The combined player modifiers in simulation should reproduce approximately the historical spread of residual player/team performance.

Example:

If historical QBs show a certain 10th-to-90th percentile spread in adjusted completion performance, calibrate the total QB accuracy modifier so current QBs at corresponding standardized rating percentiles generate a similar spread.

Do the same for:

```text
receiver contribution
defense contribution
rusher contribution
blocking contribution
pass-rush contribution
kicking contribution
```

This calibrates **effect magnitude** without replacing the game’s existing ratings.

## 13.4 Attribute-level coefficients

Within each resolver, retain separate coefficients for logically distinct attributes.

Example completion resolver:

```text
beta_qb_accuracy
beta_receiver_route
beta_receiver_catching
beta_defender_coverage
beta_qb_hit_interaction
```

Do not collapse all attributes into `overall`.

Initial coefficients should be optimized subject to:

```text
correct sign constraints
reasonable upper bounds
historical residual variance budget
regularization toward zero
simulation-level calibration targets
```

## 13.5 Synthetic sensitivity players

For each event family, create synthetic participants at:

```text
10th percentile
25th percentile
50th percentile
75th percentile
90th percentile
99th percentile
```

of the relevant standardized attributes.

Hold every other player and game state constant.

Simulate at least tens of thousands of opportunities per scenario.

Verify:

- monotonic direction;
- smooth response;
- no cliff effects;
- elite vs average spread is plausible;
- poor vs average spread is plausible;
- no single rating overwhelms the empirical baseline.

## 13.6 Joint objective

Create a calibration loss similar to:

```text
LOSS =
    sum_m w_m * distribution_error_m
    + lambda_beta * sum(beta_i^2)
    + sign_violation_penalty
    + variance_budget_penalty
    + monotonicity_penalty
```

Where distribution targets include:

```text
completion residual spread
sack residual spread
scramble spread
YAC residual spread
rush residual spread
kicker residual spread
team offense/defense residual spread
```

All optimized coefficients must be exported and documented.

---

# 14. MATCHUP RULES FOR CURRENT PLAYERS

The historical PBP baseline represents an average NFL matchup.

Current-player matchup modifiers are layered on top.

## 14.1 Pass protection

Do not simply average five OL overalls.

Determine relevant blockers/rushers from the current play/formation.

Suggested trait mapping:

### Finesse rush

Defender:

```text
finesse_moves
speed
acceleration
```

vs blocker:

```text
pass_block_finesse
agility
awareness
```

### Power rush

Defender:

```text
power_moves
strength
```

vs blocker:

```text
pass_block_power
anchor
strength
```

### General protection

```text
pass_block
awareness
line_calls
```

Use parameterized coefficients, not arbitrary fixed percentages.

## 14.2 Receiver vs coverage

### Short route

Receiver:

```text
route_running_short
release
catching
```

Defender:

```text
man_coverage or zone_coverage
press if applicable
play_recognition
```

### Intermediate

```text
route_running_mid
catching
```

vs coverage.

### Deep

Receiver:

```text
route_running_deep
speed
acceleration
```

Defender:

```text
man_coverage/zone_coverage
speed
acceleration
play_recognition
```

QB:

```text
throw_accuracy_deep
throw_power
```

## 14.3 Run blocking

Only blockers relevant to the selected location receive full effect.

Examples conceptually:

```text
left edge -> LT + left-side support + TE if aligned there
middle -> LG + C + RG
right edge -> RT + right-side support + TE if aligned there
```

Defensive candidates should correspond to the relevant front defenders rather than a full-team defensive average.

## 14.4 Open-field tackle/YAC

Ballcarrier:

```text
yac
break_tackle
speed
acceleration
agility
```

Defender:

```text
tackle
pursuit
speed
acceleration
```

---

# 15. USAGE IS NOT ABILITY

The simulator must maintain separate concepts for:

```text
player ability
player opportunity / role
```

Examples:

- `catching = 95` does not imply 30% target share.
- `break_tackle = 95` does not imply 25 carries.
- `pass_rush = elite traits` does not mean the player rushes on every snap.

Target/carry shares should come from:

```text
depth chart
personnel package
role
scheme
game state
empirical role-share priors
```

Ability ratings change what happens **when the player receives the opportunity**.

If the current game already has depth-chart/usage logic, integrate with it instead of replacing it.

---

# 16. TEAM AND COACH TENDENCIES

Use historical identities as grouping variables to estimate portable tendencies.

Examples:

```text
posteam pass tendency over expectation
team fourth-down aggressiveness
shotgun tendency
deep-target tendency
run-direction tendency
defense sack/hit residual
```

Shrink all team-season effects toward league average.

For the initial current roster:

- 2025 team residuals may serve as default tendency priors for the corresponding franchise;
- if a franchise coaching system already exists, expose these tendencies as coach/team parameters instead of hardcoding NFL team names into the engine.

Do not let historical team identity permanently define a franchise team after roster/coaching changes.

---

# 17. ENVIRONMENTAL VARIABLES

Available historical fields include:

```text
roof
surface
temp
wind
weather
stadium
```

Use structured variables (`roof`, `temp`, `wind`) before parsing `weather` text.

Environment is most defensible for:

```text
field goals
punts
kickoffs
```

It may be considered for:

```text
pass result
fumbles
```

only if it produces stable held-out improvements and plausible effects.

Do not include environmental features merely because they exist.

### 17.1 Indoor/outdoor handling for temp and wind

`temp` and `wind` are structurally null for `roof in {"dome", "closed"}`
(confirmed: 100% and ~97.5% null respectively in 2025), not missing at
random. Do not drop these rows and do not impute a league-mean temperature
onto them. Instead:

1. Treat `roof` as a required categorical predictor everywhere `temp`/`wind`
   are used, not an optional one.
2. For `roof in {"dome", "closed"}`, do not feed `temp`/`wind` into the
   model at all — use a fixed "controlled environment" indicator instead
   (the model already knows there's no wind/temperature effect indoors via
   the `roof` category itself).
3. For `roof in {"outdoors", "open"}`, use `temp`/`wind` as continuous
   predictors as originally specified. Check for the `open` category once
   older seasons are loaded — it does not appear in the 2025 file alone.
4. Document this split explicitly in each affected model's report (§20),
   not just in the shared cleaning code, so it's visible per-model that
   temp/wind effects are conditional on roof.

---

# 18. OUTPUT ARTIFACTS

The empirical-analysis project must be separate from the runtime simulation engine.

Recommended structure:

```text
/data
    play_by_play_2023.parquet
    play_by_play_2024.parquet
    play_by_play_2025.parquet
    players_local_final.csv

/analysis
    00_schema_audit.py
    01_cleaning.py
    02_fourth_down.py
    03_play_call.py
    04_formation.py
    05_dropback_outcome.py
    06_pass_depth.py
    07_pass_location.py
    08_target_roles.py
    09_qb_hit.py
    10_pass_result.py
    11_yac.py
    12_scramble_yards.py
    13_carry_roles.py
    14_run_location.py
    15_rush_yards.py
    16_fumbles.py
    17_defensive_attribution.py
    18_field_goals.py
    19_punts.py
    20_kickoffs.py
    21_clock.py
    22_rating_calibration.py
    23_full_sim_validation.py

/artifacts
    /schema
        schema_audit.json
        variable_classification.csv
    /ratings
        attribute_reference_stats.json
        rating_effect_coefficients.json
    /models
        fourth_down.*
        play_call.*
        shotgun.*
        dropback_outcome.*
        pass_depth.*
        pass_location.*
        qb_hit.*
        pass_result.*
        yac.*
        scramble_yards.*
        run_location.*
        rush_yards.*
        fumble.*
        field_goal.*
        punt.*
        kickoff.*
        clock.*
    /distributions
        target_role_shares.parquet
        carry_role_shares.parquet
        air_yards_exact.parquet
        yac_exact.parquet
        rush_yards_exact.parquet
        scramble_yards_exact.parquet
        sack_yards_exact.parquet
        clock_runoff.parquet
    /validation
        model_metrics.json
        holdout_2025_metrics.json
        residual_variance_targets.json
        simulation_validation.json
```

Actual serialization may use:

```text
joblib
JSON
Parquet
```

as appropriate.

Do not require the runtime engine to load the historical raw PBP dataset.

---

# 19. VARIABLE CLASSIFICATION SYSTEM

Create `variable_classification.csv` with one row for every PBP column and these fields:

```text
variable
classification
first_event_available
allowed_models
forbidden_models
notes
```

Valid classifications:

```text
STATE
INTERMEDIATE
TARGET
IDENTIFIER_GROUPING
BENCHMARK_ONLY
VALIDATION_ONLY
LEAKAGE_DO_NOT_USE
IGNORE_V1
```

Examples:

```text
down                    STATE
ydstogo                 STATE
yardline_100            STATE
score_differential      STATE
shotgun                 INTERMEDIATE
qb_dropback             TARGET / INTERMEDIATE depending model
air_yards               TARGET in depth model; INTERMEDIATE downstream
qb_hit                   TARGET in hit model; INTERMEDIATE downstream
complete_pass           TARGET
interception            TARGET
yards_after_catch       TARGET
yards_gained            TARGET
passer_player_id        IDENTIFIER_GROUPING
receiver_player_id      IDENTIFIER_GROUPING / TARGET for role model
cp                      BENCHMARK_ONLY
cpoe                    BENCHMARK_ONLY
xpass                   BENCHMARK_ONLY
pass_oe                 BENCHMARK_ONLY
epa                     LEAKAGE_DO_NOT_USE
wpa                     LEAKAGE_DO_NOT_USE
spread_line             LEAKAGE_DO_NOT_USE
posteam_score_post       LEAKAGE_DO_NOT_USE
desc                     VALIDATION_ONLY
```

Claude must generate this full file after inspecting the actual 2023–2025 schemas.

---

# 20. REQUIRED MODEL REPORT FOR EACH RESOLVER

Each model must produce a Markdown/JSON report containing:

```text
model name
target definition
eligible population
row count by season
missingness
class distribution / target distribution
predictor list
forbidden-variable check
baseline model
challenger models
2024 validation metrics
2025 locked test metrics
calibration plots
important conditional diagnostics
historical residual variance estimates
final chosen model
production refit metadata
```

For every model, explicitly state:

> “No current game player ratings were used to fit the nflverse baseline.”

---

# 21. REQUIRED VALIDATION SLICES

Do not validate only global averages.

At minimum inspect probability/outcome calibration by:

```text
down
distance
field-position band
quarter
score state
late game vs normal
red zone vs non-red-zone
shotgun vs non-shotgun where relevant
air-yard depth where relevant
season
```

For special teams:

```text
kick-distance band
roof
wind band
field position
```

---

# 22. FULL-SIMULATION VALIDATION

After all individual models pass held-out validation, run the engine using average player modifiers (all rating modifiers set to zero) and compare emergent 2023–2025 NFL distributions.

Minimum league-level targets:

```text
plays per team-game
drives per team-game
points per team-game
score variance
margin-of-victory distribution

dropback rate
designed-run rate

pass attempts
completion percentage
yards per attempt
air yards per attempt
interception rate
sack rate
QB-hit rate
scramble rate

rush attempts
yards per designed rush
negative-rush rate
explosive-rush rate

targets per team
receptions
YAC per reception
explosive reception rate

fumbles
fumbles lost
turnovers

first downs
third-down conversion
fourth-down attempt frequency
fourth-down conversion

field-goal attempts
field-goal make rate by distance
punts
touchbacks
punt returns

possessions
time of possession
clock runoff

0–10 point games
40+ point games
one-score games
blowouts
```

The average-rating simulator should reproduce the empirical league distribution before rating effects are turned on.

---

# 23. RATING-LAYER VALIDATION

After the baseline engine validates:

1. Turn on one rating family at a time.
2. Use synthetic percentile players.
3. Run Monte Carlo sensitivity tests.
4. Compare resulting performance spread to historical residual spread.
5. Only then enable multiple interacting rating families.
6. Re-run full league simulations.

Required invariants:

```text
higher QB accuracy must not lower completion probability
higher coverage must not increase opponent completion probability
higher pass blocking must not increase sack probability
higher pass rush must not lower sack/hit probability
higher carrying must not increase fumble probability
higher kick accuracy must not lower make probability
```

No monotonicity violation is acceptable unless explicitly justified.

---

# 24. STATISTICAL INTEGRITY TESTS

Automated simulation tests must enforce:

```text
QB completions <= attempts
interceptions <= attempts
sum receiver receptions == QB completions
sum receiver receiving yards == QB passing yards
sum player rushing yards == team rushing yards
receiving TDs == passing TDs
score reconciles exactly to scoring events
field position remains valid
down/distance transitions remain valid
possession changes correctly
no drive continues after a score/turnover when rules say it ends
same seed + same inputs => identical simulation
```

Defensive-stat integrity:

```text
every sack has valid sack credit
half sacks reconcile to sack totals
every interception has valid defender credit
tackle/assist counts arise only from eligible plays
forced fumble credit cannot occur without a fumble
```

---

# 25. CURRENT PLAYER ATTRIBUTES — V1 USE / DEFER MAP

## Use in V1 outcome resolution

```text
speed
acceleration
strength
agility
awareness

ball_carrier_vision
break_sack
break_tackle
carrying

catching
catch_in_traffic
release
route_running_deep
route_running_mid
route_running_short
spectacular_catch
yac

pass_block
pass_block_finesse
pass_block_power
anchor
line_calls
run_block

blitz
block_shedding
finesse_moves
power_moves
run_defense

man_coverage
zone_coverage
press
play_recognition

pursuit
tackle
hit_power
jumping

scrambling
throw_accuracy_deep
throw_accuracy_mid
throw_accuracy_short
throw_power

kick_accuracy
kick_power

coffin_corner
hang_time
punt_accuracy
punt_power
```

## Use only when relevant systems exist

```text
play_action
snap_accuracy
juke_move
spin_move
stiff_arm
```

These are valuable but should not be forced into V1 before the engine has explicit mechanics for them.

## Defer from core snap outcome

```text
clutch
injury
stamina
toughness
scheme_tags
dev_age_threshold
decline_age_threshold
contract_json
injury_history_json
injury_status_json
```

`injury`, `stamina`, and `toughness` belong in fatigue/injury/durability systems, not as generic yardage bonuses.

`overall` is never a direct snap-outcome input.

---

# 26. DO NOT DOUBLE-COUNT INFORMATION

Examples of prohibited double-counting:

- Do not use both `air_yards` and `pass_length` as if they were independent evidence when pass_length is simply a coarse derivative of air_yards.
- Do not apply WR route-running once in a target-share model and again at full strength in completion unless the first use represents a distinct causal mechanism.
- Do not apply OL/DL mismatch at full strength to both sack probability and QB-hit probability without joint calibration.
- Do not use `cp` as a baseline and then fit another baseline using the same hidden inputs unless the nesting is explicitly justified.
- Do not apply `overall` on top of the component ratings that created it.

Every rating should answer:

> Which specific probability distribution does this rating alter?

If the answer is unclear, do not use that rating yet.

---

# 27. IMPLEMENTATION PRIORITY

Build in this order.

## Phase A — data audit

1. load all three Parquets;
2. compare schemas;
3. generate missingness/type report;
4. generate full variable classification;
5. implement centralized clean-play filters.

Do not fit models until this passes.

## Phase B — league baseline

Fit, validate, and export:

```text
fourth-down action
dropback vs designed run
shotgun
dropback outcome
pass depth
QB hit
pass result
YAC
scramble yards
run location
rush yards
fumble
field goal
punt
clock
```

Use rating modifiers = 0.

## Phase C — usage

Build:

```text
target-role priors
carry-role priors
```

and integrate with current roster/depth-chart logic.

## Phase D — player effects

Calibrate:

```text
QB
receiver
coverage
pass protection/rush
rushing/blocking/run defense
YAC/tackling
fumbles
kicking
punting
```

one family at a time.

## Phase E — full Monte Carlo validation

Only after all individual modules pass.

---

# 28. FIRST CLAUDE CODE TASK

Do **not** immediately build all models.

The first coding task after receiving this specification is:

> Inspect `play_by_play_2023.parquet`, `play_by_play_2024.parquet`, and `play_by_play_2025.parquet`; inspect `players_local_final.csv`; generate a schema audit and a complete variable-classification file; then report any discrepancies between the actual files and this specification before fitting any model.

Required outputs of that first task:

```text
artifacts/schema/schema_audit.json
artifacts/schema/variable_classification.csv
artifacts/schema/data_quality_report.md
artifacts/ratings/attribute_reference_stats.json
```

The data-quality report must explicitly answer:

```text
1. Are all required PBP variables present in all 3 seasons?
2. Which relevant variables have substantial missingness? (follow the §6.6
   missingness convention — applicable-population denominators, and check
   for empty-string/sentinel values, not only true nulls)
3. Are any variable definitions/types inconsistent by season?
4. How many clean plays remain for every planned model?
5. Are qb_dropback/rush_attempt/qb_scramble/sack classifications mutually coherent?
6. How complete are run_gap and run_location?
7. How complete are air_yards, qb_hit, cp/cpoe, and xyac fields?
8. How complete are tackle/sack/INT attribution fields?
9. Do 2024–2025 kickoff fields behave consistently under the new rule regime?
10. Are there any player-sheet metadata inconsistencies that affect current roster construction?
```

### 28.1 Scramble/dropback coherence verification

For every row where `qb_dropback == 1` and `play_type == "run"`, the schema
audit must:

1. Report the count of such rows per season.
2. Confirm that these rows are captured by Model 04's population definition
   (`qb_dropback == 1`) rather than excluded because `play_type != "pass"`.
3. Confirm that these same rows are excluded from Model 12's population
   definition (`rush_attempt == 1 and qb_scramble == 0`) rather than
   double-counted as designed carries.
4. Flag any row where `qb_dropback == 1`, `play_type == "run"`, and
   `qb_scramble == 0` simultaneously — this combination is internally
   inconsistent and should be listed individually in
   `data_quality_report.md`, not averaged into a summary statistic.

This is a verification step, not a new filter — the population definitions
in §11 (Model Registry) already handle this correctly via `qb_dropback` and
`qb_scramble`, not `play_type`. The audit's job is to prove that's actually
true in the data, not assume it.

### 28.2 Two-point / non-down play exclusion verification

The audit must confirm, not assume, that `down is null` (§6.1) fully
captures administrative non-down plays:

1. Report the count of `two_point_attempt == 1` rows per season, and confirm
   `down` is null for all of them.
2. Report the same check for extra points and kickoffs.
3. Explicitly confirm in `data_quality_report.md` that every model in §11
   whose population references `pass_attempt == 1` or `rush_attempt == 1`
   without also filtering on `down` is relying on the centralized §6.1
   filter having already run — and that this dependency is documented in
   the model script, not implicit.

Do not proceed to model fitting until the audit has been reviewed.

---

# 29. FINAL DESIGN PRINCIPLE

The engine should always be interpretable as:

```text
REAL NFL CONTEXT
    ->
EMPIRICAL LEAGUE BASELINE
    ->
CURRENT PLAYER / MATCHUP MODIFIERS
    ->
STOCHASTIC DRAW
    ->
PLAY RESULT
    ->
STATE + INDIVIDUAL STAT UPDATE
```

The nflverse files determine how NFL football behaves on average in context.

The existing player sheet determines who is good at which football skills.

The calibration layer determines how much those skills are allowed to move real-NFL probabilities.

Never conflate those three jobs.

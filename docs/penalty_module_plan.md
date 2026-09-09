# Penalty module plan (spec MODEL 25 / §6.2 — V1.5)

Status: **models fitted (2026-09-09), engine wiring next.**
- ✅ **M25a** pre-snap dead-ball hazard — `analysis/25_penalties.py::presnap`,
  `artifacts/models/m25a.*`. logistic, 2025 locked log loss 0.141, ECE ≤ 0.5%,
  ~marginal rate (3.2% of snaps — penalties are near situation-independent and
  there is no discipline rating, exactly as expected).
- ✅ **M25b** live-ball hazard by `play_family` — `::liveball`,
  `artifacts/models/m25b.*`. logistic, locked 0.193, well-calibrated, marginal.
- ✅ **M25c** type buckets + yardage + enforcement —
  `analysis/25c_penalty_enforcement.py`, `artifacts/distributions/
  penalty_enforcement.parquet` + `penalty_dpi_yards.parquet` +
  `artifacts/models/m25c.report.md`. 40+ raw types → 9 buckets; per-bucket
  off/def share, mean yards, auto-first rate; DPI spot-foul yardage PMF by
  field-position band (17.9 / 17.0 / 7.9 yд own-half / opp-mid / opp-rz).
- ⏳ **engine wiring** into `analysis/engine/sim.py` (§4 chronology) + add
  penalty targets to `23_full_sim_validation.py` and re-run §22.

Written 2026-09-09 while Phase E V1 wrapped.
This is the top post-V1 accuracy item: the §22 full-sim validation is ~2.4
points/team-game short of the empirical baseline, and the deferred penalty
module accounts for most of it (DPI + defensive holding ≈ 2 free first downs a
game, ~55 penalty yards/team-game total, offsetting drives that currently
just end).

## What the data says (RAW load, REG, 2023–25)

Numbers from a **raw** parquet load (`pl.read_parquet` direct, `season_type ==
"REG"`), NOT `lib_py.pbp.load_clean` — `load_clean` drops ~75% of penalty
plays per spec §6.2 (correct for physical-outcome fitting, wrong for this
module). The penalty module needs its own loader over the full play stream.

- **12.3 accepted penalties / game** (both teams); 7.36% of all plays carry
  `penalty == 1`.
- Type mix (3-yr counts): False Start 1955, Offensive Holding 1914,
  **Defensive Pass Interference 855**, Defensive Holding 529, Unnecessary
  Roughness 509, then a long tail (Face Mask, Illegal Block, Intentional
  Grounding, Illegal Shift, Encroachment, …). ~20 types cover >95%.
- `penalty_yards`: mean 10.5 when it gives an automatic first down (28% of
  penalties, `first_down_penalty == 1`), mean 7.1 otherwise. Max 25 for fixed
  fouls; DPI is a **spot foul** so its enforced yardage is unbounded (needs
  its own yardage model, not a fixed PMF).
- Offense commits ~41%, defense ~59% of accepted penalties.
- Essentially all penalties have a typed play (pre-snap dead-ball fouls are
  still `play_type`-labeled); only 1/10064 had a null play_type.

## Fields (spec MODEL 25)

```
penalty  penalty_team  penalty_player_id  penalty_type  penalty_yards
first_down_penalty  drive_yards_penalized
```

No player "discipline" rating (spec is explicit). No per-player attribution in
V1.5 — league/situation rates only.

## Model structure

Three sub-models, fit on the raw stream, chronological split per §7
(train 2023 / val 2024 / test 2025; refit all three for production).

### M25a — P(penalty fires | slot, situation)

Two hazards, because they enter the §4 event chronology at different points:

- **pre-snap / dead-ball** (False Start, Encroachment, Neutral Zone, Delay of
  Game, Illegal Shift/Formation, Defensive Too Many Men): hazard per play
  *before* the snap resolves. ~30% of penalties. Features: down, ydstogo,
  yardline, offense/defense, no_huddle, score/clock (delay of game late),
  qtr.
- **live-ball**: hazard *after* the play family is chosen and the physical
  outcome sampled, conditioned on play family (pass / designed run / punt /
  FG / return). ~70%. Features: play family, dropback vs run, air-yards band
  (DPI/holding rise on deep passes), yardline, pass vs run, down.

Binary logistic per hazard (HGB challenger per the standard pipeline). Target
league rate ≈ 12.3/game combined.

### M25b — penalty_type | (hazard, play family, penalizing side)

Multinomial over ~8 engine-relevant buckets, not the raw 40+ strings:

| bucket | raw types folded in | enforcement |
| --- | --- | --- |
| false_start | False Start, Illegal Formation/Shift, Illegal Motion | 5 yd, replay down, no auto-1st |
| delay/procedure (def) | Encroachment, Neutral Zone, Offside, Delay, Too Many Men | 5 yd, auto-1st only if it makes the line to gain |
| offensive_holding | Offensive Holding, Illegal Block, Chop Block | 10 yd, replay down |
| off_illegal_hands | Offensive PI, OPI, Illegal Touching, Illegal Forward Pass | 5–10 yd, replay down |
| def_holding_illegal_contact | Defensive Holding, Illegal Contact | 5 yd + **auto 1st** |
| **DPI** | Defensive Pass Interference | **spot foul** + auto 1st (own yardage model) |
| roughing/personal | Roughing the Passer, Unnecessary Roughness, Face Mask, Horse Collar, Late Hit, Targeting | 15 yd + auto 1st |
| pre_snap_defense_free | (rare misc def) | 5 yd |

Fold the <1% tail into the nearest bucket. `first_down_penalty` is then
derived from bucket + whether the yardage reaches the line to gain, not
predicted separately.

### M25c — yardage & enforcement

- Fixed-yardage buckets: constant (5 / 10 / 15) — no model.
- **DPI**: empirical `penalty_yards` PMF conditioned on air-yards band and
  yardline_100 (spot foul → capped at the 1-yd line). Mean ~17, heavy right
  tail; this is the single biggest scoring lever.
- Enforcement logic in the engine (not a model): offense penalty on a
  completed pass for more yards → **decline**; half-the-distance when inside
  2× the penalty yardage; replay down unless auto-first; offsetting when both
  teams flagged (rare, hard-code a small rate → replay down).

## Engine integration (`engine/sim.py`, §4 chronology)

1. **pre-snap**: after `_pre_snap()` / 4th-down decision, before play call,
   roll M25a-presnap. On a fire → sample bucket (M25b restricted to pre-snap
   buckets), apply yardage, **replay the down**, re-enter the play loop
   (guard against infinite loop: cap at 2 pre-snap penalties per snap).
2. **live-ball**: after the physical outcome (`gained`, turnover flags) is
   known but before the state update, roll M25a-liveball for each side. On a
   fire → sample bucket, compute the penalty outcome, then apply
   **accept/decline = whichever side benefits** takes the better of {penalty
   enforced} vs {play stands}. Auto-first-down buckets override the
   `gained_first` logic. Penalty enforced → no down consumed unless the
   result is short of the line to gain on a non-auto foul.
3. Clock: pre-snap dead-ball penalty → no runoff (clock was stopped or
   running only on the play clock); accepted live-ball penalty → treat like
   an incomplete for the runoff bucket.

## Calibration / validation targets (add to `23_full_sim_validation.py` §22)

| metric | empirical (2023–25) |
| --- | --- |
| accepted penalties / team-game | ~6.2 |
| penalty yards / team-game | ~55 |
| DPI / team-game | ~0.9 |
| defensive auto-first-down penalties / team-game | ~1.6 |
| share of drives with ≥1 defensive penalty | tbd from data |

Expect `points_per_team_game` to move from −10.7% toward −3–4% and
`drives`/`plays` per game to rise slightly.

## Data ask

The raw 2023–25 stream is enough to *fit* V1.5. The user offered 2016–2025 —
use that **only** for the DPI yardage tail and the rare-bucket rates (more
seasons = stabler tails), keeping the *hazard rates* on 2023–25 (DPI
enforcement and roughing emphasis have drifted). Same rule as the Phase D
variance calibration.

## Explicitly out of scope for V1.5

- Player discipline ratings (spec forbids until the player model adds one).
- Penalty declined/accepted as a *coach* decision model — use deterministic
  "better outcome" logic.
- Pre-snap penalties changing the play call (offense just replays the down
  with the same intent).
- Special-teams-specific fouls beyond punt (kickoff is hard-coded in V1).

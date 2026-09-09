# analysis/ — empirical modeling pipeline

Builds the artifacts in `../artifacts/` that the runtime engine consumes. The
runtime engine never reads the raw play-by-play data — only this directory does
(spec §18).

Full contract: [`docs/engine_spec.md`](../docs/engine_spec.md)
(`NFL_SIM_EMPIRICAL_MODELING_SPEC.md`).

## Toolchain

| stage | language | status |
| --- | --- | --- |
| §28 schema audit / data-quality / variable classification / reference stats | **TypeScript** (`tsx`, `hyparquet`) | done — `00_schema_audit.ts` |
| Phase B league baseline (15 resolvers, rating modifiers = 0) | **Python 3.12** (polars, scikit-learn) | **done** — see table below |
| Phase C usage (target/carry role priors) | Python | **done** — M07 `08_target_roles`, M12 `13_carry_roles` |
| Phase D player-effect calibration | Python | **V1 done** — `22_rating_calibration` (§13.6 joint loss deferred to E) |
| Phase E full Monte-Carlo validation | Python | **V1 done** — `engine/` + `23_full_sim_validation` (§22, 15/20 within 10%; passing game calibrated by depth, points −11% and diffuse — not the passing shape) |
| Phase E rating-layer validation | Python | **V1 done** — `24_rating_layer_validation` (§23): §12-centered, all 11 family magnitudes ≈1.0× the historical anchor, paired ON/OFF widens score-margin variance without moving league aggregates |
| Portable resolver export | Python + TS | **done + wired** — `27_export_portable` + `lib_py/{hgb,linear}_portable`: all 16 classifier resolvers → `artifacts/models/portable/*.json` (HGB forests; spline+logistic → exact per-segment cubics), machine-epsilon vs sklearn. `engine/loaders` loads only these (no joblib/sklearn at runtime) → §22 unchanged, **~25× faster (0.35 s/game)**. `src/engine/{hgb,linear}-portable.ts` are the verified TS ports |

Phase C outputs: `artifacts/distributions/{target,carry}_role_shares.parquet`
(dimension × level × role → league / mean / shrunk-mean / sd / p10 / p90
share). Overall: target ROLE_1..4/5+ = .236/.175/.133/.105/.350; carry
ROLE_1..3/OTHER = .547/.241/.092/.120. Ratings never used (§15).

### Phase B resolvers (`artifacts/models/mNN.report.md`, `artifacts/validation/*`)

| id | script | kind | 2025 locked log loss / notes |
| --- | --- | --- | --- |
| M01 | 02_fourth_down | 3-class GO/FG/PUNT | 0.241 (HGB); beats marginal, well-calibrated |
| M02 | 03_play_call | binary DROPBACK | 0.530 (HGB) |
| M03 | 04_shotgun | binary SHOTGUN | 0.467 (HGB) |
| M04 | 05_dropback_outcome | THROW/SACK/SCRAMBLE | 0.444 ≈ marginal — signal is post-snap (Phase D) |
| M05 | 06_pass_depth | 4-class air-yard bins + exact PMF | 1.178; depth is scheme |
| M08 | 09_qb_hit | binary qb_hit | 0.310 < 0.386 marginal |
| M09 | 10_pass_result | COMPLETE/INT/OTHER | 0.660 < 0.737 marginal — core throw model |
| M10 | 11_yac | YAC bins + exact PMF | NLL 2.61 vs 2.75 baseline |
| M11 | 12_scramble_yards | yard bins + exact PMF | NLL ≈ baseline |
| M13 | 14_run_location | left/middle/right | 1.077 ≈ marginal (scheme) |
| M14 | 15_rush_yards | yard bins + exact PMF | NLL 2.79 vs 2.85 |
| M15 | 16_fumbles | binary fumble (rare) | 0.062 ≈ marginal per-family hazard |
| M20 | 18_field_goals | binary MADE, distance spline | 0.363 < 0.423 marginal |
| M21 | 19_punts | 5-class outcome + distance/return PMFs | 1.288; dist mean 47.4/47.4 |
| M24 | 21_clock | empirical elapsed PMF by outcome×tempo×clock | MAE 6.5 s, bias +0.5 s |
| M25a | 25_penalties presnap | binary dead-ball penalty hazard | 0.141 ≈ marginal (3.2%/snap; no discipline rating in V1.5) |
| M25b | 25_penalties liveball | binary live-ball penalty hazard by play_family | 0.193 ≈ marginal |
| M25c | 25c_penalty_enforcement | 9 type buckets + enforcement + DPI yardage PMF | empirical; 11.5 penalties/game |

M25a/b/c are **wired into `engine/sim.py`** (pre-snap + live-ball rolls, deterministic
accept/decline, DPI spot foul); `23_full_sim_validation.py` has penalty-volume targets.
Penalty volume runs ~15–20% light on purpose — `PENALTY_HAZARD_SCALE`=1.0 because
scaling it up to hit the count pushes points/team-game −10%→−16% (penalty-free-fit
resolvers + a drive model that over-punishes offensive fouls; V1.6 = gained-conditioned hazards).

Every report carries the §20 sections + "No current game player ratings were
used to fit the nflverse baseline." Models that sit at the marginal rate are
*supposed to* — they supply the calibrated league baseline; discrimination is
the Phase-D rating layer (penalties have none in V1.5 — spec MODEL 25).

The audit is pure data inspection → runs in the repo's Node toolchain.
Model fitting is Python.

### Python env (one-time)

This machine is **Windows-on-ARM** (`win_arm64`). `pyarrow` and `fastparquet`
have no ARM64 wheels, so parquet I/O goes through **polars** (bundled Arrow,
ARM64 wheel available); polars is the primary dataframe and sklearn is fed
numpy arrays. All pins in `requirements.txt` have confirmed `win_arm64` wheels.

```
py -m venv analysis/.venv
analysis/.venv/Scripts/python -m pip install -r analysis/requirements.txt
```

### Run a resolver

```
cd analysis && .venv/Scripts/python 02_fourth_down.py
```

Each `NN_*.py` follows the §7 protocol (dev on 2023→2024, locked test on 2025,
production refit on all three) and writes:

```
artifacts/models/<name>.joblib            production model
artifacts/models/<name>.coef.json         coefficients (when logistic)
artifacts/models/m0N.report.{md,json}     the §20 model report
artifacts/validation/model_metrics.json   dev/validation metrics (all models)
artifacts/validation/holdout_2025_metrics.json   locked-test + §21 slices
artifacts/validation/*.png                calibration plots
```

## Data files (not committed)

Put these in `../data/` (git-ignored — large / third-party):

```
play_by_play_2023.parquet
play_by_play_2024.parquet
play_by_play_2025.parquet   # nflverse; primary training seasons (spec §6.5)
players_local_final.csv     # == data/players.local.csv, kept under the spec's name
```

nflverse PBP releases: <https://github.com/nflverse/nflverse-data/releases/tag/pbp>

## Run the audit

```
npm run analysis:audit
```

Writes:

```
artifacts/schema/schema_audit.json
artifacts/schema/variable_classification.csv
artifacts/schema/data_quality_report.md
artifacts/ratings/attribute_reference_stats.json
```

**Per spec §28, review `data_quality_report.md` before any model is fitted.**

## Layout

```
analysis/
  README.md
  requirements.txt
  lib/                    (TypeScript — audit only)
    pbp.ts       parquet loading, season list, schema read
    filters.ts   §6 clean-play filters, §6.6 applicable-population missingness
    spec.ts      required fields, §19 classification, §11 populations, §3 reference pool
  lib_py/                 (Python — Phase B)
    pbp.py       parquet load + §6 filters (behaviourally identical to lib/filters.ts)
    split.py     §7 chronological data-split protocol (+ kickoff exception)
    metrics.py   §8 selection metrics: log loss, Brier, calib slope/intercept, ECE, reliability
    modeling.py  §8 spline+logistic / HGB builders, §19 forbidden-variable guard, calibration plot
    report.py    §20 per-resolver report scaffold
  00_schema_audit.ts      §28 first task
  02_fourth_down.py       Model 01
```

If `lib/filters.ts` or `lib_py/pbp.py` changes, change **both** — they must
stay behaviourally identical.

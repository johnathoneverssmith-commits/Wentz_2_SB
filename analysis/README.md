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
| Phase B+ model fitting (splines, logistic/multinomial, GBM, calibration) | **Python 3.12** (polars, scikit-learn) | in progress — M01 done |

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

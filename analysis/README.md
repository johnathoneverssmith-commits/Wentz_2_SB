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
| Phase B+ model fitting (splines, logistic/multinomial, GBM, calibration) | **Python** (pandas, pyarrow, scikit-learn) | not started — needs a venv |

The audit is pure data inspection, so it runs in the repo's existing Node
toolchain. Model fitting needs scikit-learn; when we start Phase B, add:

```
py -m venv analysis/.venv
analysis/.venv/Scripts/pip install pandas pyarrow scikit-learn
```

and the `01_*.py …` scripts land here alongside `00_schema_audit.ts`.

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
  lib/
    pbp.ts       parquet loading, season list, schema read
    filters.ts   §6 clean-play filters, §6.6 applicable-population missingness
    spec.ts      machine-readable pieces of the spec: required fields, §19
                 variable classification, §11 model populations, §3 reference pool
  00_schema_audit.ts   the §28 first task
```

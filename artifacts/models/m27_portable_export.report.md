# M27 — Portable HGB export

The chosen HGB resolvers flattened to `artifacts/models/portable/<mid>.json` (baseline + per-class regression-tree forests, categorical splits resolved to string sets). `lib_py/hgb_portable.predict_proba_portable` is the reference evaluator and the spec for the TS port.

| model | objective | classes | iters | trees | nodes | size | rows checked | max |Δp| | ok |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :---: |
| M01 | multiclass | 3 | 95 | 285 | 17385 | 556.4 KB | 3784 | 4.44e-16 | ✅ |
| M02 | binary | 2 | 312 | 312 | 19032 | 615.8 KB | 4000 | 6.66e-16 | ✅ |
| M03 | binary | 2 | 201 | 201 | 12261 | 399.0 KB | 4000 | 6.66e-16 | ✅ |
| M05 | multiclass | 4 | 85 | 340 | 20740 | 671.7 KB | 4000 | 3.33e-16 | ✅ |
| M09 | multiclass | 3 | 44 | 132 | 8052 | 269.4 KB | 4000 | 4.44e-16 | ✅ |
| M10 | multiclass | 6 | 56 | 336 | 20496 | 670.3 KB | 4000 | 4.44e-16 | ✅ |
| M14 | multiclass | 6 | 57 | 342 | 20862 | 684.4 KB | 4000 | 5.00e-16 | ✅ |

**7/7 reproduce `sklearn.predict_proba` to < 1e-6** on real 2025 rows. The portable evaluator compares categorical values as strings; unknown / missing follow each split's missing-left flag (matches sklearn's OrdinalEncoder `unknown_value=nan` → bin-mapper missing bin).

### Latent bug this surfaced — M01 categorical dtypes

M01 (`02_fourth_down.py`, pre-refactor) trained `goal_to_go` / `qtr` / `temp_missing` as **int8** categories (`[np.int8(0), np.int8(1)]`). `engine/loaders._row` stringifies every cat col, so at runtime sklearn's OrdinalEncoder sees `'0'` ≠ `int8(0)` → unknown → NaN → missing bin: **the live Python engine ignores those three M01 features.** The portable export string-normalises category values, so a runtime built on these JSON models evaluates M01 *correctly*. Fix for the Python engine: either retype those columns or (better) switch the engine to `predict_proba_portable` — separate task, needs a §22 re-run.

# M27 — Portable resolver export

Every fitted resolver flattened to `artifacts/models/portable/<mid>.json` so the TS runtime needs no joblib. Tree models (`lib_py/hgb_portable.py`) store baseline + per-class regression-tree forests with categorical splits resolved to string sets; linear models (`lib_py/linear_portable.py`) collapse each numeric feature's spline→coef pathway to a 1-D decision-contribution lookup plus one-hot weight rows. Both reference evaluators are the spec for the TS port.

| model | kind | objective | classes | size | rows checked | max |Δp| | ok |
| --- | --- | --- | ---: | ---: | ---: | ---: | :---: |
| M01 | tree | multiclass | 3 | 556.4 KB | 3784 | 4.44e-16 | ✅ |
| M02 | tree | binary | 2 | 615.8 KB | 4000 | 6.66e-16 | ✅ |
| M03 | tree | binary | 2 | 399.0 KB | 4000 | 6.66e-16 | ✅ |
| M05 | tree | multiclass | 4 | 671.7 KB | 4000 | 3.33e-16 | ✅ |
| M09 | tree | multiclass | 3 | 269.4 KB | 4000 | 4.44e-16 | ✅ |
| M10 | tree | multiclass | 6 | 670.3 KB | 4000 | 4.44e-16 | ✅ |
| M14 | tree | multiclass | 6 | 684.4 KB | 4000 | 5.00e-16 | ✅ |
| M04 | linear | multiclass | 3 | 6.1 KB | 4000 | 2.22e-16 | ✅ |
| M08 | linear | binary | 2 | 3.0 KB | 4000 | 2.22e-16 | ✅ |
| M11 | linear | multiclass | 5 | 9.0 KB | 1034 | 3.33e-16 | ✅ |
| M13 | linear | multiclass | 3 | 5.7 KB | 4000 | 2.50e-16 | ✅ |
| M15 | linear | binary | 2 | 1.5 KB | 4000 | 3.33e-16 | ✅ |
| M20 | linear | binary | 2 | 1.9 KB | 1088 | 2.22e-16 | ✅ |
| M21 | linear | multiclass | 5 | 4.9 KB | 1924 | 2.78e-16 | ✅ |
| M25a | linear | binary | 2 | 2.4 KB | 4000 | 2.22e-16 | ✅ |
| M25b | linear | binary | 2 | 2.5 KB | 4000 | 2.22e-16 | ✅ |

**16/16 reproduce `sklearn.predict_proba` to < 1e-6** on real 2025 rows. Tree eval compares categoricals as strings, unknown/missing follow the split's missing-left flag; linear eval uses `handle_unknown='ignore'` (unknown category → zero contribution) and interpolates the numeric lookup (constant past the spline's active range, matching `extrapolation='constant'`).

### Latent bug this surfaced — M01 categorical dtypes

M01 trained `goal_to_go` / `qtr` / `temp_missing` as **int8** categories. The old `engine/loaders._row` stringified every cat col, so sklearn's OrdinalEncoder saw `'0'` ≠ `int8(0)` → NaN → those three M01 features were ignored at runtime. The portable tree eval string-normalises and uses them; `engine/loaders` now loads the portable JSON.

"""Export every fitted resolver to portable JSON + verify against sklearn.

The runtime resolvers split two ways:
  - tree  (M01/M02/M03/M05/M09/M10/M14): HistGradientBoostingClassifier
    -> lib_py/hgb_portable.py  -> artifacts/models/portable/<mid>.json
  - linear (M04/M15/M20/M21/M25a/M25b): spline+logistic Pipeline
    -> lib_py/linear_portable.py -> artifacts/models/portable/<mid>.json

Neither is loadable from a joblib pickle in the TS runtime. This flattens both
to plain JSON and checks that the pure-Python reference evaluator reproduces
`sklearn.predict_proba` on real 2025 rows to < 1e-6 max abs probability error.
Writes `artifacts/models/m27_portable_export.report.md`; exits non-zero on any
mismatch.

Run: analysis/.venv/Scripts/python analysis/27_export_portable.py
"""

from __future__ import annotations

import lib_py  # thread-env

import importlib
import json
import sys

import joblib
import numpy as np
import pandas as pd
import polars as pl

from lib_py.hgb_portable import export_hgb, predict_proba_portable
from lib_py.linear_portable import export_linear, predict_proba_linear
from lib_py.report import ARTIFACTS

# mid -> (joblib stem, resolver module, build-frame attr)
TREE_MODELS = {
    "M01": ("fourth_down", "02_fourth_down", "build_frame"),
    "M02": ("m02", "03_play_call", "build_frame"),
    "M03": ("m03", "04_shotgun", "build_frame"),
    "M05": ("m05", "06_pass_depth", "build_frame"),
    "M09": ("m09", "10_pass_result", "build_frame"),
    "M10": ("m10", "11_yac", "build_frame"),
    "M14": ("m14", "15_rush_yards", "build_frame"),
}
LINEAR_MODELS = {
    "M04": ("m04", "05_dropback_outcome", "build_frame"),
    "M08": ("m08", "09_qb_hit", "build_frame"),
    "M11": ("m11", "12_scramble_yards", "build_frame"),
    "M13": ("m13", "14_run_location", "build_frame"),
    "M15": ("m15", "16_fumbles", "build_frame"),
    "M20": ("m20", "18_field_goals", "build_frame"),
    "M21": ("m21", "19_punts", "build_frame"),
    "M25a": ("m25a", "25_penalties", "build_presnap"),
    "M25b": ("m25b", "25_penalties", "build_liveball"),
}

N_CHECK = 4000
OUT = ARTIFACTS / "models" / "portable"


def _frame(modname: str, build_attr: str) -> pl.DataFrame:
    df = importlib.import_module(modname).__dict__[build_attr]((2025,))
    return df.sample(n=N_CHECK, seed=27) if df.height > N_CHECK else df


def _tree_rows(df: pl.DataFrame, est, features: list[str]):
    """sklearn wants each categorical column in the dtype its categories_ was
    trained on (M01 trained goal_to_go/qtr/temp_missing as int8)."""
    is_cat = {f: bool(c) for f, c in zip(features, est.is_categorical_)}
    enc = est._preprocessor.named_transformers_["encoder"]
    cat_feats = [f for f in features if is_cat[f]]
    cat_dtype = {f: np.asarray(enc.categories_[i]).dtype for i, f in enumerate(cat_feats)}
    sk_data, dict_data = {}, {}
    for f in features:
        if is_cat[f]:
            if np.issubdtype(cat_dtype[f], np.number):
                col = df[f].cast(pl.Int64).to_numpy().astype(cat_dtype[f])
            else:
                col = df[f].cast(pl.Utf8).to_list()
            sk_data[f] = col
            dict_data[f] = [str(v) for v in col]
        else:
            v = df[f].cast(pl.Float64).to_numpy()
            sk_data[f] = v
            dict_data[f] = v
    pdf = pd.DataFrame(sk_data)[features]
    return pdf, pd.DataFrame(dict_data)[features].to_dict(orient="records")


def _linear_rows(df: pl.DataFrame, est, features: list[str]):
    """spline+logistic: numeric -> float, categorical (all string-trained) -> str."""
    cat_cols = set()
    for _, trans, cols in est.named_steps["pre"].transformers_:
        if type(trans).__name__ == "OneHotEncoder":
            cat_cols |= set(cols)
    sk_data = {}
    for f in features:
        sk_data[f] = df[f].cast(pl.Utf8).to_list() if f in cat_cols else df[f].cast(pl.Float64).to_numpy()
    pdf = pd.DataFrame(sk_data)[features]
    return pdf, pdf.to_dict(orient="records")


def _check(portable, evaluator, est, pdf, dicts) -> float:
    sk = est.predict_proba(pdf)
    cls = list(est.classes_)
    return max(
        max(abs(evaluator(portable, d)[c] - sk[i, j]) for j, c in enumerate(cls))
        for i, d in enumerate(dicts)
    )


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    rows = []

    for kind, table, exporter, evaluator, row_fn in (
        ("tree", TREE_MODELS, export_hgb, predict_proba_portable, _tree_rows),
        ("linear", LINEAR_MODELS, export_linear, predict_proba_linear, _linear_rows),
    ):
        for mid, (stem, modname, build_attr) in table.items():
            b = joblib.load(ARTIFACTS / "models" / f"{stem}.joblib")
            est, feats, labels = b["estimator"], b["features"], b["labels"]
            portable = exporter(est, feats, labels)
            path = OUT / f"{mid}.json"
            path.write_text(json.dumps(portable, separators=(",", ":")) + "\n", encoding="utf-8")

            pdf, dicts = row_fn(_frame(modname, build_attr), est, feats)
            max_err = _check(portable, evaluator, est, pdf, dicts)
            size_kb = path.stat().st_size / 1024
            ok = max_err < 1e-6
            rows.append({"mid": mid, "kind": kind, "objective": portable["objective"],
                         "classes": len(est.classes_), "size_kb": round(size_kb, 1),
                         "n_checked": len(dicts), "max_abs_prob_err": max_err, "ok": ok})
            print(f"  {mid:5s} {kind:6s} {portable['objective']:10s} "
                  f"{size_kb:7.1f} KB  n={len(dicts):4d}  max_err={max_err:.2e}  {'OK' if ok else 'FAIL'}")

    md = ["# M27 — Portable resolver export", "",
          "Every fitted resolver flattened to `artifacts/models/portable/<mid>.json` so the "
          "TS runtime needs no joblib. Tree models (`lib_py/hgb_portable.py`) store baseline + "
          "per-class regression-tree forests with categorical splits resolved to string sets; "
          "linear models (`lib_py/linear_portable.py`) collapse each numeric feature's "
          "spline→coef pathway to a 1-D decision-contribution lookup plus one-hot weight rows. "
          "Both reference evaluators are the spec for the TS port.", "",
          "| model | kind | objective | classes | size | rows checked | max |Δp| | ok |",
          "| --- | --- | --- | ---: | ---: | ---: | ---: | :---: |"]
    for r in rows:
        md.append(f"| {r['mid']} | {r['kind']} | {r['objective']} | {r['classes']} | "
                  f"{r['size_kb']} KB | {r['n_checked']} | {r['max_abs_prob_err']:.2e} | "
                  f"{'✅' if r['ok'] else '❌'} |")
    npass = sum(r["ok"] for r in rows)
    md += ["", f"**{npass}/{len(rows)} reproduce `sklearn.predict_proba` to < 1e-6** on real "
           "2025 rows. Tree eval compares categoricals as strings, unknown/missing follow the "
           "split's missing-left flag; linear eval uses `handle_unknown='ignore'` (unknown "
           "category → zero contribution) and interpolates the numeric lookup "
           "(constant past the spline's active range, matching `extrapolation='constant'`).", "",
           "### Latent bug this surfaced — M01 categorical dtypes", "",
           "M01 trained `goal_to_go` / `qtr` / `temp_missing` as **int8** categories. The old "
           "`engine/loaders._row` stringified every cat col, so sklearn's OrdinalEncoder saw "
           "`'0'` ≠ `int8(0)` → NaN → those three M01 features were ignored at runtime. The "
           "portable tree eval string-normalises and uses them; `engine/loaders` now loads the "
           "portable JSON.", ""]
    (ARTIFACTS / "models" / "m27_portable_export.report.md").write_text("\n".join(md), encoding="utf-8")
    print(f"\n{npass}/{len(rows)} within 1e-6")
    if npass != len(rows):
        sys.exit(1)


if __name__ == "__main__":
    main()

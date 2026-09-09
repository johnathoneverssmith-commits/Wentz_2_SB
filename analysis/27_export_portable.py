"""Export the chosen HGB resolvers to portable JSON + verify against sklearn.

M01/M02/M03/M05/M09/M10/M14 chose `HistGradientBoostingClassifier`; the eventual
TS runtime can't load joblib. This flattens each to `artifacts/models/portable/
<mid>.json` (see lib_py/hgb_portable.py) and checks that the pure-Python
reference evaluator reproduces `sklearn.predict_proba` on real 2025 rows to
< 1e-6 max abs probability error. Writes `artifacts/models/m27_portable_export.report.md`.

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
from lib_py.report import ARTIFACTS

# mid -> (joblib stem, resolver module, build_frame attr)
MODELS = {
    "M01": ("fourth_down", "02_fourth_down", "build_frame"),
    "M02": ("m02", "03_play_call", "build_frame"),
    "M03": ("m03", "04_shotgun", "build_frame"),
    "M05": ("m05", "06_pass_depth", "build_frame"),
    "M09": ("m09", "10_pass_result", "build_frame"),
    "M10": ("m10", "11_yac", "build_frame"),
    "M14": ("m14", "15_rush_yards", "build_frame"),
}

N_CHECK = 4000
OUT = ARTIFACTS / "models" / "portable"


def _rows_for(mid: str, stem: str, modname: str, build_attr: str, features: list[str]):
    mod = importlib.import_module(modname)
    df = getattr(mod, build_attr)((2025,))
    if df.height > N_CHECK:
        df = df.sample(n=N_CHECK, seed=27)
    # sklearn input: pandas, feature order, cats as str / nums as float
    est = joblib.load(ARTIFACTS / "models" / f"{stem}.joblib")["estimator"]
    is_cat = {f: bool(c) for f, c in zip(features, est.is_categorical_)}
    # sklearn's OrdinalEncoder matches by exact type: feed each categorical column
    # in the dtype its `categories_` was trained on (M01 trained goal_to_go / qtr
    # / temp_missing as int8; the rest as strings).
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
            dict_data[f] = [str(v) for v in col]            # portable: string-normalised
        else:
            v = df[f].cast(pl.Float64).to_numpy()
            sk_data[f] = v
            dict_data[f] = v
    pdf = pd.DataFrame(sk_data)[features]
    dicts = pd.DataFrame(dict_data)[features].to_dict(orient="records")
    return est, pdf, dicts


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    rows = []
    for mid, (stem, modname, build_attr) in MODELS.items():
        bundle = joblib.load(ARTIFACTS / "models" / f"{stem}.joblib")
        est, feats, labels = bundle["estimator"], bundle["features"], bundle["labels"]

        portable = export_hgb(est, feats)
        (OUT / f"{mid}.json").write_text(json.dumps(portable, separators=(",", ":")) + "\n",
                                        encoding="utf-8")
        size_kb = (OUT / f"{mid}.json").stat().st_size / 1024

        est_chk, pdf, dicts = _rows_for(mid, stem, modname, build_attr, feats)
        sk = est_chk.predict_proba(pdf)                       # (n, n_classes) in classes_ order
        cls = list(est_chk.classes_)
        max_err = 0.0
        for i, d in enumerate(dicts):
            pp = predict_proba_portable(portable, d)
            err = max(abs(pp[c] - sk[i, j]) for j, c in enumerate(cls))
            max_err = max(max_err, err)

        n_trees = sum(len(f) for f in portable["trees_per_class"])
        n_nodes = sum(len(t) for f in portable["trees_per_class"] for t in f)
        ok = max_err < 1e-6
        rows.append({"mid": mid, "objective": portable["objective"], "classes": len(cls),
                     "iterations": portable["n_iterations"], "trees": n_trees, "nodes": n_nodes,
                     "size_kb": round(size_kb, 1), "n_checked": len(dicts),
                     "max_abs_prob_err": max_err, "ok": ok})
        print(f"  {mid}: {portable['objective']:10s} trees={n_trees:4d} nodes={n_nodes:6d} "
              f"{size_kb:7.1f} KB  max_err={max_err:.2e}  {'OK' if ok else 'FAIL'}")

    md = ["# M27 — Portable HGB export", "",
          "The chosen HGB resolvers flattened to `artifacts/models/portable/<mid>.json` "
          "(baseline + per-class regression-tree forests, categorical splits resolved to "
          "string sets). `lib_py/hgb_portable.predict_proba_portable` is the reference "
          "evaluator and the spec for the TS port.", "",
          "| model | objective | classes | iters | trees | nodes | size | rows checked | max |Δp| | ok |",
          "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :---: |"]
    for r in rows:
        md.append(f"| {r['mid']} | {r['objective']} | {r['classes']} | {r['iterations']} | "
                  f"{r['trees']} | {r['nodes']} | {r['size_kb']} KB | {r['n_checked']} | "
                  f"{r['max_abs_prob_err']:.2e} | {'✅' if r['ok'] else '❌'} |")
    npass = sum(r["ok"] for r in rows)
    md += ["", f"**{npass}/{len(rows)} reproduce `sklearn.predict_proba` to < 1e-6** on real "
           "2025 rows. The portable evaluator compares categorical values as strings; unknown "
           "/ missing follow each split's missing-left flag (matches sklearn's OrdinalEncoder "
           "`unknown_value=nan` → bin-mapper missing bin).", "",
           "### Latent bug this surfaced — M01 categorical dtypes", "",
           "M01 (`02_fourth_down.py`, pre-refactor) trained `goal_to_go` / `qtr` / `temp_missing` "
           "as **int8** categories (`[np.int8(0), np.int8(1)]`). `engine/loaders._row` "
           "stringifies every cat col, so at runtime sklearn's OrdinalEncoder sees `'0'` ≠ "
           "`int8(0)` → unknown → NaN → missing bin: **the live Python engine ignores those "
           "three M01 features.** The portable export string-normalises category values, so a "
           "runtime built on these JSON models evaluates M01 *correctly*. Fix for the Python "
           "engine: either retype those columns or (better) switch the engine to "
           "`predict_proba_portable` — separate task, needs a §22 re-run.", ""]
    (ARTIFACTS / "models" / "m27_portable_export.report.md").write_text("\n".join(md), encoding="utf-8")
    print(f"\n{npass}/{len(rows)} within 1e-6")
    if npass != len(rows):
        sys.exit(1)


if __name__ == "__main__":
    main()

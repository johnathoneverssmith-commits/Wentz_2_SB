"""Portable export + reference evaluator for the spline+logistic resolvers.

M04/M15/M20/M21/M25a/M25b are sklearn `Pipeline([('pre', ColumnTransformer(
SplineTransformer | StandardScaler | OneHotEncoder)), ('clf', LogisticRegression)])`.

The whole thing is linear in the transformed design matrix, so each *numeric*
feature's contribution to the decision function `Σ_j coef_j · basis_j(x)` is a
1-D function of that feature alone:
  - a SplineTransformer feature -> a piecewise cubic with breakpoints at the
    spline's interior knots (degree 3), constant outside (matching sklearn's
    `extrapolation='constant'`). Exported as exact per-segment cubic coeffs.
  - a StandardScaler feature -> exactly linear: `((x - mean) / scale) * w`.
Categoricals become per-class one-hot weight rows (`handle_unknown='ignore'`
-> unknown category contributes zero).

`predict_proba_linear` then needs no sklearn / B-spline maths. Verified against
`sklearn.predict_proba` to < 1e-6 in `analysis/27_export_portable.py`.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np


def _blocks(pre: Any):
    return [(name, trans, list(cols)) for name, trans, cols in pre.transformers_ if trans != "drop"]


def _spline_segments(spline: Any, j: int, coef_block: np.ndarray) -> dict:
    """coef_block: (n_eff, n_bases) slice of clf.coef_ for feature j's spline cols.
    Returns exact per-segment cubic coefficients of `Σ_b coef[:,b]·basis_b(x)`."""
    bs = spline.bsplines_[j]
    t, k = bs.t, bs.k                              # knots, degree (3)
    breaks = [float(v) for v in np.unique(t[k:-k])]   # interior knot breakpoints
    n_eff = coef_block.shape[0]

    def contrib(xs: np.ndarray) -> np.ndarray:
        X = np.zeros((len(xs), spline.n_features_in_))
        X[:, j] = xs
        per = spline.transform(np.zeros((1, spline.n_features_in_))).shape[1] // spline.n_features_in_
        basis = spline.transform(X)[:, j * per:(j + 1) * per]      # (len, per)
        return basis @ coef_block.T                                # (len, n_eff)

    seg = []
    for s in range(len(breaks) - 1):
        lo, hi = breaks[s], breaks[s + 1]
        # 4 sample points strictly inside -> exact cubic (the contribution IS cubic here)
        xs = lo + (hi - lo) * np.array([0.12, 0.38, 0.62, 0.88])
        u = xs - lo
        V = np.vstack([np.ones_like(u), u, u ** 2, u ** 3]).T      # (4, 4)
        vals = contrib(xs)                                          # (4, n_eff)
        coeffs = np.linalg.solve(V, vals)                          # (4, n_eff): [a,b,c,d] per class
        seg.append([[float(coeffs[p, kk]) for p in range(4)] for kk in range(n_eff)])
    return {"kind": "pw_cubic", "breaks": breaks, "seg": seg}


def export_linear(pipeline: Any, feature_names: list[str], labels: list[str]) -> dict:
    pre = pipeline.named_steps["pre"]
    clf = pipeline.named_steps["clf"]
    classes = [str(c) for c in clf.classes_]
    n_eff = clf.coef_.shape[0]
    objective = "binary" if n_eff == 1 else "multiclass"

    numeric: dict[str, dict] = {}
    categorical: dict[str, dict] = {}
    col = 0
    for _, trans, cols in _blocks(pre):
        tname = type(trans).__name__
        if tname == "SplineTransformer":
            per = trans.transform(np.zeros((1, len(cols)))).shape[1] // len(cols)
            for j, feat in enumerate(cols):
                block = clf.coef_[:, col + j * per: col + (j + 1) * per]
                numeric[feat] = _spline_segments(trans, j, block)
            col += per * len(cols)
        elif tname == "StandardScaler":
            for j, feat in enumerate(cols):
                w = clf.coef_[:, col + j]
                numeric[feat] = {"kind": "linear", "mean": float(trans.mean_[j]),
                                 "scale": float(trans.scale_[j]), "w": [float(x) for x in w]}
            col += len(cols)
        elif tname == "OneHotEncoder":
            for j, feat in enumerate(cols):
                cats = [str(c) for c in trans.categories_[j]]
                block = clf.coef_[:, col: col + len(cats)]
                categorical[feat] = {c: [float(block[k, i]) for k in range(n_eff)]
                                     for i, c in enumerate(cats)}
                categorical[feat]["_unknown"] = [0.0] * n_eff
                col += len(cats)
        else:  # pragma: no cover
            raise ValueError(f"unhandled transformer {tname}")

    return {
        "format": "linear-portable-1",
        "objective": objective,
        "classes": classes,
        "labels": list(labels),
        "feature_names": list(feature_names),
        "intercept": [float(b) for b in clf.intercept_],
        "numeric": numeric,
        "categorical": categorical,
    }


# ---- reference evaluator (spec for the TS port) --------------------------

def _numeric_contrib(entry: dict, x: float, k: int) -> float:
    if entry["kind"] == "linear":
        return ((x - entry["mean"]) / entry["scale"]) * entry["w"][k]
    breaks, seg = entry["breaks"], entry["seg"]
    if x <= breaks[0]:
        s, u = 0, 0.0
    elif x >= breaks[-1]:
        s, u = len(seg) - 1, breaks[-1] - breaks[-2]
    else:
        s = 0
        while s + 1 < len(breaks) - 1 and x >= breaks[s + 1]:
            s += 1
        u = x - breaks[s]
    a, b, c, d = seg[s][k]
    return a + b * u + c * u * u + d * u * u * u


def predict_proba_linear(model: dict, x: dict) -> dict[str, float]:
    n_eff = len(model["intercept"])
    dec = list(model["intercept"])
    for feat, entry in model["numeric"].items():
        v = x.get(feat)
        if v is None or (isinstance(v, float) and math.isnan(v)):
            continue
        for k in range(n_eff):
            dec[k] += _numeric_contrib(entry, float(v), k)
    for feat, table in model["categorical"].items():
        row = table.get(str(x.get(feat)), table["_unknown"])
        for k in range(n_eff):
            dec[k] += row[k]

    classes, labels = model["classes"], model["labels"]
    if model["objective"] == "binary":
        p1 = 1.0 / (1.0 + math.exp(-dec[0]))
        by = {classes[0]: 1.0 - p1, classes[1]: p1}
    else:
        m = max(dec)
        ex = [math.exp(d - m) for d in dec]
        s = sum(ex)
        by = dict(zip(classes, (e / s for e in ex)))
    return {l: by[l] for l in labels}

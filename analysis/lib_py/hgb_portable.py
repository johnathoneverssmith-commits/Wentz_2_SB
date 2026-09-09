"""Portable export + reference evaluator for `HistGradientBoostingClassifier`.

The Phase B resolvers M01/M02/M03/M05/M09/M10/M14 chose sklearn HGB. The eventual
TS runtime can't load a joblib pickle, so `export_hgb` flattens a fitted HGB into
plain JSON (baseline + per-class regression-tree forests, category splits
resolved to string sets) and `predict_proba_portable` evaluates it with no
sklearn / numpy-internals dependency. The Python evaluator here is the reference
spec for the TS port — keep them behaviourally identical.

sklearn 1.9 detail: HGB fits an internal `_preprocessor` ColumnTransformer that
emits the categorical columns first (OrdinalEncoder) then the numeric columns,
so tree `feature_idx` is in that reordered space. The export stores features in
that same internal order and records each feature's original name + kind.
"""

from __future__ import annotations

import math
from typing import Any


# ---- export ---------------------------------------------------------------

def _internal_feature_order(feature_names: list[str], is_categorical: list[bool]) -> list[dict]:
    """[categoricals in original order] + [numerics in original order] — matches
    the HGB `_preprocessor` (OrdinalEncoder block, then numeric block)."""
    cats = [{"name": n, "categorical": True}
            for n, c in zip(feature_names, is_categorical) if c]
    nums = [{"name": n, "categorical": False}
            for n, c in zip(feature_names, is_categorical) if not c]
    return cats + nums


def _bitset_members(bitset: Any) -> set[int]:
    """uint32[8] little-endian bitset -> set of set bit positions (0..255)."""
    out: set[int] = set()
    for word_i, word in enumerate(int(w) for w in bitset):
        for bit in range(32):
            if (word >> bit) & 1:
                out.add(word_i * 32 + bit)
    return out


def _export_tree(predictor: Any, feat_kinds: list[bool], cat_values: list[list[str]]) -> list[dict]:
    """One TreePredictor -> list of node dicts (index i is node i).

    node: {"v": leaf_value}                                            (leaf)
        | {"f", "t": num_threshold, "ml", "l", "r"}                    (numeric split)
        | {"f", "cats_left": [str, ...], "ml", "l", "r"}               (categorical split)
    `f` is the internal feature index; `cat_values[f]` gives that feature's
    ordinal->string map (empty for numeric features).
    """
    nodes = predictor.nodes
    out: list[dict] = []
    for n in nodes:
        if int(n["is_leaf"]):
            out.append({"v": float(n["value"])})
            continue
        f = int(n["feature_idx"])
        node = {"f": f, "ml": int(n["missing_go_to_left"]),
                "l": int(n["left"]), "r": int(n["right"])}
        if int(n["is_categorical"]):
            members = _bitset_members(predictor.raw_left_cat_bitsets[int(n["bitset_idx"])])
            vals = cat_values[f]
            node["cats_left"] = sorted(vals[j] for j in members if j < len(vals))
        else:
            node["t"] = float(n["num_threshold"])
        out.append(node)
    return out


def export_hgb(estimator: Any, feature_names: list[str]) -> dict:
    """Fitted HistGradientBoostingClassifier -> portable JSON-able dict."""
    h = estimator
    is_cat = [bool(c) for c in h.is_categorical_]
    features = _internal_feature_order(feature_names, is_cat)

    # ordinal -> string map per INTERNAL feature index (categoricals first).
    enc = h._preprocessor.named_transformers_["encoder"]
    n_internal = len(features)
    cat_values: list[list[str]] = [[] for _ in range(n_internal)]
    for i, cats in enumerate(enc.categories_):           # i = internal cat index
        cat_values[i] = [str(c) for c in cats]

    classes = [str(c) for c in h.classes_]               # raw-prediction order
    n_cls = len(classes)
    objective = "binary" if h.n_trees_per_iteration_ == 1 else "multiclass"

    baseline_raw = list(h._baseline_prediction.ravel()) \
        if hasattr(h._baseline_prediction, "ravel") else [float(h._baseline_prediction)]
    baseline = [float(x) for x in baseline_raw]
    if objective == "binary" and len(baseline) == 1:
        pass                                            # single raw score
    elif len(baseline) != n_cls:                        # multiclass: one per class
        baseline = (baseline * n_cls)[:n_cls]

    feat_kinds = [f["categorical"] for f in features]
    n_tpi = h.n_trees_per_iteration_
    trees_per_class: list[list[list[dict]]] = [[] for _ in range(n_tpi)]
    for iteration in h._predictors:                      # list over boosting iters
        for k in range(n_tpi):
            trees_per_class[k].append(_export_tree(iteration[k], feat_kinds, cat_values))

    return {
        "format": "hgb-portable-1",
        "objective": objective,
        "classes": classes,
        "baseline": baseline,
        "features": features,
        "trees_per_class": trees_per_class,
        "n_iterations": len(h._predictors),
    }


# ---- reference evaluator (spec for the TS port) --------------------------

def _leaf_value(nodes: list[dict], feat: list[dict], x: dict) -> float:
    i = 0
    while True:
        n = nodes[i]
        if "v" in n:
            return n["v"]
        meta = feat[n["f"]]
        val = x.get(meta["name"])
        if meta["categorical"]:
            if val is None:
                go_left = bool(n["ml"])
            else:
                go_left = str(val) in n["cats_left"]
        else:
            if val is None or (isinstance(val, float) and math.isnan(val)):
                go_left = bool(n["ml"])
            else:
                go_left = float(val) <= n["t"]
        i = n["l"] if go_left else n["r"]


def _softmax(xs: list[float]) -> list[float]:
    m = max(xs)
    ex = [math.exp(v - m) for v in xs]
    s = sum(ex)
    return [v / s for v in ex]


def predict_proba_portable(model: dict, x: dict) -> dict[str, float]:
    """{feature_name: value} -> {class: probability}. Mirrors HGB.predict_proba.
    Categorical feature values are compared as strings; unknown / missing values
    follow each split's `missing-left` flag."""
    feat = model["features"]
    raws = []
    for k, forest in enumerate(model["trees_per_class"]):
        base = model["baseline"][k] if k < len(model["baseline"]) else model["baseline"][0]
        raws.append(base + sum(_leaf_value(t, feat, x) for t in forest))

    classes = model["classes"]
    if model["objective"] == "binary":
        p1 = 1.0 / (1.0 + math.exp(-raws[0]))
        return {classes[0]: 1.0 - p1, classes[1]: p1}
    probs = _softmax(raws)
    return dict(zip(classes, probs))

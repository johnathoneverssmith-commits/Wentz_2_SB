"""Shared modeling helpers (§8 baseline toolkit) + §19 forbidden-variable guard."""

from __future__ import annotations

import csv
from pathlib import Path

import matplotlib
import pandas as pd
import polars as pl

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, SplineTransformer, StandardScaler

ARTIFACTS = Path(__file__).resolve().parents[2] / "artifacts"
_CLASSIFICATION_CSV = ARTIFACTS / "schema" / "variable_classification.csv"

_FORBIDDEN_CLASSES = {"LEAKAGE_DO_NOT_USE"}
_BENCHMARK_CLASSES = {"BENCHMARK_ONLY"}


class ForbiddenVariableError(RuntimeError):
    pass


def pl_to_pandas(df: pl.DataFrame, cols: list[str] | None = None) -> pd.DataFrame:
    """polars -> pandas without pyarrow (unavailable on win_arm64)."""
    cols = cols or df.columns
    return pd.DataFrame({c: df[c].to_numpy() for c in cols})


def _load_classification() -> dict[str, str]:
    out: dict[str, str] = {}
    with _CLASSIFICATION_CSV.open(encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            out[row["variable"]] = row["classification"]
    return out


def check_forbidden(features: list[str]) -> dict[str, str]:
    """Raise if any feature is LEAKAGE; warn-return if BENCHMARK_ONLY (§9/§10/§19)."""
    classes = _load_classification()
    verdict: dict[str, str] = {}
    bad = []
    for f in features:
        c = classes.get(f, "UNCLASSIFIED")
        verdict[f] = c
        if c in _FORBIDDEN_CLASSES:
            bad.append(f"{f} [{c}]")
        if c in _BENCHMARK_CLASSES:
            bad.append(f"{f} [{c} — benchmark only, not a fitted input]")
    if bad:
        raise ForbiddenVariableError(
            "features violate §10/§19 variable classification: " + "; ".join(bad)
        )
    return verdict


def make_spline_logistic(
    *,
    spline_cols: list[str],
    linear_cols: list[str],
    categorical_cols: list[str],
    C: float = 1.0,
    n_knots: int = 5,
    degree: int = 3,
    multinomial: bool = True,
) -> Pipeline:
    """§8 primary baseline: SplineTransformer + OneHotEncoder + (multinomial) LogisticRegression."""
    transformers = []
    if spline_cols:
        transformers.append(
            ("spline", SplineTransformer(n_knots=n_knots, degree=degree, include_bias=False), spline_cols)
        )
    if linear_cols:
        transformers.append(("linear", StandardScaler(), linear_cols))
    if categorical_cols:
        transformers.append(
            ("cat", OneHotEncoder(handle_unknown="ignore", drop=None), categorical_cols)
        )
    pre = ColumnTransformer(transformers, remainder="drop", verbose_feature_names_out=True)
    # sklearn >=1.7 removed the `multi_class` arg; lbfgs multiclass is multinomial (softmax) by default.
    _ = multinomial
    clf = LogisticRegression(C=C, max_iter=3000, solver="lbfgs")
    return Pipeline([("pre", pre), ("clf", clf)])


def make_hgb(categorical_cols: list[str], all_cols: list[str], **kw) -> HistGradientBoostingClassifier:
    """§8 challenger: well-calibrated tree with native categorical handling."""
    cat_mask = [c in set(categorical_cols) for c in all_cols]
    params = dict(
        learning_rate=0.05,
        max_iter=400,
        max_leaf_nodes=31,
        l2_regularization=1.0,
        early_stopping=True,
        validation_fraction=0.1,
        random_state=0,
        categorical_features=cat_mask,
    )
    params.update(kw)
    return HistGradientBoostingClassifier(**params)


def calibration_plot(curves: dict[str, dict], path: Path, title: str) -> Path:
    """curves: label -> lib_py.metrics.reliability_curve output."""
    fig, ax = plt.subplots(figsize=(5, 5))
    ax.plot([0, 1], [0, 1], "--", color="0.6", lw=1, label="perfect")
    for label, c in curves.items():
        xs = [x for x in c["mean_predicted"] if x is not None]
        ys = [y for x, y in zip(c["mean_predicted"], c["fraction_positive"]) if x is not None]
        ax.plot(xs, ys, marker="o", ms=4, label=label)
    ax.set_xlabel("mean predicted probability")
    ax.set_ylabel("observed frequency")
    ax.set_title(title)
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.legend(fontsize=8)
    fig.tight_layout()
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=110)
    plt.close(fig)
    return path


def field_position_band(yardline_100: np.ndarray) -> np.ndarray:
    """§21 field-position bands. `yardline_100` = yards to the OPPONENT end zone,
    so 0-10 is at the opponent goal line and 90-100 is backed up at your own."""
    edges = [0, 10, 20, 40, 60, 80, 100]
    labels = ["opp_gl_10", "opp_10_20", "opp_20_40", "midfield", "own_40_20", "own_20_gl"]
    idx = np.clip(np.digitize(yardline_100, edges[1:-1]), 0, len(labels) - 1)
    return np.array(labels)[idx]

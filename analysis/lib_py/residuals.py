"""Phase D step 1 (§13.2) — historical residual skill variance.

For each resolver: expected outcome from the Phase-B context-only model, then
per-unit (player / team) mean of (actual − expected), empirical-Bayes shrunk
toward 0 by opportunity count. The spread (SD, p10, p90) of the shrunk
residuals is the *variance budget* for that unit's rating-layer coefficients
(§13.3). No current game ratings are used to fit anything here.
"""

from __future__ import annotations

import numpy as np
import polars as pl


def eb_shrink(raw_mean: np.ndarray, n: np.ndarray, k: float) -> np.ndarray:
    """Shrink a per-unit mean toward 0 by n/(n+k)."""
    return (n / (n + k)) * raw_mean


def unit_residual_spread(
    unit: np.ndarray,
    actual: np.ndarray,
    expected: np.ndarray,
    *,
    k: float,
    min_n: int,
    label: str,
) -> dict:
    """actual/expected are per-play; `unit` is the player/team id per play."""
    resid = actual - expected
    df = pl.DataFrame({"unit": unit, "r": resid})
    agg = (
        df.group_by("unit")
        .agg(pl.len().alias("n"), pl.col("r").mean().alias("raw_mean"))
        .filter(pl.col("n") >= min_n)
        .filter(pl.col("unit").is_not_null() & (pl.col("unit") != ""))
    )
    n = agg["n"].to_numpy().astype(float)
    raw = agg["raw_mean"].to_numpy()
    shrunk = eb_shrink(raw, n, k)
    return {
        "label": label,
        "units": int(len(shrunk)),
        "total_opportunities": int(n.sum()),
        "k": k,
        "min_n": min_n,
        "raw_sd": float(raw.std()) if len(raw) > 1 else 0.0,
        "shrunk_sd": float(shrunk.std()) if len(shrunk) > 1 else 0.0,
        "shrunk_p10": float(np.percentile(shrunk, 10)) if len(shrunk) else 0.0,
        "shrunk_p50": float(np.percentile(shrunk, 50)) if len(shrunk) else 0.0,
        "shrunk_p90": float(np.percentile(shrunk, 90)) if len(shrunk) else 0.0,
        "shrunk_p10_to_p90": (
            float(np.percentile(shrunk, 90) - np.percentile(shrunk, 10)) if len(shrunk) else 0.0
        ),
        "top5": agg.sort("raw_mean", descending=True).head(5).to_dicts(),
        "bottom5": agg.sort("raw_mean").head(5).to_dicts(),
    }


def load_estimator(stem: str):
    import joblib
    from .report import ARTIFACTS

    bundle = joblib.load(ARTIFACTS / "models" / f"{stem}.joblib")
    return bundle["estimator"], bundle["labels"], bundle["features"]


def predict_class_prob(estimator, labels, features, X_pd, target_label: str) -> np.ndarray:
    proba = estimator.predict_proba(X_pd[features])
    j = list(estimator.classes_).index(target_label)
    return proba[:, j]


def expected_yards_from_pmf(
    proba: np.ndarray, labels: list[str], buckets: np.ndarray, exact: pl.DataFrame
) -> np.ndarray:
    """E[yards] = sum_c P(c) * E[yards | c, bucket] using the exact-yard PMF parquet."""
    # E[yards | category, ctx_bucket]
    ey = (
        exact.group_by(["category", "ctx_bucket"])
        .agg((pl.col("yards") * pl.col("prob")).sum().alias("num"), pl.col("prob").sum().alias("den"))
        .with_columns((pl.col("num") / pl.col("den")).alias("ey"))
    )
    lut = {(r["category"], r["ctx_bucket"]): r["ey"] for r in ey.to_dicts()}
    # category-global fallback
    eg = (
        exact.group_by("category")
        .agg((pl.col("yards") * pl.col("prob")).sum().alias("num"), pl.col("prob").sum().alias("den"))
        .with_columns((pl.col("num") / pl.col("den")).alias("ey"))
    )
    gfb = {r["category"]: r["ey"] for r in eg.to_dicts()}

    out = np.zeros(len(buckets))
    for ci, c in enumerate(labels):
        ec = np.array([lut.get((c, b), gfb.get(c, 0.0)) for b in buckets])
        out += proba[:, ci] * ec
    return out

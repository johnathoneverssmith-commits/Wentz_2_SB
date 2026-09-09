"""§8 model-selection metrics.

Probability calibration is the selection driver (§8); ROC-AUC is reported but
must not drive selection.
"""

from __future__ import annotations

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score

_EPS = 1e-12


def _clip(p: np.ndarray) -> np.ndarray:
    return np.clip(p, _EPS, 1 - _EPS)


def _logit(p: np.ndarray) -> np.ndarray:
    p = _clip(p)
    return np.log(p / (1 - p))


def calibration_slope_intercept(y_true: np.ndarray, p_pred: np.ndarray) -> tuple[float, float]:
    """Regress y on logit(p): slope 1 / intercept 0 == perfectly calibrated.

    Returns (nan, nan) when the slice has fewer than two outcome classes.
    """
    y = np.asarray(y_true, int)
    if len(np.unique(y)) < 2:
        return float("nan"), float("nan")
    z = _logit(np.asarray(p_pred, float)).reshape(-1, 1)
    lr = LogisticRegression(C=1e12, solver="lbfgs", max_iter=1000)  # ~unregularised
    lr.fit(z, y)
    return float(lr.coef_[0, 0]), float(lr.intercept_[0])


def expected_calibration_error(y_true: np.ndarray, p_pred: np.ndarray, n_bins: int = 10) -> float:
    y_true = np.asarray(y_true, float)
    p_pred = np.asarray(p_pred, float)
    edges = np.linspace(0.0, 1.0, n_bins + 1)
    idx = np.clip(np.digitize(p_pred, edges[1:-1]), 0, n_bins - 1)
    ece = 0.0
    n = len(p_pred)
    for b in range(n_bins):
        m = idx == b
        if not m.any():
            continue
        ece += (m.sum() / n) * abs(p_pred[m].mean() - y_true[m].mean())
    return float(ece)


def reliability_curve(y_true: np.ndarray, p_pred: np.ndarray, n_bins: int = 10) -> dict:
    y_true = np.asarray(y_true, float)
    p_pred = np.asarray(p_pred, float)
    edges = np.linspace(0.0, 1.0, n_bins + 1)
    idx = np.clip(np.digitize(p_pred, edges[1:-1]), 0, n_bins - 1)
    mean_pred, frac_pos, count = [], [], []
    for b in range(n_bins):
        m = idx == b
        count.append(int(m.sum()))
        mean_pred.append(float(p_pred[m].mean()) if m.any() else None)
        frac_pos.append(float(y_true[m].mean()) if m.any() else None)
    return {"mean_predicted": mean_pred, "fraction_positive": frac_pos, "count": count}


def binary_metrics(y_true, p_pred, *, label: str = "") -> dict:
    y_true = np.asarray(y_true, int)
    p_pred = _clip(np.asarray(p_pred, float))
    slope, intercept = calibration_slope_intercept(y_true, p_pred)
    out = {
        "label": label,
        "n": int(len(y_true)),
        "base_rate": float(y_true.mean()),
        "mean_pred": float(p_pred.mean()),
        "log_loss": float(log_loss(y_true, p_pred, labels=[0, 1])),
        "brier": float(brier_score_loss(y_true, p_pred)),
        "calibration_slope": slope,
        "calibration_intercept": intercept,
        "ece": expected_calibration_error(y_true, p_pred),
    }
    try:
        out["roc_auc"] = float(roc_auc_score(y_true, p_pred))
    except ValueError:
        out["roc_auc"] = None
    return out


def multiclass_metrics(y_true, P_pred, labels, *, label: str = "") -> dict:
    """Multiclass log loss + Brier + per-class one-vs-rest calibration (§8)."""
    y_true = np.asarray(y_true)
    P_pred = _clip(np.asarray(P_pred, float))
    label_index = {c: i for i, c in enumerate(labels)}
    y_idx = np.array([label_index[v] for v in y_true])
    Y = np.eye(len(labels))[y_idx]

    per_class = {}
    for i, c in enumerate(labels):
        per_class[str(c)] = binary_metrics(Y[:, i], P_pred[:, i], label=str(c))

    return {
        "label": label,
        "n": int(len(y_true)),
        "labels": [str(c) for c in labels],
        "class_distribution": {str(c): float((y_idx == i).mean()) for i, c in enumerate(labels)},
        "mean_pred": {str(c): float(P_pred[:, i].mean()) for i, c in enumerate(labels)},
        "log_loss": float(log_loss(y_idx, P_pred, labels=list(range(len(labels))))),
        "brier_multiclass": float(np.mean(np.sum((P_pred - Y) ** 2, axis=1))),
        "per_class": per_class,
    }

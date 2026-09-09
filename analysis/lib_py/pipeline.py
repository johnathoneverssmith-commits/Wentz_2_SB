"""Shared classification-resolver flow (§7 protocol + §8 selection + §20 report).

Each binary/multiclass resolver supplies a `ResolverSpec` and a `build_frame`
callable; this runs the dev sweep, locked test, production refit, §21 slices,
and writes all artifacts + the §20 report.

Yardage-distribution resolvers use `lib_py.yardage` instead.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import joblib
import numpy as np
import polars as pl
from sklearn.base import clone
from sklearn.metrics import log_loss as _log_loss

from .metrics import binary_metrics, multiclass_metrics, reliability_curve
from .modeling import (
    calibration_plot,
    check_forbidden,
    field_position_band,
    make_hgb,
    make_spline_logistic,
    pl_to_pandas,
)
from .pbp import load_clean
from .report import ARTIFACTS, ModelReport, metrics_table, rows_by_season_table
from .split import STANDARD, Split

# Prefer the simpler model unless the challenger beats it on dev-val log loss by
# more than this (§8: "do not choose the more complicated model merely because
# discrimination is slightly higher").
HGB_PREFERENCE_MARGIN = 0.003


@dataclass
class ResolverSpec:
    model_id: str
    name: str
    labels: list[str]
    source_cols: list[str]
    spline_cols: list[str]
    linear_cols: list[str]
    cat_cols: list[str]
    target_definition: str
    eligible_population: str
    split: Split = STANDARD
    c_grid: tuple[float, ...] = (0.3, 1.0, 3.0)
    missingness_note: str = "All predictors are STATE / already-simulated INTERMEDIATE fields; no imputation beyond what each note states."
    residual_variance_note: str = (
        "N/A for the baseline (Phase B). The player-rating layer and its "
        "historical-residual-variance calibration begin in Phase D."
    )
    # §21 slice columns present in the frame (auto-used if found)
    slice_cols: tuple[str, ...] = (
        "down", "ydstogo", "yardline_100", "qtr", "game_seconds_remaining",
        "score_differential", "shotgun", "depth_category",
    )


def _xy(df: pl.DataFrame, spec: ResolverSpec):
    num = spec.spline_cols + spec.linear_cols
    cols = num + spec.cat_cols
    X = pl_to_pandas(df, cols)
    for c in num:
        X[c] = X[c].astype(float)
    for c in spec.cat_cols:
        X[c] = X[c].astype(str)
    y = df["target"].to_numpy()
    return X, y


def _fit_predict(estimator, Xtr, ytr, Xte, labels):
    est = clone(estimator)
    est.fit(Xtr, ytr)
    proba = est.predict_proba(Xte)
    order = [list(est.classes_).index(l) for l in labels]
    return est, proba[:, order]


def _evaluate(y, proba, labels, tag):
    if len(labels) == 2:
        m = binary_metrics((y == labels[1]).astype(int), proba[:, 1], label=tag)
        curves = {labels[1]: reliability_curve((y == labels[1]).astype(int), proba[:, 1])}
        return {"metrics": m, "reliability": curves, "logloss": m["log_loss"]}
    m = multiclass_metrics(y, proba, labels, label=tag)
    curves = {lab: reliability_curve((y == lab).astype(int), proba[:, i]) for i, lab in enumerate(labels)}
    return {"metrics": m, "reliability": curves, "logloss": m["log_loss"]}


def _slice_calibration(df: pl.DataFrame, proba: np.ndarray, spec: ResolverSpec) -> dict:
    y = df["target"].to_numpy()
    labels = spec.labels
    li = {c: i for i, c in enumerate(labels)}
    yi = np.array([li[v] for v in y])
    n = df.height

    def mc_ll(mask):
        return float(_log_loss(yi[mask], proba[mask], labels=list(range(len(labels)))))

    def rates(mask):
        return {
            "obs": {lab: float((y[mask] == lab).mean()) for lab in labels},
            "pred": {lab: float(proba[mask, i].mean()) for i, lab in enumerate(labels)},
        }

    slicers: dict[str, np.ndarray] = {}
    if "down" in df.columns:
        slicers["down"] = df["down"].cast(pl.Int64, strict=False).to_numpy().astype(str)
    if "ydstogo" in df.columns:
        d = df["ydstogo"].to_numpy().astype(float)
        slicers["distance"] = np.where(d <= 2, "1-2", np.where(d <= 5, "3-5", np.where(d <= 9, "6-9", "10+")))
    if "yardline_100" in df.columns:
        slicers["field_position"] = field_position_band(df["yardline_100"].to_numpy().astype(float))
    if "qtr" in df.columns:
        slicers["quarter"] = df["qtr"].cast(pl.Int64, strict=False).to_numpy().astype(str)
    if "score_differential" in df.columns:
        sd = df["score_differential"].to_numpy().astype(float)
        slicers["score_state"] = np.where(sd > 0, "leading", np.where(sd < 0, "trailing", "tied"))
    if "game_seconds_remaining" in df.columns:
        g = df["game_seconds_remaining"].to_numpy().astype(float)
        slicers["late_game"] = np.where(g <= 300, "final_5min", "normal")
    if "shotgun" in df.columns:
        slicers["shotgun"] = df["shotgun"].cast(pl.Int8, strict=False).fill_null(0).to_numpy().astype(str)
    if "depth_category" in df.columns:
        slicers["air_yard_depth"] = df["depth_category"].to_numpy().astype(str)
    if "season" in df.columns:
        slicers["season"] = df["season"].cast(pl.Int64).to_numpy().astype(str)

    out: dict[str, dict] = {}
    for name, arr in slicers.items():
        per = {}
        for lvl in sorted(set(arr.tolist())):
            mask = arr == lvl
            if mask.sum() < 100:
                continue
            per[str(lvl)] = {"n": int(mask.sum()), "log_loss": mc_ll(mask), **rates(mask)}
        if per:
            out[name] = per
    return out


def _merge_json(path: Path, key: str, payload: dict) -> None:
    existing = json.loads(path.read_text()) if path.exists() else {}
    existing[key] = payload
    path.write_text(json.dumps(existing, indent=2, default=str) + "\n", encoding="utf-8")


def _slices_md(slices: dict, labels: list[str]) -> str:
    out = []
    for name, per in slices.items():
        out.append(f"**{name}**\n")
        head = "obs " + "/".join(labels)
        out.append(f"| level | n | log loss | {head} | pred |")
        out.append("| --- | ---: | ---: | --- | --- |")
        for lvl, d in per.items():
            o = "/".join(f"{d['obs'][l]:.2f}" for l in labels)
            p = "/".join(f"{d['pred'][l]:.2f}" for l in labels)
            out.append(f"| {lvl} | {d['n']:,} | {d['log_loss']:.4f} | {o} | {p} |")
        out.append("")
    return "\n".join(out)


def _per_class_calib(mc: dict, labels: list[str]) -> str:
    if "per_class" not in mc:
        b = mc
        return (
            "| slope | intercept | ECE |\n| ---: | ---: | ---: |\n"
            f"| {b['calibration_slope']:.3f} | {b['calibration_intercept']:.3f} | {b['ece']:.4f} |"
        )
    rows = ["| class | slope | intercept | ECE |", "| --- | ---: | ---: | ---: |"]
    for c in labels:
        pc = mc["per_class"][c]
        rows.append(f"| {c} | {pc['calibration_slope']:.3f} | {pc['calibration_intercept']:.3f} | {pc['ece']:.4f} |")
    return "\n".join(rows)


def run_resolver(spec: ResolverSpec, build_frame: Callable[[tuple[int, ...]], pl.DataFrame]) -> dict:
    verdict = check_forbidden(spec.source_cols)
    S = spec.split
    labels = spec.labels
    binary = len(labels) == 2

    frames = {k: build_frame(v) for k, v in {
        "dev_train": S.dev_train, "dev_val": S.dev_val,
        "locked_train": S.locked_train, "locked_test": S.locked_test,
        "production": S.production,
    }.items()}
    counts = {s: build_frame((s,)).height for s in S.production}
    prod_y = frames["production"]["target"].to_numpy()
    class_dist = {lab: float((prod_y == lab).mean()) for lab in labels}

    ll_key = "log_loss"

    # ---- dev sweep --------------------------------------------------------
    candidates: dict[str, float] = {}
    Xtr, ytr = _xy(frames["dev_train"], spec)
    Xva, yva = _xy(frames["dev_val"], spec)
    for C in spec.c_grid:
        est = make_spline_logistic(
            spline_cols=spec.spline_cols, linear_cols=spec.linear_cols,
            categorical_cols=spec.cat_cols, C=C,
        )
        _, proba = _fit_predict(est, Xtr, ytr, Xva, labels)
        candidates[f"logistic|C={C}"] = _evaluate(yva, proba, labels, f"logistic C={C}")["logloss"]
    hgb = make_hgb(categorical_cols=spec.cat_cols, all_cols=list(Xtr.columns))
    _, proba = _fit_predict(hgb, Xtr, ytr, Xva, labels)
    candidates["hgb"] = _evaluate(yva, proba, labels, "hgb")["logloss"]

    best_logistic = min((k for k in candidates if k.startswith("logistic")), key=lambda k: candidates[k])
    use_hgb = candidates["hgb"] < candidates[best_logistic] - HGB_PREFERENCE_MARGIN
    chosen = "hgb" if use_hgb else best_logistic
    C = None if use_hgb else float(best_logistic.split("C=")[1])

    def make_final(cols):
        if use_hgb:
            return make_hgb(categorical_cols=spec.cat_cols, all_cols=cols)
        return make_spline_logistic(
            spline_cols=spec.spline_cols, linear_cols=spec.linear_cols,
            categorical_cols=spec.cat_cols, C=C,
        )

    # ---- locked test (once) --------------------------------------------
    Xlt, ylt = _xy(frames["locked_train"], spec)
    Xte, yte = _xy(frames["locked_test"], spec)
    locked_est, locked_proba = _fit_predict(make_final(list(Xlt.columns)), Xlt, ylt, Xte, labels)
    locked_eval = _evaluate(yte, locked_proba, labels, "locked_2025")
    slices = _slice_calibration(frames["locked_test"], locked_proba, spec)

    # chosen model's 2024 validation metrics
    _, val_proba = _fit_predict(make_final(list(Xtr.columns)), Xtr, ytr, Xva, labels)
    val_eval = _evaluate(yva, val_proba, labels, "validation_2024")

    # ---- production refit --------------------------------------------
    Xp, yp = _xy(frames["production"], spec)
    prod_est = make_final(list(Xp.columns))
    prod_est.fit(Xp, yp)

    models_dir = ARTIFACTS / "models"
    val_dir = ARTIFACTS / "validation"
    models_dir.mkdir(parents=True, exist_ok=True)
    val_dir.mkdir(parents=True, exist_ok=True)
    stem = spec.model_id.lower()
    joblib.dump(
        {"estimator": prod_est, "labels": labels, "features": list(Xp.columns), "architecture": chosen},
        models_dir / f"{stem}.joblib",
    )
    coef_out: dict = {}
    if not use_hgb:
        clf = prod_est.named_steps["clf"]
        names = list(prod_est.named_steps["pre"].get_feature_names_out())
        coef_out = {
            "classes": list(prod_est.classes_),
            "intercept": clf.intercept_.tolist(),
            "coef": {str(c): dict(zip(names, row.tolist())) for c, row in zip(prod_est.classes_, np.atleast_2d(clf.coef_))},
        }
    (models_dir / f"{stem}.coef.json").write_text(json.dumps(coef_out, indent=2) + "\n", encoding="utf-8")

    plot_curves = locked_eval["reliability"]
    cal_png = calibration_plot(
        plot_curves, val_dir / f"{stem}_calibration_2025.png",
        f"{spec.model_id} {spec.name} — 2025 locked test calibration",
    )

    _merge_json(val_dir / "model_metrics.json", spec.model_id, {
        "dev_candidates_2024_logloss": candidates, "chosen": chosen,
        "validation_2024": val_eval["metrics"],
    })
    _merge_json(val_dir / "holdout_2025_metrics.json", spec.model_id, {
        "locked_test_2025": locked_eval["metrics"], "conditional_slices_2025": slices,
    })

    # ---- §20 report -------------------------------------------------
    def mtable(m):
        keys = ["n", ll_key, "brier"] if binary else ["n", ll_key, "brier_multiclass"]
        return metrics_table(m, [k for k in keys if k in m])

    rep = ModelReport(spec.model_id, spec.name)
    rep.set("target definition", spec.target_definition)
    rep.set("eligible population", spec.eligible_population)
    rep.set("row count by season", rows_by_season_table(counts))
    rep.set("missingness", spec.missingness_note)
    rep.set("class distribution / target distribution",
            metrics_table(class_dist, labels) + "\n\n(pooled 2023–2025)")
    rep.set("predictor list",
            "spline: " + (", ".join(spec.spline_cols) or "—")
            + "  \nlinear: " + (", ".join(spec.linear_cols) or "—")
            + "  \ncategorical: " + (", ".join(spec.cat_cols) or "—"))
    rep.set("forbidden-variable check",
            "All source columns pass §19 classification:\n\n"
            + "\n".join(f"- `{k}` → {v}" for k, v in verdict.items())
            + "\n\nNo LEAKAGE / BENCHMARK_ONLY fields used. Player modifiers: none (Phase B).")
    rep.set("baseline model",
            "SplineTransformer(n_knots=5, degree=3) on continuous predictors + OneHotEncoder on "
            "categoricals + " + ("logistic" if binary else "multinomial logistic") + " regression (lbfgs). "
            "C picked on 2024 dev-validation log loss.")
    rep.set("challenger models",
            "HistGradientBoostingClassifier (native categorical, early stopping). "
            f"Preferred only if it beats the best logistic by > {HGB_PREFERENCE_MARGIN} log loss.\n\n"
            "2024 dev-validation log loss:\n\n"
            + "\n".join(f"- {k}: {v:.5f}" for k, v in sorted(candidates.items(), key=lambda kv: kv[1])))
    rep.set("2024 validation metrics",
            mtable(val_eval["metrics"]) + "\n\ncalibration:\n\n" + _per_class_calib(val_eval["metrics"], labels))
    rep.set("2025 locked test metrics",
            mtable(locked_eval["metrics"]) + "\n\ncalibration:\n\n" + _per_class_calib(locked_eval["metrics"], labels))
    rep.set("calibration plots", f"![calibration]({cal_png.relative_to(ARTIFACTS).as_posix()})")
    rep.set("important conditional diagnostics", _slices_md(slices, labels) or "- no material conditional miscalibration.")
    rep.set("historical residual variance estimates", spec.residual_variance_note)
    rep.set("final chosen model",
            f"`{chosen}`" + ("" if use_hgb else f" (C={C})")
            + f". HGB dev-val log loss {candidates['hgb']:.5f} vs best logistic "
            f"{candidates[best_logistic]:.5f}.")
    rep.set("production refit metadata",
            f"Refit on seasons {list(S.production)} (n={Xp.shape[0]:,}). "
            f"Artifacts: `artifacts/models/{stem}.joblib`, `{stem}.coef.json`"
            + ("" if use_hgb else " (coefficients).")
            + " 2025 holdout stored before refit in `artifacts/validation/holdout_2025_metrics.json`.")
    rep.data("chosen_architecture", chosen)
    md_path, _ = rep.write()

    print(f"{spec.model_id} {spec.name}: chosen={chosen}  "
          f"2024_val_ll={val_eval['logloss']:.5f}  2025_locked_ll={locked_eval['logloss']:.5f}")
    return {"chosen": chosen, "val_2024": val_eval["metrics"], "locked_2025": locked_eval["metrics"]}

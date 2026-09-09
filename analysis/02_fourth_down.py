"""Model 01 — Fourth-down action (spec §11 M01).

Multinomial GO_FOR_IT / FIELD_GOAL / PUNT for `down == 4`.
Baseline: SplineTransformer + OneHotEncoder + multinomial LogisticRegression.
Challenger: HistGradientBoostingClassifier.

Protocol (§7):
  dev     : train 2023      -> validate 2024   (choose env features on/off, C)
  locked  : train 2023+2024 -> test 2025       (evaluated once, not tuned on)
  production refit : 2023+2024+2025

No player-rating modifiers (Phase B). `overall` is never an input.

Run: analysis/.venv/Scripts/python analysis/02_fourth_down.py
"""

from __future__ import annotations

import lib_py  # thread-env setup; MUST precede numpy/polars

import json
from pathlib import Path

import numpy as np
import polars as pl
from sklearn.base import clone
from sklearn.metrics import log_loss as _log_loss

from lib_py.metrics import binary_metrics, multiclass_metrics, reliability_curve
from lib_py.modeling import (
    calibration_plot,
    check_forbidden,
    field_position_band,
    make_hgb,
    make_spline_logistic,
    pl_to_pandas,
)
from lib_py.pbp import load_clean
from lib_py.report import ARTIFACTS, ModelReport, metrics_table, rows_by_season_table
from lib_py.split import STANDARD

MODEL_ID = "M01"
LABELS = ["GO_FOR_IT", "FIELD_GOAL", "PUNT"]

# §11 M01 allowed predictors. All STATE per artifacts/schema/variable_classification.csv.
SOURCE_COLS = [
    "ydstogo", "yardline_100", "goal_to_go", "qtr", "game_seconds_remaining",
    "half_seconds_remaining", "score_differential", "posteam_timeouts_remaining",
    "defteam_timeouts_remaining", "roof", "wind", "temp",
]
POP_COLS = ["down", "qb_kneel", "qb_spike", "field_goal_attempt", "punt_attempt",
            "pass_attempt", "rush_attempt", "season", "game_id"]

_DROPPED_NO_ACTION: dict[tuple[int, ...], int] = {}

SPLINE_COLS = ["ydstogo", "yardline_100", "game_seconds_remaining", "score_differential"]
LINEAR_COLS = ["half_seconds_remaining", "posteam_timeouts_remaining", "defteam_timeouts_remaining"]
CAT_COLS = ["goal_to_go", "qtr", "roof"]
ENV_COLS = ["env_temp", "env_wind", "temp_missing"]  # §17.1-guarded, optional


def build_frame(seasons: tuple[int, ...]) -> pl.DataFrame:
    df = load_clean(seasons, base="core", columns=sorted({*SOURCE_COLS, *POP_COLS}))
    df = df.filter(
        (pl.col("down") == 4)
        & (pl.col("qb_kneel").cast(pl.Int8, strict=False).fill_null(0) != 1)
        & (pl.col("qb_spike").cast(pl.Int8, strict=False).fill_null(0) != 1)
    )

    fg = pl.col("field_goal_attempt").cast(pl.Int8, strict=False).fill_null(0) == 1
    punt = pl.col("punt_attempt").cast(pl.Int8, strict=False).fill_null(0) == 1
    scrimmage = (
        (pl.col("pass_attempt").cast(pl.Int8, strict=False).fill_null(0) == 1)
        | (pl.col("rush_attempt").cast(pl.Int8, strict=False).fill_null(0) == 1)
    )
    df = df.with_columns(
        pl.when(fg).then(pl.lit("FIELD_GOAL"))
        .when(punt).then(pl.lit("PUNT"))
        .when(scrimmage).then(pl.lit("GO_FOR_IT"))
        .otherwise(pl.lit(None))
        .alias("action")
    )
    _DROPPED_NO_ACTION[tuple(seasons)] = df.filter(pl.col("action").is_null()).height
    df = df.filter(pl.col("action").is_not_null())

    # §17.1 — roof is a required categorical; temp/wind only vary for outdoor games.
    is_outdoor = pl.col("roof").is_in(["outdoors", "open"])
    out_temp_median = (
        df.filter(is_outdoor & pl.col("temp").is_not_null())["temp"].median() or 60.0
    )
    df = df.with_columns(
        pl.when(is_outdoor).then(pl.col("temp")).otherwise(None).alias("_ot"),
        pl.when(is_outdoor).then(pl.col("wind")).otherwise(None).alias("_ow"),
    ).with_columns(
        pl.col("_ot").fill_null(out_temp_median).alias("env_temp"),
        pl.col("_ow").fill_null(0.0).alias("env_wind"),
        (is_outdoor & pl.col("temp").is_null()).cast(pl.Int8).alias("temp_missing"),
        pl.col("roof").fill_null("unknown"),
        pl.col("goal_to_go").cast(pl.Int8, strict=False).fill_null(0),
        pl.col("qtr").cast(pl.Int8, strict=False),
    ).drop(["_ot", "_ow"])

    return df


def Xy(df: pl.DataFrame, use_env: bool):
    cols = SPLINE_COLS + LINEAR_COLS + CAT_COLS + (ENV_COLS if use_env else [])
    X = pl_to_pandas(df, cols)
    for c in SPLINE_COLS + LINEAR_COLS + (["env_temp", "env_wind"] if use_env else []):
        X[c] = X[c].astype(float)
    y = df["action"].to_numpy()
    return X, y


def fit_predict(estimator, Xtr, ytr, Xte):
    est = clone(estimator)
    est.fit(Xtr, ytr)
    proba = est.predict_proba(Xte)
    # align proba columns to LABELS order
    order = [list(est.classes_).index(l) for l in LABELS]
    return est, proba[:, order]


def evaluate(df_eval: pl.DataFrame, proba: np.ndarray, tag: str) -> dict:
    y = df_eval["action"].to_numpy()
    mc = multiclass_metrics(y, proba, LABELS, label=tag)
    curves = {
        lab: reliability_curve((y == lab).astype(int), proba[:, i])
        for i, lab in enumerate(LABELS)
    }
    return {"metrics": mc, "reliability": curves}


def slice_calibration(df_eval: pl.DataFrame, proba: np.ndarray) -> dict:
    """§21 conditional calibration on the locked-test set."""
    y = df_eval["action"].to_numpy()
    yl100 = df_eval["yardline_100"].to_numpy().astype(float)
    ydstogo = df_eval["ydstogo"].to_numpy().astype(float)
    qtr = df_eval["qtr"].to_numpy()
    gsr = df_eval["game_seconds_remaining"].to_numpy().astype(float)
    scorediff = df_eval["score_differential"].to_numpy().astype(float)

    dist_band = np.where(ydstogo <= 2, "1-2", np.where(ydstogo <= 5, "3-5", np.where(ydstogo <= 9, "6-9", "10+")))
    fp_band = field_position_band(yl100)
    score_state = np.where(scorediff > 0, "leading", np.where(scorediff < 0, "trailing", "tied"))
    late = np.where(gsr <= 300, "final_5min", "normal")

    out: dict[str, dict] = {}
    for name, arr in [("distance", dist_band), ("field_position", fp_band),
                      ("quarter", qtr.astype(str)), ("score_state", score_state), ("late_game", late)]:
        per = {}
        label_index = {c: i for i, c in enumerate(LABELS)}
        for lvl in sorted(set(arr.tolist())):
            m = arr == lvl
            if m.sum() < 100:
                continue
            yi = np.array([label_index[v] for v in y[m]])
            per[str(lvl)] = {
                "n": int(m.sum()),
                "log_loss": float(_log_loss(yi, proba[m], labels=list(range(len(LABELS))))),
                "obs_rate": {lab: float((y[m] == lab).mean()) for lab in LABELS},
                "pred_rate": {lab: float(proba[m, i].mean()) for i, lab in enumerate(LABELS)},
            }
        out[name] = per
    return out


def main() -> None:
    verdict = check_forbidden(SOURCE_COLS)

    dev_tr = build_frame(STANDARD.dev_train)
    dev_va = build_frame(STANDARD.dev_val)
    locked_tr = build_frame(STANDARD.locked_train)
    locked_te = build_frame(STANDARD.locked_test)
    prod = build_frame(STANDARD.production)

    counts = {s: build_frame((s,)).height for s in STANDARD.production}
    class_dist = {
        lab: float((prod["action"].to_numpy() == lab).mean()) for lab in LABELS
    }

    # ---- dev pass: choose env on/off and C on 2024 ------------------------
    candidates = {}
    for use_env in (False, True):
        for C in (0.3, 1.0, 3.0):
            Xtr, ytr = Xy(dev_tr, use_env)
            Xva, _ = Xy(dev_va, use_env)
            est = make_spline_logistic(
                spline_cols=SPLINE_COLS, linear_cols=LINEAR_COLS + (["env_temp", "env_wind"] if use_env else []),
                categorical_cols=CAT_COLS + (["temp_missing"] if use_env else []), C=C,
            )
            _, proba = fit_predict(est, Xtr, ytr, Xva)
            ev = evaluate(dev_va, proba, f"logistic env={use_env} C={C}")
            candidates[f"logistic|env={use_env}|C={C}"] = ev["metrics"]["log_loss"]

    # challenger — both env settings
    for use_env in (False, True):
        Xtr, ytr = Xy(dev_tr, use_env)
        Xva, _ = Xy(dev_va, use_env)
        cat = CAT_COLS + (["temp_missing"] if use_env else [])
        hgb = make_hgb(categorical_cols=cat, all_cols=list(Xtr.columns))
        _, proba = fit_predict(hgb, Xtr, ytr, Xva)
        candidates[f"hgb|env={use_env}"] = evaluate(dev_va, proba, "hgb")["metrics"]["log_loss"]

    best_key = min(candidates, key=candidates.get)
    use_env = "env=True" in best_key
    is_hgb = best_key.startswith("hgb")
    C = float(best_key.split("C=")[1]) if not is_hgb else None

    def make_final():
        if is_hgb:
            cols = list(Xy(locked_tr, use_env)[0].columns)
            return make_hgb(categorical_cols=CAT_COLS + (["temp_missing"] if use_env else []), all_cols=cols)
        return make_spline_logistic(
            spline_cols=SPLINE_COLS,
            linear_cols=LINEAR_COLS + (["env_temp", "env_wind"] if use_env else []),
            categorical_cols=CAT_COLS + (["temp_missing"] if use_env else []),
            C=C,
        )

    # ---- locked pass: train 2023+2024, evaluate ONCE on 2025 -------------
    Xtr, ytr = Xy(locked_tr, use_env)
    Xte, _ = Xy(locked_te, use_env)
    locked_est, locked_proba = fit_predict(make_final(), Xtr, ytr, Xte)
    locked_eval = evaluate(locked_te, locked_proba, "locked_2025")
    slices = slice_calibration(locked_te, locked_proba)

    # 2024 validation metrics for the chosen model
    Xtr2, ytr2 = Xy(dev_tr, use_env)
    Xva2, _ = Xy(dev_va, use_env)
    _, val_proba = fit_predict(make_final(), Xtr2, ytr2, Xva2)
    val_eval = evaluate(dev_va, val_proba, "validation_2024")

    # ---- production refit: all three seasons ----------------------------
    Xp, yp = Xy(prod, use_env)
    prod_est = make_final()
    prod_est.fit(Xp, yp)

    models_dir = ARTIFACTS / "models"
    models_dir.mkdir(parents=True, exist_ok=True)
    import joblib

    joblib.dump(
        {"estimator": prod_est, "labels": LABELS, "features": list(Xp.columns),
         "use_env": use_env, "architecture": best_key},
        models_dir / "fourth_down.joblib",
    )

    # coefficients (when logistic) for the runtime engine's config
    coef_out = {}
    if not is_hgb:
        clf = prod_est.named_steps["clf"]
        pre = prod_est.named_steps["pre"]
        names = list(pre.get_feature_names_out())
        coef_out = {
            "classes": list(prod_est.classes_),
            "intercept": clf.intercept_.tolist(),
            "coef": {cls: dict(zip(names, row.tolist())) for cls, row in zip(prod_est.classes_, clf.coef_)},
        }
    (models_dir / "fourth_down.coef.json").write_text(json.dumps(coef_out, indent=2) + "\n", encoding="utf-8")

    cal_png = calibration_plot(
        {lab: locked_eval["reliability"][lab] for lab in LABELS},
        ARTIFACTS / "validation" / "fourth_down_calibration_2025.png",
        "M01 fourth-down — 2025 locked test calibration",
    )

    # ---- validation artifacts ------------------------------------------
    val_dir = ARTIFACTS / "validation"
    val_dir.mkdir(parents=True, exist_ok=True)
    _merge_json(val_dir / "model_metrics.json", MODEL_ID, {
        "dev_candidates_2024_logloss": candidates,
        "chosen": best_key,
        "validation_2024": val_eval["metrics"],
    })
    _merge_json(val_dir / "holdout_2025_metrics.json", MODEL_ID, {
        "locked_test_2025": locked_eval["metrics"],
        "conditional_slices_2025": slices,
    })

    # ---- §20 report ---------------------------------------------------
    rep = ModelReport(MODEL_ID, "Fourth-down action")
    rep.set("target definition",
            "`action` ∈ {GO_FOR_IT, FIELD_GOAL, PUNT}. FIELD_GOAL if `field_goal_attempt==1`; "
            "PUNT if `punt_attempt==1`; GO_FOR_IT if a scrimmage play (`pass_attempt` or "
            "`rush_attempt`) occurred. Blocked FGs/punts keep their attempt flag and stay in class.")
    rep.set("eligible population",
            "§6.1 core exclusions + §6.5 REG, then `down == 4` & `qb_kneel==0` & `qb_spike==0` "
            f"(§6.3). Rows on 4th down with no FG/punt/scrimmage classification were dropped: "
            f"{sum(_DROPPED_NO_ACTION.get((s,), 0) for s in STANDARD.production)} across all seasons "
            "(pre-snap defensive penalties, aborted-then-cleaned edge rows).")
    rep.set("row count by season", rows_by_season_table(counts))
    rep.set("missingness",
            "Predictors are STATE fields. `roof` has no nulls in the population; `temp`/`wind` are "
            "structurally null indoors (§17.1) and ~35-45% null for outdoor games — handled by the "
            "`env_temp`/`env_wind` construction (outdoor value or neutral) + `temp_missing` flag, "
            "not row drops or mean-imputation across roof types.")
    rep.set("class distribution / target distribution",
            metrics_table({k: v for k, v in class_dist.items()}, LABELS)
            + "\n\n(share of 4th-down decisions, 2023–2025 pooled)")
    rep.set("predictor list",
            "spline: " + ", ".join(SPLINE_COLS) + "  \nlinear: " + ", ".join(LINEAR_COLS)
            + "  \ncategorical: " + ", ".join(CAT_COLS)
            + f"  \nenvironment (kept={use_env}): " + ", ".join(ENV_COLS))
    rep.set("forbidden-variable check",
            "All source columns pass §19 classification:\n\n"
            + "\n".join(f"- `{k}` → {v}" for k, v in verdict.items())
            + "\n\nNo LEAKAGE / BENCHMARK_ONLY fields used. Player modifiers: none (Phase B).")
    rep.set("baseline model",
            "SplineTransformer(n_knots=5, degree=3) on the continuous predictors + OneHotEncoder "
            "on categoricals + multinomial LogisticRegression (lbfgs). Regularisation C chosen on "
            "the 2024 dev-validation log loss.")
    rep.set("challenger models",
            "HistGradientBoostingClassifier (native categorical, early stopping). "
            "2024 dev-validation multiclass log loss by candidate:\n\n"
            + "\n".join(f"- {k}: {v:.5f}" for k, v in sorted(candidates.items(), key=lambda kv: kv[1])))
    rep.set("2024 validation metrics",
            metrics_table(val_eval["metrics"], ["n", "log_loss", "brier_multiclass"])
            + "\n\nper-class calibration (slope / intercept / ECE):\n\n"
            + _per_class_calib(val_eval["metrics"]))
    rep.set("2025 locked test metrics",
            metrics_table(locked_eval["metrics"], ["n", "log_loss", "brier_multiclass"])
            + "\n\nper-class calibration (slope / intercept / ECE):\n\n"
            + _per_class_calib(locked_eval["metrics"]))
    rep.set("calibration plots", f"![calibration]({cal_png.relative_to(ARTIFACTS).as_posix()})")
    rep.set("important conditional diagnostics", _diagnostics_prose(candidates, slices) + "\n\n" + _slices_md(slices))
    rep.set("historical residual variance estimates",
            "N/A for the baseline (Phase B). M01 has no player-rating layer — the spec only allows a "
            "later kicker-range feasibility constraint on `kick_power`, not a fourth-down aggression "
            "modifier. Residual-variance calibration begins in Phase D for the outcome resolvers.")
    rep.set("final chosen model", f"`{best_key}` (env features {'kept' if use_env else 'dropped'}).")
    rep.set("production refit metadata",
            f"Refit on seasons {list(STANDARD.production)} "
            f"(n={Xp.shape[0]:,}). Artifacts: `artifacts/models/fourth_down.joblib`, "
            "`fourth_down.coef.json`" + ("" if is_hgb else " (multinomial coefficients).")
            + " 2025 holdout metrics stored before refit in "
            "`artifacts/validation/holdout_2025_metrics.json`.")
    md_path, _ = rep.data("chosen_architecture", best_key).write()
    print(f"wrote {md_path}")
    print(f"  chosen: {best_key}")
    print(f"  2024 val log loss : {val_eval['metrics']['log_loss']:.5f}")
    print(f"  2025 locked log loss: {locked_eval['metrics']['log_loss']:.5f}")


def _per_class_calib(mc: dict) -> str:
    rows = ["| class | slope | intercept | ECE |", "| --- | ---: | ---: | ---: |"]
    for c in LABELS:
        pc = mc["per_class"][c]
        rows.append(f"| {c} | {pc['calibration_slope']:.3f} | {pc['calibration_intercept']:.3f} | {pc['ece']:.4f} |")
    return "\n".join(rows)


def _diagnostics_prose(candidates: dict, slices: dict) -> str:
    lines = []
    log = candidates
    env_pairs = [
        (k[:-len("env=True")], log.get(k), log.get(k.replace("env=True", "env=False")))
        for k in log if k.endswith("env=True")
    ]
    deltas = [abs(a - b) for _, a, b in env_pairs if a is not None and b is not None]
    if deltas and max(deltas) < 0.003:
        lines.append(
            f"- **Environment (`roof`/`temp`/`wind`) contributes ~nothing**: max Δ log loss between "
            f"env-on and env-off candidates is {max(deltas):.4f} on 2024 validation. Kept for "
            f"completeness but a future prune is safe."
        )
    dist = slices.get("distance", {})
    if "1-2" in dist:
        d = dist["1-2"]
        gap = d["obs_rate"]["GO_FOR_IT"] - d["pred_rate"]["GO_FOR_IT"]
        if abs(gap) > 0.04:
            lines.append(
                f"- **4th-and-1-2, 2025**: observed GO rate {d['obs_rate']['GO_FOR_IT']:.2f} vs predicted "
                f"{d['pred_rate']['GO_FOR_IT']:.2f} (Δ {gap:+.2f}). The model trained on 2023–24 "
                f"under-predicts short-yardage aggression in 2025 — consistent with the league's rising "
                f"4th-down aggressiveness (spec §16: carry 2025 team/coach residuals as tendency priors; "
                f"do not tune the baseline on 2025)."
            )
    return "\n".join(lines) if lines else "- No material conditional miscalibration."


def _slices_md(slices: dict) -> str:
    out = []
    for name, per in slices.items():
        out.append(f"**{name}**\n")
        out.append("| level | n | log loss | obs GO/FG/PUNT | pred GO/FG/PUNT |")
        out.append("| --- | ---: | ---: | --- | --- |")
        for lvl, d in per.items():
            o = "/".join(f"{d['obs_rate'][l]:.2f}" for l in LABELS)
            p = "/".join(f"{d['pred_rate'][l]:.2f}" for l in LABELS)
            out.append(f"| {lvl} | {d['n']:,} | {d['log_loss']:.4f} | {o} | {p} |")
        out.append("")
    return "\n".join(out)


def _merge_json(path: Path, key: str, payload: dict) -> None:
    existing = json.loads(path.read_text()) if path.exists() else {}
    existing[key] = payload
    path.write_text(json.dumps(existing, indent=2, default=str) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()

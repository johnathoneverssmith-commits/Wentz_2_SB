"""Model 21 — Punt outcome (spec §11 M21).

Sequence: outcome category -> (empirical) punt distance by field position ->
(empirical) return yards when returned. Field position is mandatory: punters
shorten kicks near the opponent goal line. Blocked punts excluded from the
distance fit. `punt_power`/`punt_accuracy`/`coffin_corner`/`hang_time` are
Phase D, calibrated against per-punter residual spread.

Run: analysis/.venv/Scripts/python analysis/19_punts.py
"""

from __future__ import annotations

import lib_py  # thread-env setup; MUST precede numpy/polars

import json

import numpy as np
import polars as pl

from lib_py.pbp import load_clean
from lib_py.pipeline import ResolverSpec, _merge_json, run_resolver
from lib_py.report import ARTIFACTS
from lib_py.split import STANDARD

LABELS = ["RETURNED", "FAIR_CATCH", "DOWNED", "OUT_OF_BOUNDS", "TOUCHBACK"]
SOURCE_COLS = ["yardline_100", "roof", "wind", "temp"]
POP_COLS = [
    "punt_attempt", "punt_blocked", "touchback", "punt_out_of_bounds", "punt_downed",
    "punt_fair_catch", "return_yards", "kick_distance", "season",
]
_i8 = lambda c: pl.col(c).cast(pl.Int8, strict=False).fill_null(0)


def _base(seasons):
    df = load_clean(seasons, base="admin", columns=sorted({*SOURCE_COLS, *POP_COLS}))
    return df.filter((_i8("punt_attempt") == 1) & (_i8("punt_blocked") != 1))


def build_frame(seasons: tuple[int, ...]) -> pl.DataFrame:
    df = _base(seasons)
    is_out = pl.col("roof").is_in(["outdoors", "open"])
    med = df.filter(is_out & pl.col("temp").is_not_null())["temp"].median() or 60.0
    cat = (
        pl.when(_i8("touchback") == 1).then(pl.lit("TOUCHBACK"))
        .when(_i8("punt_out_of_bounds") == 1).then(pl.lit("OUT_OF_BOUNDS"))
        .when(_i8("punt_downed") == 1).then(pl.lit("DOWNED"))
        .when(_i8("punt_fair_catch") == 1).then(pl.lit("FAIR_CATCH"))
        .otherwise(pl.lit("RETURNED"))
    )
    return df.with_columns(
        cat.alias("target"),
        pl.when(is_out).then(pl.col("temp")).otherwise(None).fill_null(med).alias("env_temp"),
        pl.when(is_out).then(pl.col("wind")).otherwise(None).fill_null(0.0).alias("env_wind"),
        (is_out & pl.col("temp").is_null()).cast(pl.Int8).alias("temp_missing"),
        pl.col("roof").fill_null("unknown"),
    )


def _empirical_pmf(vals: np.ndarray) -> dict[int, float]:
    u, c = np.unique(vals, return_counts=True)
    return {int(k): float(v) / len(vals) for k, v in zip(u, c)}


def _dist_tables(_ctx) -> dict[str, str]:
    tr = build_frame(STANDARD.locked_train)
    te = build_frame(STANDARD.locked_test)
    out = ARTIFACTS / "distributions"
    out.mkdir(parents=True, exist_ok=True)

    def fp_band(col="yardline_100"):
        return (pl.col(col) // 10 * 10).cast(pl.Int32)

    # --- punt distance by field-position band ---
    tr_d = tr.with_columns(fp_band().alias("fp"), pl.col("kick_distance").round().cast(pl.Int32).alias("kd"))
    dtab = tr_d.group_by(["fp", "kd"]).agg(pl.len().alias("n")).sort(["fp", "kd"])
    dtab.write_parquet(out / "punt_distance.parquet")
    # holdout mean check
    te_d = te.with_columns(fp_band().alias("fp"))
    pmf_by_fp = {int(f): _empirical_pmf(tr_d.filter(pl.col("fp") == f)["kd"].to_numpy())
                 for f in tr_d["fp"].unique().to_list()}
    obs_kd = te["kick_distance"].to_numpy()
    exp_kd = np.array([
        sum(k * p for k, p in pmf_by_fp.get(int(f), pmf_by_fp[max(pmf_by_fp)]).items())
        for f in te_d["fp"].to_numpy()
    ])
    # --- return yards when RETURNED ---
    tr_r = tr.filter(pl.col("target") == "RETURNED").with_columns(
        pl.col("return_yards").fill_null(0).round().cast(pl.Int32).alias("ry")
    )
    rtab = tr_r.group_by("ry").agg(pl.len().alias("n")).sort("ry")
    rtab.write_parquet(out / "punt_return_yards.parquet")
    ry_pmf = _empirical_pmf(tr_r["ry"].to_numpy())
    te_r = te.filter(pl.col("target") == "RETURNED")["return_yards"].fill_null(0).to_numpy()
    exp_ry = sum(k * p for k, p in ry_pmf.items())

    metrics = {
        "punt_distance": {
            "obs_mean_2025": float(obs_kd.mean()), "model_mean_2025": float(exp_kd.mean()),
            "obs_p10": float(np.percentile(obs_kd, 10)), "obs_p90": float(np.percentile(obs_kd, 90)),
            "bins": dtab.height,
        },
        "punt_return_yards": {
            "obs_mean_2025": float(te_r.mean()), "model_mean_2025": float(exp_ry),
            "obs_house_rate_ge40": float((te_r >= 40).mean()),
            "model_house_rate_ge40": float(sum(p for k, p in ry_pmf.items() if k >= 40)),
        },
    }
    _merge_json(ARTIFACTS / "validation" / "holdout_2025_metrics.json", "M21_distribution", metrics)

    md = [
        "Punt **distance** and **return yards** are empirical PMFs (locked-train), not fitted "
        "models — `artifacts/distributions/punt_distance.parquet` (by 10-yд field-position band) "
        "and `punt_return_yards.parquet`.",
        "",
        "| quantity | obs 2025 | model | note |",
        "| --- | ---: | ---: | --- |",
        f"| punt distance mean | {metrics['punt_distance']['obs_mean_2025']:.1f} | "
        f"{metrics['punt_distance']['model_mean_2025']:.1f} | p10/p90 obs "
        f"{metrics['punt_distance']['obs_p10']:.0f}/{metrics['punt_distance']['obs_p90']:.0f} |",
        f"| return yards mean (returned) | {metrics['punt_return_yards']['obs_mean_2025']:.1f} | "
        f"{metrics['punt_return_yards']['model_mean_2025']:.1f} | house(≥40) obs "
        f"{metrics['punt_return_yards']['obs_house_rate_ge40']:.3f} / model "
        f"{metrics['punt_return_yards']['model_house_rate_ge40']:.3f} |",
    ]
    return {"calibration plots": "\n".join(md)}


SPEC = ResolverSpec(
    model_id="M21",
    name="Punt outcome",
    labels=LABELS,
    source_cols=SOURCE_COLS,
    spline_cols=["yardline_100", "env_wind"],
    linear_cols=["env_temp"],
    cat_cols=["roof", "temp_missing"],
    target_definition=(
        "Outcome ∈ {TOUCHBACK, OUT_OF_BOUNDS, DOWNED, FAIR_CATCH, RETURNED} by priority from the "
        "nflverse punt flags. Distance and return-yards are separate empirical PMFs (below)."
    ),
    eligible_population="§6.1 admin base + §6.5 REG, then `punt_attempt == 1`, `punt_blocked == 0`.",
    residual_variance_note=(
        "N/A for the baseline. Phase D: `punt_power` → distance, `punt_accuracy`/`coffin_corner` → "
        "placement (touchback / OOB / downed), `hang_time` → returnability & return-yard "
        "suppression, each calibrated against per-punter residual spread (spec §11 M21)."
    ),
)

if __name__ == "__main__":
    run_resolver(SPEC, build_frame, on_models=_dist_tables)

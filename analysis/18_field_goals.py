"""Model 20 — Field-goal success (spec §11 M20).

Binary MADE vs NOT_MADE (blocked folded into NOT_MADE — separate handling
needs more sample). Nonlinear distance via spline. §17.1 roof handling:
`roof` is a required categorical; `temp`/`wind` only vary for outdoor games.
`kick_accuracy` / `kick_power` (with power weighted more at long range) and
kicker random effects are Phase D — calibrated against the historical
per-kicker residual spread after controlling for distance/environment.

Run: analysis/.venv/Scripts/python analysis/18_field_goals.py
"""

from __future__ import annotations

import lib_py  # thread-env setup; MUST precede numpy/polars

import polars as pl

from lib_py.pbp import load_clean
from lib_py.pipeline import ResolverSpec, run_resolver

LABELS = ["NOT_MADE", "MADE"]

SOURCE_COLS = ["kick_distance", "roof", "wind", "temp", "yardline_100"]
POP_COLS = ["field_goal_attempt", "field_goal_result", "season", "down", "score_differential", "game_seconds_remaining"]

SPLINE = ["kick_distance", "yardline_100", "env_wind"]
LINEAR = ["env_temp"]
CAT = ["roof", "temp_missing"]

_i8 = lambda c: pl.col(c).cast(pl.Int8, strict=False).fill_null(0)


def build_frame(seasons: tuple[int, ...]) -> pl.DataFrame:
    df = load_clean(seasons, base="admin", columns=sorted({*SOURCE_COLS, *POP_COLS}))
    df = df.filter((_i8("field_goal_attempt") == 1) & pl.col("field_goal_result").is_not_null()
                   & pl.col("kick_distance").is_not_null())
    is_out = pl.col("roof").is_in(["outdoors", "open"])
    med = df.filter(is_out & pl.col("temp").is_not_null())["temp"].median() or 60.0
    return df.with_columns(
        pl.when(pl.col("field_goal_result") == "made").then(pl.lit("MADE")).otherwise(pl.lit("NOT_MADE")).alias("target"),
        pl.when(is_out).then(pl.col("temp")).otherwise(None).fill_null(med).alias("env_temp"),
        pl.when(is_out).then(pl.col("wind")).otherwise(None).fill_null(0.0).alias("env_wind"),
        (is_out & pl.col("temp").is_null()).cast(pl.Int8).alias("temp_missing"),
        pl.col("roof").fill_null("unknown"),
    )


SPEC = ResolverSpec(
    model_id="M20",
    name="Field-goal success",
    labels=LABELS,
    source_cols=SOURCE_COLS,
    spline_cols=SPLINE,
    linear_cols=LINEAR,
    cat_cols=CAT,
    target_definition="MADE if `field_goal_result == 'made'`; else NOT_MADE (missed or blocked).",
    eligible_population=(
        "§6.1 (admin base — FGs need no down filter) + §6.5 REG, then `field_goal_attempt == 1` "
        "with `field_goal_result` and `kick_distance` non-null."
    ),
    missingness_note=(
        "`temp`/`wind` structurally null indoors (§17.1) → `env_temp`/`env_wind` carry the outdoor "
        "value (neutral otherwise) and `roof` is a required categorical; `temp_missing` flags "
        "outdoor games with no reading."
    ),
    residual_variance_note=(
        "N/A for the baseline. Phase D uses `kicker_player_id` to estimate the residual make-rate "
        "spread among kickers after distance/environment, and calibrates `kick_accuracy` / "
        "`kick_power` to it (`kick_power` weighted up with distance; accuracy alone cannot overcome "
        "insufficient range — spec §11 M20)."
    ),
)

if __name__ == "__main__":
    run_resolver(SPEC, build_frame)

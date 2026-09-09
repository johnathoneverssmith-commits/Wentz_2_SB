"""Model 14 — Designed rushing yardage (spec §11 M14).

Category model + empirical exact-yard PMF for designed rushes. `run_location`
is a predictor (from Model 13); `run_gap` is skipped (26% missing — audit Q6).
The end zone is a hard upper bound. Runner / OL / front-seven rating families
are Phase D and only the players relevant to the selected location get weight
(spec §11 M14 matchup logic — implemented in the engine, not this baseline).

Run: analysis/.venv/Scripts/python analysis/15_rush_yards.py
"""

from __future__ import annotations

import lib_py  # thread-env setup; MUST precede numpy/polars

import polars as pl

from lib_py.pbp import load_clean
from lib_py.yardage import YardageSpec, run_yardage_resolver

SOURCE_COLS = [
    "run_location", "down", "ydstogo", "yardline_100", "goal_to_go", "shotgun",
    "qtr", "score_differential", "game_seconds_remaining", "half_seconds_remaining",
]
POP_COLS = ["rush_attempt", "qb_scramble", "qb_kneel", "yards_gained", "season"]

BINS = [
    ("MAJOR_LOSS", None, -2), ("STUFF", -1, 1), ("SHORT_GAIN", 2, 3),
    ("NORMAL_GAIN", 4, 7), ("GOOD_GAIN", 8, 14), ("EXPLOSIVE", 15, None),
]

_i8 = lambda c: pl.col(c).cast(pl.Int8, strict=False).fill_null(0)


def build_frame(seasons: tuple[int, ...]) -> pl.DataFrame:
    df = load_clean(seasons, base="core", penalty_free=True, columns=sorted({*SOURCE_COLS, *POP_COLS}))
    df = df.filter(
        (_i8("rush_attempt") == 1) & (_i8("qb_scramble") != 1) & (_i8("qb_kneel") != 1)
        & pl.col("yards_gained").is_not_null()
    )
    return df.with_columns(
        pl.col("yards_gained").alias("yards"),
        pl.col("run_location").fill_null("unknown"),
        pl.col("down").cast(pl.Int8, strict=False),
        pl.col("qtr").cast(pl.Int8, strict=False),
        _i8("shotgun").alias("shotgun"),
    )


def ctx_bucket(df: pl.DataFrame) -> pl.Expr:
    return (
        pl.col("run_location") + "|"
        + pl.when(pl.col("yardline_100") <= 10).then(pl.lit("gl"))
        .when(pl.col("yardline_100") <= 50).then(pl.lit("opp")).otherwise(pl.lit("own"))
        + "|" + pl.when(pl.col("ydstogo") <= 2).then(pl.lit("short")).otherwise(pl.lit("norm"))
    )


SPEC = YardageSpec(
    model_id="M14",
    name="Designed rushing yardage",
    bins=BINS,
    source_cols=SOURCE_COLS,
    spline_cols=["ydstogo", "yardline_100", "game_seconds_remaining", "score_differential"],
    linear_cols=["half_seconds_remaining"],
    cat_cols=["run_location", "down", "goal_to_go", "shotgun", "qtr"],
    context_bucket=ctx_bucket,
    explosive_threshold=15,
    target_definition=(
        "`yards_gained` binned ≤-2 / -1..1 / 2..3 / 4..7 / 8..14 / 15+, exact draw per "
        "(run_location × field-pos band × short-yardage flag)."
    ),
    eligible_population=(
        "§6.1 core + §6.5 REG + §6.2 penalty-free, then `rush_attempt == 1`, `qb_scramble == 0`, "
        "`qb_kneel == 0` with `yards_gained` non-null."
    ),
)

if __name__ == "__main__":
    run_yardage_resolver(SPEC, build_frame)

"""Model 10 — Yards after catch (spec §11 M10).

Category model (YAC bins) + empirical exact-YAC PMF per (category x depth x
field-pos). YAC is negative-capable, zero-heavy, long-tailed and censored by
the goal line — hence a distributional model, not Gaussian/Gamma. Benchmarks:
`xyac_*` (not fitted). Ball-carrier / pursuit rating families are Phase D.

Run: analysis/.venv/Scripts/python analysis/11_yac.py
"""

from __future__ import annotations

import lib_py  # thread-env setup; MUST precede numpy/polars

import polars as pl

from lib_py.pbp import load_clean
from lib_py.yardage import YardageSpec, run_yardage_resolver

SOURCE_COLS = [
    "air_yards", "pass_location", "yardline_100", "goal_to_go", "down", "ydstogo",
    "game_seconds_remaining", "half_seconds_remaining",
]
POP_COLS = ["complete_pass", "yards_after_catch", "season", "qtr", "score_differential"]

BINS = [
    ("YAC_NEGATIVE", None, -1), ("YAC_0_2", 0, 2), ("YAC_3_5", 3, 5),
    ("YAC_6_10", 6, 10), ("YAC_11_20", 11, 20), ("YAC_21_PLUS", 21, None),
]

_i8 = lambda c: pl.col(c).cast(pl.Int8, strict=False).fill_null(0)


def build_frame(seasons: tuple[int, ...]) -> pl.DataFrame:
    df = load_clean(seasons, base="core", penalty_free=True, columns=sorted({*SOURCE_COLS, *POP_COLS}))
    df = df.filter((_i8("complete_pass") == 1) & pl.col("yards_after_catch").is_not_null())
    ay = pl.col("air_yards").fill_null(0)
    return df.with_columns(
        pl.col("yards_after_catch").alias("yards"),
        pl.when(ay < 0).then(pl.lit("BEHIND_LOS")).when(ay <= 9).then(pl.lit("SHORT"))
        .when(ay <= 19).then(pl.lit("INTERMEDIATE")).otherwise(pl.lit("DEEP")).alias("depth_category"),
        pl.col("pass_location").fill_null("unknown"),
        pl.col("down").cast(pl.Int8, strict=False),
    )


def ctx_bucket(df: pl.DataFrame) -> pl.Expr:
    return pl.col("depth_category") + "|" + pl.when(pl.col("yardline_100") <= 15).then(pl.lit("rz")).otherwise(pl.lit("field"))


SPEC = YardageSpec(
    model_id="M10",
    name="Yards after catch",
    bins=BINS,
    source_cols=SOURCE_COLS,
    spline_cols=["air_yards", "yardline_100", "ydstogo"],
    linear_cols=["half_seconds_remaining"],
    cat_cols=["depth_category", "pass_location", "down", "goal_to_go"],
    context_bucket=ctx_bucket,
    explosive_threshold=21,
    target_definition=(
        "`yards_after_catch` binned NEGATIVE / 0–2 / 3–5 / 6–10 / 11–20 / 21+, then exact YAC "
        "drawn from the empirical PMF for (depth_category × red-zone flag)."
    ),
    eligible_population="§6.1 core + §6.5 REG + §6.2 penalty-free, then `complete_pass == 1` with `yards_after_catch` non-null.",
)

if __name__ == "__main__":
    run_yardage_resolver(SPEC, build_frame)

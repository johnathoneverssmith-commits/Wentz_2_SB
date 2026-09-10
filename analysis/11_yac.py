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
from lib_py.report import ARTIFACTS
from lib_py.yardage import YardageSpec, run_yardage_resolver

SOURCE_COLS = [
    "air_yards", "pass_location", "yardline_100", "goal_to_go", "down", "ydstogo",
    "game_seconds_remaining", "half_seconds_remaining",
]
POP_COLS = ["complete_pass", "yards_after_catch", "season", "qtr", "score_differential", "receiver_player_id", "defteam", "game_id", "play_id"]

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


def write_rz_yac() -> None:
    """Empirical YAC PMF for a red-zone completion caught *short* of the goal
    line, keyed by where the ball is caught (`catch_yl` = yardline_100 −
    air_yards). The M10 class model regresses YAC toward the league mean and
    under-predicts the goal-line reach/dive — a completion caught at the opp 2
    scores ~54% of the time on YAC alone, but M10 gives it ~25%. The engine
    draws from this table instead when `yardline_100 <= 20` and the ball is
    caught short (`0 < catch_yl <= 25`). Production seasons.
    """
    df = load_clean((2023, 2024, 2025), base="core", penalty_free=True,
                    columns=["yardline_100", "air_yards", "yards_after_catch", "complete_pass"])
    df = df.filter(
        (_i8("complete_pass") == 1) & pl.col("yards_after_catch").is_not_null()
        & pl.col("air_yards").is_not_null() & (pl.col("yardline_100") <= 25)
    )
    df = df.with_columns(
        (pl.col("yardline_100") - pl.col("air_yards")).alias("catch_yl"),
        pl.col("yards_after_catch").clip(-4, 40).round().cast(pl.Int32).alias("yac_int"),
    ).filter((pl.col("catch_yl") >= 1) & (pl.col("catch_yl") <= 25))
    # catch-position bands: tight near the goal, wider out
    cb = (
        pl.when(pl.col("catch_yl") <= 1).then(pl.lit("1"))
        .when(pl.col("catch_yl") <= 2).then(pl.lit("2"))
        .when(pl.col("catch_yl") <= 3).then(pl.lit("3"))
        .when(pl.col("catch_yl") <= 5).then(pl.lit("4-5"))
        .when(pl.col("catch_yl") <= 8).then(pl.lit("6-8"))
        .when(pl.col("catch_yl") <= 12).then(pl.lit("9-12"))
        .when(pl.col("catch_yl") <= 18).then(pl.lit("13-18"))
        .otherwise(pl.lit("19-25"))
    )
    tbl = (
        df.with_columns(cb.alias("catch_band"))
        .group_by(["catch_band", "yac_int"]).agg(pl.len().alias("count"))
        .sort(["catch_band", "yac_int"])
    )
    out = ARTIFACTS / "distributions"
    tbl.write_parquet(out / "rz_yac.parquet")
    print(f"  wrote {out / 'rz_yac.parquet'}  ({tbl.height} rows, "
          f"{tbl['catch_band'].n_unique()} bands)")


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
    write_rz_yac()

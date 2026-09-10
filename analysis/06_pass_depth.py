"""Model 05 — Pass target depth (spec §11 M05).

Multiclass BEHIND_LOS / SHORT / INTERMEDIATE / DEEP category model, plus an
empirical exact-`air_yards` distribution per (category x coarse context) for
the within-bin sampler. Depth is scheme/usage, not ability — no accuracy
rating steers it in V1 (throw_power feasibility on 30+ is a Phase-D layer).
Never uses completion / YAC / cp / cpoe (spec §11 M05).

Run: analysis/.venv/Scripts/python analysis/06_pass_depth.py
"""

from __future__ import annotations

import lib_py  # thread-env setup; MUST precede numpy/polars

import polars as pl

from lib_py.pbp import load_clean
from lib_py.pipeline import ResolverSpec, run_resolver
from lib_py.report import ARTIFACTS

LABELS = ["BEHIND_LOS", "SHORT", "INTERMEDIATE", "DEEP"]

SOURCE_COLS = [
    "down", "ydstogo", "yardline_100", "goal_to_go", "qtr",
    "game_seconds_remaining", "half_seconds_remaining", "score_differential", "shotgun",
]
POP_COLS = ["pass_attempt", "sack", "qb_spike", "air_yards", "season"]

SPLINE = ["ydstogo", "yardline_100", "game_seconds_remaining", "score_differential"]
LINEAR = ["half_seconds_remaining"]
CAT = ["down", "goal_to_go", "qtr", "shotgun"]

_i8 = lambda c: pl.col(c).cast(pl.Int8, strict=False).fill_null(0)


def _with_depth(df: pl.DataFrame) -> pl.DataFrame:
    ay = pl.col("air_yards")
    return df.with_columns(
        pl.when(ay < 0).then(pl.lit("BEHIND_LOS"))
        .when(ay <= 9).then(pl.lit("SHORT"))
        .when(ay <= 19).then(pl.lit("INTERMEDIATE"))
        .otherwise(pl.lit("DEEP")).alias("target")
    )


def build_frame(seasons: tuple[int, ...]) -> pl.DataFrame:
    df = load_clean(seasons, base="core", penalty_free=True, columns=sorted({*SOURCE_COLS, *POP_COLS}))
    df = df.filter(
        (_i8("pass_attempt") == 1) & (_i8("sack") != 1) & (_i8("qb_spike") != 1)
        & pl.col("air_yards").is_not_null()
    )
    df = _with_depth(df).with_columns(
        pl.col("target").alias("depth_category"),
        pl.col("down").cast(pl.Int8, strict=False),
        pl.col("qtr").cast(pl.Int8, strict=False),
        _i8("goal_to_go").alias("goal_to_go"),
        _i8("shotgun").alias("shotgun"),
    )
    return df


def write_exact_air_yards() -> None:
    """Empirical exact air_yards per (depth_category x down x field-pos band), production seasons.

    The red zone is split finely: near the goal line the air_yards distribution
    is a tight spike at the yardline (you throw the ball *to* the end zone), which
    the old pooled `opp_rz` bucket (yl 1-20) washed out — completions were caught
    short of the goal too often (V1.6 red-zone probe). `sample_air_yards` falls
    back gl_inner -> gl_outer -> rz -> glob for thin cells.
    """
    df = build_frame((2023, 2024, 2025))
    df = df.with_columns(
        pl.when(pl.col("yardline_100") <= 2).then(pl.lit("gl1"))
        .when(pl.col("yardline_100") <= 4).then(pl.lit("gl2"))
        .when(pl.col("yardline_100") <= 7).then(pl.lit("gl3"))
        .when(pl.col("yardline_100") <= 12).then(pl.lit("gl4"))
        .when(pl.col("yardline_100") <= 20).then(pl.lit("rz"))
        .when(pl.col("yardline_100") <= 50).then(pl.lit("opp_mid"))
        .otherwise(pl.lit("own_half")).alias("fp_band"),
        pl.col("air_yards").cast(pl.Int32).alias("air_yards_int"),
    )
    tbl = (
        df.group_by(["depth_category", "down", "fp_band", "air_yards_int"])
        .agg(pl.len().alias("count"))
        .sort(["depth_category", "down", "fp_band", "air_yards_int"])
    )
    out = ARTIFACTS / "distributions"
    out.mkdir(parents=True, exist_ok=True)
    tbl.write_parquet(out / "air_yards_exact.parquet")
    print(f"  wrote {out / 'air_yards_exact.parquet'}  ({tbl.height} bins)")


SPEC = ResolverSpec(
    model_id="M05",
    name="Pass target depth",
    labels=LABELS,
    source_cols=SOURCE_COLS,
    spline_cols=SPLINE,
    linear_cols=LINEAR,
    cat_cols=CAT,
    target_definition=(
        "`air_yards` binned: BEHIND_LOS (<0), SHORT (0–9), INTERMEDIATE (10–19), DEEP (≥20). "
        "Exact `air_yards` is then drawn from `artifacts/distributions/air_yards_exact.parquet` "
        "conditioned on (category × down × field-position band)."
    ),
    eligible_population=(
        "§6.1 core + §6.5 REG + §6.2 penalty-free, then `pass_attempt == 1`, `sack == 0`, "
        "`qb_spike == 0`, `air_yards` non-null (~7% of pass plays have null air_yards — throwaways, "
        "batted balls; excluded per spec §11 M05)."
    ),
    residual_variance_note=(
        "N/A for the baseline. Depth is treated as scheme/usage in V1. Phase D may add a modest "
        "`throw_power` feasibility constraint on 30+ air-yard targets and receiver depth-usage from "
        "the roster system — not an accuracy-driven depth preference (spec §11 M05)."
    ),
)

if __name__ == "__main__":
    run_resolver(SPEC, build_frame)
    write_exact_air_yards()

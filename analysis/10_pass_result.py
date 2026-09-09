"""Model 09 — Pass result: completion vs interception vs other incompletion
(spec §11 M09).

Multiclass COMPLETE / INTERCEPTION / OTHER_INCOMPLETE — mutually exclusive, so
one model, not independent rolls. `qb_hit` and `pass_location` are known
upstream (Models 08 / 06). Benchmark against `cp` (marginal completion) and
`cpoe` (player residual) — never fitted on them. Player-rating layer (QB
depth-accuracy, receiver route/hands, coverage) is Phase D, centered on zero
so an average matchup reproduces this baseline (spec §11 M09).

Run: analysis/.venv/Scripts/python analysis/10_pass_result.py
"""

from __future__ import annotations

import lib_py  # thread-env setup; MUST precede numpy/polars

import polars as pl

from lib_py.pbp import load_clean
from lib_py.pipeline import ResolverSpec, run_resolver

LABELS = ["COMPLETE", "OTHER_INCOMPLETE", "INTERCEPTION"]

SOURCE_COLS = [
    "air_yards", "pass_location", "qb_hit", "down", "ydstogo", "yardline_100",
    "goal_to_go", "shotgun", "qtr", "game_seconds_remaining", "half_seconds_remaining",
]
POP_COLS = ["pass_attempt", "sack", "qb_spike", "complete_pass", "interception", "season"]

SPLINE = ["air_yards", "ydstogo", "yardline_100", "game_seconds_remaining"]
LINEAR = ["half_seconds_remaining"]
CAT = ["depth_category", "pass_location", "qb_hit", "down", "goal_to_go", "qtr", "shotgun"]

_i8 = lambda c: pl.col(c).cast(pl.Int8, strict=False).fill_null(0)


def build_frame(seasons: tuple[int, ...]) -> pl.DataFrame:
    df = load_clean(seasons, base="core", penalty_free=True, columns=sorted({*SOURCE_COLS, *POP_COLS}))
    df = df.filter(
        (_i8("pass_attempt") == 1) & (_i8("sack") != 1) & (_i8("qb_spike") != 1)
        & pl.col("air_yards").is_not_null()
    )
    ay = pl.col("air_yards")
    return df.with_columns(
        pl.when(ay < 0).then(pl.lit("BEHIND_LOS")).when(ay <= 9).then(pl.lit("SHORT"))
        .when(ay <= 19).then(pl.lit("INTERMEDIATE")).otherwise(pl.lit("DEEP")).alias("depth_category"),
        pl.when(_i8("interception") == 1).then(pl.lit("INTERCEPTION"))
        .when(_i8("complete_pass") == 1).then(pl.lit("COMPLETE"))
        .otherwise(pl.lit("OTHER_INCOMPLETE")).alias("target"),
        pl.col("pass_location").fill_null("unknown"),
        _i8("qb_hit").alias("qb_hit"),
        pl.col("down").cast(pl.Int8, strict=False),
        pl.col("qtr").cast(pl.Int8, strict=False),
        _i8("goal_to_go").alias("goal_to_go"),
        _i8("shotgun").alias("shotgun"),
    )


SPEC = ResolverSpec(
    model_id="M09",
    name="Pass result (completion / INT / other incompletion)",
    labels=LABELS,
    source_cols=SOURCE_COLS,
    spline_cols=SPLINE,
    linear_cols=LINEAR,
    cat_cols=CAT,
    target_definition=(
        "INTERCEPTION if `interception == 1`; else COMPLETE if `complete_pass == 1`; else "
        "OTHER_INCOMPLETE. One multinomial model (the three are mutually exclusive)."
    ),
    eligible_population=(
        "§6.1 core + §6.5 REG + §6.2 penalty-free, then `pass_attempt == 1`, `sack == 0`, "
        "`qb_spike == 0`, `air_yards` non-null."
    ),
    residual_variance_note=(
        "N/A for the baseline. Phase D estimates shrunken QB / receiver / defense residuals after "
        "controlling for throw difficulty (benchmark: `cpoe`), then calibrates depth-specific "
        "accuracy, route/catching, and coverage modifiers to reproduce that spread — centered so "
        "an average matchup leaves this baseline unchanged (spec §11 M09, §13)."
    ),
)

if __name__ == "__main__":
    run_resolver(SPEC, build_frame)

"""Model 03 — Shotgun formation (spec §11 M03).

Binary P(SHOTGUN), fitted AFTER the broad play call so `play_call` can be a
predictor without chronology leakage (shotgun strongly correlates with
pass/run, so it must not feed Model 02). No player modifiers (Phase B).

Run: analysis/.venv/Scripts/python analysis/04_shotgun.py
"""

from __future__ import annotations

import lib_py  # thread-env setup; MUST precede numpy/polars

import polars as pl

from lib_py.pbp import load_clean
from lib_py.pipeline import ResolverSpec, run_resolver

LABELS = ["NOT_SHOTGUN", "SHOTGUN"]

SOURCE_COLS = [
    "down", "ydstogo", "yardline_100", "goal_to_go", "qtr",
    "game_seconds_remaining", "half_seconds_remaining", "score_differential",
]
POP_COLS = [
    "qb_dropback", "rush_attempt", "qb_scramble", "qb_kneel", "qb_spike",
    "field_goal_attempt", "punt_attempt", "kickoff_attempt", "extra_point_attempt",
    "two_point_attempt", "shotgun", "season",
]

SPLINE = ["ydstogo", "yardline_100", "game_seconds_remaining", "score_differential"]
LINEAR = ["half_seconds_remaining"]
CAT = ["play_call", "down", "goal_to_go", "qtr"]

_i8 = lambda c: pl.col(c).cast(pl.Int8, strict=False).fill_null(0)


def build_frame(seasons: tuple[int, ...]) -> pl.DataFrame:
    df = load_clean(seasons, base="core", columns=sorted({*SOURCE_COLS, *POP_COLS}))
    not_st = (
        (_i8("field_goal_attempt") != 1) & (_i8("punt_attempt") != 1)
        & (_i8("kickoff_attempt") != 1) & (_i8("extra_point_attempt") != 1)
        & (_i8("two_point_attempt") != 1)
    )
    dropback = _i8("qb_dropback") == 1
    designed_run = (_i8("rush_attempt") == 1) & (_i8("qb_scramble") != 1)
    df = df.filter(
        not_st & (_i8("qb_kneel") != 1) & (_i8("qb_spike") != 1)
        & (dropback | designed_run) & pl.col("shotgun").is_not_null()
    )
    df = df.with_columns(
        pl.when(dropback).then(pl.lit("DROPBACK")).otherwise(pl.lit("DESIGNED_RUN")).alias("play_call"),
        pl.when(_i8("shotgun") == 1).then(pl.lit("SHOTGUN")).otherwise(pl.lit("NOT_SHOTGUN")).alias("target"),
        pl.col("down").cast(pl.Int8, strict=False),
        pl.col("qtr").cast(pl.Int8, strict=False),
        _i8("goal_to_go").alias("goal_to_go"),
    )
    return df


SPEC = ResolverSpec(
    model_id="M03",
    name="Shotgun formation",
    labels=LABELS,
    source_cols=SOURCE_COLS,
    spline_cols=SPLINE,
    linear_cols=LINEAR,
    cat_cols=CAT,
    target_definition="P(SHOTGUN) from the `shotgun` flag, given the already-chosen `play_call`.",
    eligible_population=(
        "Same as Model 02 (dropback or designed run, no ST / kneel / spike) with `shotgun` non-null. "
        "Fitted after the play call so `play_call` is an allowed predictor (spec §11 M03 rationale)."
    ),
    missingness_note="STATE predictors have no nulls here; `play_call` is the upstream Model 02 decision.",
)

if __name__ == "__main__":
    run_resolver(SPEC, build_frame)

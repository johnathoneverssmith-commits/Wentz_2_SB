"""Model 13 — Run location (spec §11 M13).

Multiclass LEFT / MIDDLE / RIGHT. `run_gap` is ~26% missing within run plays
(schema audit Q6), so V1 fits location only; gap is used later where reliable.
Primarily a play-calling / scheme decision — no player modifiers in V1.

Run: analysis/.venv/Scripts/python analysis/14_run_location.py
"""

from __future__ import annotations

import lib_py  # thread-env setup; MUST precede numpy/polars

import polars as pl

from lib_py.pbp import load_clean
from lib_py.pipeline import ResolverSpec, run_resolver

LABELS = ["left", "middle", "right"]

SOURCE_COLS = [
    "down", "ydstogo", "yardline_100", "goal_to_go", "score_differential",
    "game_seconds_remaining", "half_seconds_remaining", "shotgun",
]
POP_COLS = ["rush_attempt", "qb_scramble", "qb_kneel", "run_location", "season"]

SPLINE = ["ydstogo", "yardline_100", "game_seconds_remaining", "score_differential"]
LINEAR = ["half_seconds_remaining"]
CAT = ["down", "goal_to_go", "shotgun"]

_i8 = lambda c: pl.col(c).cast(pl.Int8, strict=False).fill_null(0)


def build_frame(seasons: tuple[int, ...]) -> pl.DataFrame:
    df = load_clean(seasons, base="core", columns=sorted({*SOURCE_COLS, *POP_COLS}))
    df = df.filter(
        (_i8("rush_attempt") == 1) & (_i8("qb_scramble") != 1) & (_i8("qb_kneel") != 1)
        & pl.col("run_location").is_in(LABELS)
    )
    return df.with_columns(
        pl.col("run_location").alias("target"),
        pl.col("down").cast(pl.Int8, strict=False),
        _i8("goal_to_go").alias("goal_to_go"),
        _i8("shotgun").alias("shotgun"),
    )


SPEC = ResolverSpec(
    model_id="M13",
    name="Run location",
    labels=LABELS,
    source_cols=SOURCE_COLS,
    spline_cols=SPLINE,
    linear_cols=LINEAR,
    cat_cols=CAT,
    target_definition="`run_location` ∈ {left, middle, right}. `run_gap` deferred (too incomplete — audit Q6).",
    eligible_population=(
        "§6.1 core + §6.5 REG, then `rush_attempt == 1`, `qb_scramble == 0`, `qb_kneel == 0`, "
        "`run_location` present (~0.1% missing within run plays)."
    ),
    residual_variance_note="N/A — location is a scheme/play-call decision; no player-rating layer (spec §11 M13).",
)

if __name__ == "__main__":
    run_resolver(SPEC, build_frame)

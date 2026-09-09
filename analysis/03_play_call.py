"""Model 02 — Normal play call: dropback vs designed run (spec §11 M02).

Binary P(DROPBACK). Scrambles count as DROPBACK (a called pass that became a
run); their downstream resolution is Model 04. Kicks / kneels / spikes / ST
excluded. No `shotgun` / `no_huddle` / post-snap fields (chronology, §11).
No player modifiers (Phase B). Benchmark: `xpass`, `pass_oe` (not fitted on).

Run: analysis/.venv/Scripts/python analysis/03_play_call.py
"""

from __future__ import annotations

import polars as pl

from lib_py.pbp import load_clean
from lib_py.pipeline import ResolverSpec, run_resolver

LABELS = ["DESIGNED_RUN", "DROPBACK"]

SOURCE_COLS = [
    "down", "ydstogo", "yardline_100", "goal_to_go", "qtr", "game_seconds_remaining",
    "half_seconds_remaining", "score_differential", "posteam_timeouts_remaining",
    "defteam_timeouts_remaining", "posteam", "home_team",
]
POP_COLS = [
    "qb_dropback", "rush_attempt", "qb_scramble", "qb_kneel", "qb_spike",
    "field_goal_attempt", "punt_attempt", "kickoff_attempt", "extra_point_attempt",
    "two_point_attempt", "season",
]

SPLINE = ["ydstogo", "yardline_100", "game_seconds_remaining", "score_differential"]
LINEAR = ["half_seconds_remaining", "posteam_timeouts_remaining", "defteam_timeouts_remaining"]
CAT = ["down", "goal_to_go", "qtr", "is_home_offense"]

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
    df = df.filter(not_st & (_i8("qb_kneel") != 1) & (_i8("qb_spike") != 1) & (dropback | designed_run))

    df = df.with_columns(
        pl.when(dropback).then(pl.lit("DROPBACK"))
        .when(designed_run).then(pl.lit("DESIGNED_RUN"))
        .otherwise(None).alias("target"),
        (pl.col("posteam") == pl.col("home_team")).cast(pl.Int8).alias("is_home_offense"),
        pl.col("down").cast(pl.Int8, strict=False),
        pl.col("qtr").cast(pl.Int8, strict=False),
        _i8("goal_to_go").alias("goal_to_go"),
    )
    return df.filter(pl.col("target").is_not_null())


SPEC = ResolverSpec(
    model_id="M02",
    name="Play call: dropback vs designed run",
    labels=LABELS,
    source_cols=SOURCE_COLS,
    spline_cols=SPLINE,
    linear_cols=LINEAR,
    cat_cols=CAT,
    target_definition=(
        "P(DROPBACK) vs DESIGNED_RUN. DROPBACK if `qb_dropback == 1` (includes scrambles — a "
        "called pass that became a run; resolved downstream by Model 04). DESIGNED_RUN if "
        "`rush_attempt == 1 & qb_scramble != 1`. The two are mutually exclusive in the data "
        "(schema audit: 0 rows with both)."
    ),
    eligible_population=(
        "§6.1 core + §6.5 REG, then: not a FG/punt/kickoff/XP/2pt attempt, `qb_kneel == 0`, "
        "`qb_spike == 0`, and the row is a dropback or a designed run. Fake kicks that are a "
        "real run/pass stay in (they carry no kick-attempt flag)."
    ),
    missingness_note=(
        "All predictors are STATE fields with no nulls in this population. `is_home_offense` is "
        "derived from `posteam == home_team`."
    ),
)

if __name__ == "__main__":
    run_resolver(SPEC, build_frame)

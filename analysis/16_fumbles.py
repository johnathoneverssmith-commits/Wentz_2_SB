"""Model 15 — Fumble occurrence (spec §11 M15).

Binary P(fumble) after a ballcarrier event. The spec lists four separate
populations (designed rush / scramble / reception / sack); this fits ONE
regularised logistic with `event_family` as a categorical predictor — that
reproduces each family's base hazard while sharing the (sparse) context
effects, which §8 prefers over four thin rare-event fits. `yards_gained` and
`qb_hit` are valid predictors here: the fumble roll is AFTER the yardage in
the event chronology (§4). Rare event (~1%) — calibration is the metric.
`carrying` (ballcarrier) + `hit_power`/`tackle` (defender) are Phase D.

Run: analysis/.venv/Scripts/python analysis/16_fumbles.py
"""

from __future__ import annotations

import lib_py  # thread-env setup; MUST precede numpy/polars

import polars as pl

from lib_py.pbp import load_clean
from lib_py.pipeline import ResolverSpec, run_resolver

LABELS = ["NO_FUMBLE", "FUMBLE"]

SOURCE_COLS = ["yards_gained", "qb_hit", "yardline_100", "down", "ydstogo"]
POP_COLS = [
    "rush_attempt", "qb_scramble", "qb_kneel", "complete_pass", "sack", "fumble", "season",
    "score_differential", "game_seconds_remaining",
]

SPLINE = ["yards_gained", "yardline_100"]
LINEAR: list[str] = []
CAT = ["event_family", "qb_hit", "down"]

_i8 = lambda c: pl.col(c).cast(pl.Int8, strict=False).fill_null(0)


def build_frame(seasons: tuple[int, ...]) -> pl.DataFrame:
    df = load_clean(seasons, base="core", penalty_free=True, columns=sorted({*SOURCE_COLS, *POP_COLS}))
    fam = (
        pl.when(_i8("sack") == 1).then(pl.lit("sack"))
        .when(_i8("qb_scramble") == 1).then(pl.lit("scramble"))
        .when((_i8("rush_attempt") == 1) & (_i8("qb_kneel") != 1)).then(pl.lit("designed_rush"))
        .when(_i8("complete_pass") == 1).then(pl.lit("reception"))
        .otherwise(pl.lit(None))
    )
    df = df.with_columns(fam.alias("event_family")).filter(pl.col("event_family").is_not_null())
    return df.with_columns(
        pl.when(_i8("fumble") == 1).then(pl.lit("FUMBLE")).otherwise(pl.lit("NO_FUMBLE")).alias("target"),
        _i8("qb_hit").alias("qb_hit"),
        pl.col("down").cast(pl.Int8, strict=False),
    )


SPEC = ResolverSpec(
    model_id="M15",
    name="Fumble occurrence",
    labels=LABELS,
    source_cols=SOURCE_COLS,
    spline_cols=SPLINE,
    linear_cols=LINEAR,
    cat_cols=CAT,
    c_grid=(0.1, 0.3, 1.0),
    target_definition=(
        "P(FUMBLE) from `fumble`, over ballcarrier events. `event_family` ∈ "
        "{designed_rush, scramble, reception, sack}."
    ),
    eligible_population=(
        "§6.1 core + §6.5 REG + §6.2 penalty-free, then the row is a designed rush, scramble, "
        "reception, or sack. `fumble` marks a fumble occurring (recovery is Model 16)."
    ),
    missingness_note="`yards_gained` and `qb_hit` are post-yardage state (valid here, §4/§11 M15); no nulls in this population.",
    residual_variance_note=(
        "N/A for the baseline. Phase D: `carrying` (ballcarrier, where the attribute exists — not "
        "fabricated for WR/TE/QB) lowers fumble probability; `hit_power` / `tackle` (identified "
        "tackler) raise forced-fumble probability (spec §11 M15)."
    ),
)

if __name__ == "__main__":
    run_resolver(SPEC, build_frame)

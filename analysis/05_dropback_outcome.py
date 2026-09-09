"""Model 04 — Dropback terminal action (spec §11 M04).

Multiclass THROW / SACK / SCRAMBLE for `qb_dropback == 1`. Penalty-free fit
(§6.2). Grouping vars (`qb_player_id` etc.) are for Phase-D residual variance
only, not portable baseline features. No player modifiers (Phase B).

Run: analysis/.venv/Scripts/python analysis/05_dropback_outcome.py
"""

from __future__ import annotations

import lib_py  # thread-env setup; MUST precede numpy/polars

import polars as pl

from lib_py.pbp import load_clean
from lib_py.pipeline import ResolverSpec, run_resolver

LABELS = ["THROW", "SACK", "SCRAMBLE"]

SOURCE_COLS = [
    "down", "ydstogo", "yardline_100", "goal_to_go", "qtr",
    "game_seconds_remaining", "half_seconds_remaining", "score_differential", "shotgun",
]
POP_COLS = ["qb_dropback", "qb_kneel", "qb_spike", "sack", "qb_scramble", "pass_attempt", "season"]

SPLINE = ["ydstogo", "yardline_100", "game_seconds_remaining", "score_differential"]
LINEAR = ["half_seconds_remaining"]
CAT = ["down", "goal_to_go", "qtr", "shotgun"]

_i8 = lambda c: pl.col(c).cast(pl.Int8, strict=False).fill_null(0)


def build_frame(seasons: tuple[int, ...]) -> pl.DataFrame:
    df = load_clean(seasons, base="core", penalty_free=True, columns=sorted({*SOURCE_COLS, *POP_COLS}))
    df = df.filter((_i8("qb_dropback") == 1) & (_i8("qb_kneel") != 1) & (_i8("qb_spike") != 1))
    df = df.with_columns(
        pl.when(_i8("sack") == 1).then(pl.lit("SACK"))
        .when(_i8("qb_scramble") == 1).then(pl.lit("SCRAMBLE"))
        .when(_i8("pass_attempt") == 1).then(pl.lit("THROW"))
        .otherwise(None).alias("target"),
        pl.col("down").cast(pl.Int8, strict=False),
        pl.col("qtr").cast(pl.Int8, strict=False),
        _i8("goal_to_go").alias("goal_to_go"),
        _i8("shotgun").alias("shotgun"),
    )
    return df.filter(pl.col("target").is_not_null())


SPEC = ResolverSpec(
    model_id="M04",
    name="Dropback terminal action",
    labels=LABELS,
    source_cols=SOURCE_COLS,
    spline_cols=SPLINE,
    linear_cols=LINEAR,
    cat_cols=CAT,
    target_definition=(
        "SACK if `sack == 1`; SCRAMBLE if `qb_scramble == 1`; THROW if a pass attempt occurred. "
        "Mutually exclusive in the data (audit: 0 sack&scramble rows)."
    ),
    eligible_population=(
        "§6.1 core + §6.5 REG + §6.2 penalty-free, then `qb_dropback == 1`, `qb_kneel == 0`, "
        "`qb_spike == 0`. ~72–86 scrambles/season with `qb_dropback == 0` are outside this "
        "population by construction (schema audit §28.1); Model 11 still resolves their yardage."
    ),
    residual_variance_note=(
        "N/A for the baseline. Phase D estimates shrunken QB / offense-team / defense-team "
        "residuals here using the derived `qb_player_id` (= `passer_player_id` else "
        "`rusher_player_id`, since `passer_player_id` is null on 100% of scrambles — §13.2), "
        "then calibrates `break_sack` / `scrambling` / protection / pass-rush modifiers against "
        "that spread. The OL-vs-DL matchup magnitude is a rating layer, not fitted from PBP (§11 M04)."
    ),
)

if __name__ == "__main__":
    run_resolver(SPEC, build_frame)

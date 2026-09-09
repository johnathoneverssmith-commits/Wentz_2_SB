"""Model 11 — Scramble yardage (spec §11 M11).

Category model + empirical exact-yard PMF, for `qb_scramble == 1`. Population
uses `qb_scramble` (not `qb_dropback`) so the ~72–86 scrambles/yr with
`qb_dropback == 0` (schema audit §28.1) are still resolved.

Run: analysis/.venv/Scripts/python analysis/12_scramble_yards.py
"""

from __future__ import annotations

import lib_py  # thread-env setup; MUST precede numpy/polars

import polars as pl

from lib_py.pbp import load_clean
from lib_py.yardage import YardageSpec, run_yardage_resolver

SOURCE_COLS = [
    "down", "ydstogo", "yardline_100", "goal_to_go", "score_differential",
    "game_seconds_remaining", "half_seconds_remaining", "shotgun",
]
POP_COLS = ["qb_scramble", "yards_gained", "season", "qtr"]

BINS = [
    ("LOSS_OR_ZERO", None, 0), ("SHORT", 1, 4), ("MEDIUM", 5, 9),
    ("FIRST_DOWN", 10, 19), ("EXPLOSIVE", 20, None),
]

_i8 = lambda c: pl.col(c).cast(pl.Int8, strict=False).fill_null(0)


def build_frame(seasons: tuple[int, ...]) -> pl.DataFrame:
    df = load_clean(seasons, base="core", penalty_free=True, columns=sorted({*SOURCE_COLS, *POP_COLS}))
    df = df.filter((_i8("qb_scramble") == 1) & pl.col("yards_gained").is_not_null())
    return df.with_columns(
        pl.col("yards_gained").alias("yards"),
        pl.col("down").cast(pl.Int8, strict=False),
        _i8("shotgun").alias("shotgun"),
    )


def ctx_bucket(df: pl.DataFrame) -> pl.Expr:
    return (
        pl.col("down").cast(pl.Utf8) + "|"
        + pl.when(pl.col("yardline_100") <= 20).then(pl.lit("rz"))
        .when(pl.col("yardline_100") <= 60).then(pl.lit("mid")).otherwise(pl.lit("own"))
    )


SPEC = YardageSpec(
    model_id="M11",
    name="Scramble yardage",
    bins=BINS,
    source_cols=SOURCE_COLS,
    spline_cols=["ydstogo", "yardline_100", "game_seconds_remaining", "score_differential"],
    linear_cols=["half_seconds_remaining"],
    cat_cols=["down", "goal_to_go", "shotgun"],
    context_bucket=ctx_bucket,
    explosive_threshold=20,
    target_definition="`yards_gained` binned ≤0 / 1–4 / 5–9 / 10–19 / 20+, exact draw per (down × field-pos band).",
    eligible_population="§6.1 core + §6.5 REG + §6.2 penalty-free, then `qb_scramble == 1` with `yards_gained` non-null.",
    residual_variance_note=(
        "N/A for the baseline. Phase D: `scrambling` / speed / acceleration / agility (QB) and "
        "`pursuit` / `tackle` / speed (defense) shift category probabilities (spec §11 M11)."
    ),
)

if __name__ == "__main__":
    run_yardage_resolver(SPEC, build_frame)

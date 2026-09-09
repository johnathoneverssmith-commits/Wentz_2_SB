"""Model 08 — QB hit on a thrown pass (spec §11 M08).

Binary P(qb_hit) for the THROW branch. `air_yards` / depth are known upstream
(Models 05/06). Grouping vars (posteam/defteam/passer) are Phase-D residuals.
Same protection/rush rating families as Model 04 in Phase D — jointly
calibrated so total pass-rush impact isn't double-counted (spec §11 M08).

Run: analysis/.venv/Scripts/python analysis/09_qb_hit.py
"""

from __future__ import annotations

import lib_py  # thread-env setup; MUST precede numpy/polars

import polars as pl

from lib_py.pbp import load_clean
from lib_py.pipeline import ResolverSpec, run_resolver

LABELS = ["NO_HIT", "HIT"]

SOURCE_COLS = [
    "air_yards", "down", "ydstogo", "yardline_100", "shotgun",
    "score_differential", "game_seconds_remaining", "half_seconds_remaining",
]
POP_COLS = ["pass_attempt", "sack", "qb_spike", "qb_hit", "season"]

SPLINE = ["air_yards", "ydstogo", "yardline_100", "game_seconds_remaining", "score_differential"]
LINEAR = ["half_seconds_remaining"]
CAT = ["depth_category", "down", "shotgun"]

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
        pl.when(_i8("qb_hit") == 1).then(pl.lit("HIT")).otherwise(pl.lit("NO_HIT")).alias("target"),
        pl.col("down").cast(pl.Int8, strict=False),
        _i8("shotgun").alias("shotgun"),
    )


SPEC = ResolverSpec(
    model_id="M08",
    name="QB hit on a thrown pass",
    labels=LABELS,
    source_cols=SOURCE_COLS,
    spline_cols=SPLINE,
    linear_cols=LINEAR,
    cat_cols=CAT,
    target_definition="P(HIT) from the `qb_hit` flag, thrown passes only.",
    eligible_population=(
        "§6.1 core + §6.5 REG + §6.2 penalty-free, then `pass_attempt == 1`, `sack == 0`, "
        "`qb_spike == 0`, `air_yards` non-null (the THROW branch)."
    ),
    residual_variance_note=(
        "N/A for the baseline. Phase D: shrunken offense-team / defense-team / passer residuals, "
        "with pass-protection and pass-rush rating families shared with Model 04 and jointly "
        "constrained so total pass-rush impact is not double-counted (spec §11 M08, §26)."
    ),
)

if __name__ == "__main__":
    run_resolver(SPEC, build_frame)

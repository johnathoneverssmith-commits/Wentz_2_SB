"""Model 25 — Penalty hazards (spec MODEL 25, §6.2 V1.5).

The penalty module is three parts (see docs/penalty_module_plan.md):

  25a  P(dead-ball penalty | pre-snap situation)       -> `presnap`  (this file)
  25b  P(live-ball penalty | play family, situation)    -> `liveball` (this file)
  25c  penalty_type bucket + yards / enforcement        -> distributions (todo)

Both hazards use the RAW play stream (`load_raw` + a bespoke mask that KEEPS
`no_play` rows), not `load_clean` — penalties negate the play they occur on, so
the shared `admin_exclusion_mask()` (which drops `no_play`) would delete most of
the target population.

25a fires BEFORE the snap resolves in the §4 chronology → pre-snap state only.
25b fires AFTER the play family is chosen and the physical outcome sampled →
conditioned on `play_family` plus pre-snap state (no post-outcome yardage).

Rare-ish events; calibration is the metric. No player discipline rating in V1.5
(spec MODEL 25 is explicit).

Run: analysis/.venv/Scripts/python analysis/25_penalties.py [presnap|liveball]
     (no arg → runs both)
"""

from __future__ import annotations

import lib_py  # thread-env setup; MUST precede numpy/polars

import sys

import polars as pl

from lib_py.pbp import load_raw
from lib_py.pipeline import ResolverSpec, run_resolver

# Accepted fouls enforced from the previous spot with the down replayed — the
# ones that can occur before the ball is snapped (fixed 5-yд enforcement).
DEADBALL_TYPES = [
    "False Start", "Delay of Game", "Defensive Delay of Game",
    "Encroachment", "Neutral Zone Infraction", "Defensive Offside",
    "Illegal Shift", "Illegal Motion", "Illegal Formation",
    "Defensive Too Many Men on Field", "Offensive Too Many Men on Field",
    "Illegal Substitution",
]

_MASK_COLS = ["play_deleted", "aborted_play", "posteam", "season_type",
              "down", "yardline_100", "qb_kneel", "qb_spike"]

_i8 = lambda c: pl.col(c).cast(pl.Int8, strict=False).fill_null(0)


def _raw_snaps(seasons: tuple[int, ...], extra: list[str]) -> pl.DataFrame:
    """RAW stream, REG, real scrimmage snap or its negating no_play row."""
    df = load_raw(seasons, columns=sorted({*_MASK_COLS, *extra, "season", "game_id"}))
    return df.filter(
        (_i8("play_deleted") != 1)
        & (_i8("aborted_play") != 1)
        & (pl.col("season_type") == "REG")
        & pl.col("posteam").is_not_null() & (pl.col("posteam") != "")
        & pl.col("down").is_not_null()
        & pl.col("yardline_100").is_not_null()
        & (_i8("qb_kneel") != 1) & (_i8("qb_spike") != 1)
    )


# --- 25a: pre-snap / dead-ball hazard ----------------------------------------

_A_FEATS = ["down", "ydstogo", "yardline_100", "qtr", "game_seconds_remaining",
            "score_differential", "posteam_type"]


def build_presnap(seasons: tuple[int, ...]) -> pl.DataFrame:
    df = _raw_snaps(seasons, ["penalty", "penalty_type", *_A_FEATS])
    is_db = (_i8("penalty") == 1) & pl.col("penalty_type").is_in(DEADBALL_TYPES)
    return df.with_columns(
        pl.when(is_db).then(pl.lit("DEADBALL_PEN")).otherwise(pl.lit("NO_DEADBALL_PEN")).alias("target"),
        pl.col("down").cast(pl.Int8, strict=False),
        pl.col("qtr").cast(pl.Int8, strict=False),
        pl.col("posteam_type").fill_null("unknown"),
    )


SPEC_A = ResolverSpec(
    model_id="M25a",
    name="Pre-snap (dead-ball) penalty hazard",
    labels=["NO_DEADBALL_PEN", "DEADBALL_PEN"],
    source_cols=["penalty", "penalty_type", *_A_FEATS],
    spline_cols=["ydstogo", "yardline_100", "game_seconds_remaining", "score_differential"],
    linear_cols=[],
    cat_cols=["down", "qtr", "posteam_type"],
    c_grid=(0.1, 0.3, 1.0),
    target_definition=(
        "P(DEADBALL_PEN): an accepted dead-ball foul on this snap (`penalty == 1` "
        "and `penalty_type` ∈ {False Start, Delay of Game, Encroachment, Neutral "
        "Zone, Illegal Shift/Motion/Formation, Too Many Men, Illegal Sub}). "
        "Enforcement is fixed (5 yд, replay down) so only the hazard is modelled."
    ),
    eligible_population=(
        "RAW stream (keeps `no_play` — dead-ball fouls negate the play), REG, "
        "not deleted/aborted, real down + yardline, not kneel/spike. One row per "
        "pre-snap scrimmage opportunity."
    ),
    missingness_note=(
        "All predictors are pre-snap STATE the engine has when 25a fires (§4). "
        "`posteam_type` nulls → 'unknown'."
    ),
    residual_variance_note=(
        "N/A. No player 'discipline' rating in V1.5 (spec MODEL 25 is explicit); "
        "the resolver stays at ~marginal rate by design — penalties are close to "
        "situation-independent."
    ),
)


# --- 25b: live-ball hazard --------------------------------------------------

_B_FEATS = ["down", "ydstogo", "yardline_100", "qtr", "game_seconds_remaining",
            "score_differential"]


def build_liveball(seasons: tuple[int, ...]) -> pl.DataFrame:
    df = _raw_snaps(seasons, ["penalty", "penalty_type", "play_type", "pass",
                              "rush", "qb_dropback", *_B_FEATS])
    fam = (
        pl.when(pl.col("play_type") == "punt").then(pl.lit("punt"))
        .when(pl.col("play_type") == "field_goal").then(pl.lit("field_goal"))
        .when((_i8("pass") == 1) | (_i8("qb_dropback") == 1)).then(pl.lit("dropback"))
        .when(_i8("rush") == 1).then(pl.lit("designed_run"))
        .otherwise(pl.lit(None))
    )
    df = df.with_columns(fam.alias("play_family")).filter(pl.col("play_family").is_not_null())
    is_live = (_i8("penalty") == 1) & ~pl.col("penalty_type").is_in(DEADBALL_TYPES)
    return df.with_columns(
        pl.when(is_live).then(pl.lit("LIVEBALL_PEN")).otherwise(pl.lit("NO_LIVEBALL_PEN")).alias("target"),
        pl.col("down").cast(pl.Int8, strict=False),
        pl.col("qtr").cast(pl.Int8, strict=False),
    )


SPEC_B = ResolverSpec(
    model_id="M25b",
    name="Live-ball penalty hazard",
    labels=["NO_LIVEBALL_PEN", "LIVEBALL_PEN"],
    source_cols=["penalty", "penalty_type", "play_type", "pass", "rush", "qb_dropback", *_B_FEATS],
    spline_cols=["ydstogo", "yardline_100", "game_seconds_remaining", "score_differential"],
    linear_cols=[],
    cat_cols=["play_family", "down", "qtr"],
    c_grid=(0.1, 0.3, 1.0),
    target_definition=(
        "P(LIVEBALL_PEN): an accepted foul that is NOT a dead-ball type occurred "
        "on this play (holding, DPI, defensive holding, roughing, face mask, "
        "illegal block, …). `play_family` ∈ {dropback, designed_run, punt, "
        "field_goal}. Type + yardage + enforcement are 25c."
    ),
    eligible_population=(
        "Same RAW-stream mask as 25a, then the row resolves to one of the four "
        "play families. Fired after the physical outcome in the §4 chronology, "
        "but only pre-snap STATE + `play_family` are used as predictors — no "
        "post-outcome yardage (that would leak the enforcement)."
    ),
    missingness_note="Pre-snap STATE + the already-simulated `play_family`. No imputation.",
    residual_variance_note=(
        "N/A. No discipline rating in V1.5. DPI/holding rise on deep dropbacks — "
        "`play_family` + field position carry that; deeper air-yard conditioning "
        "is a 25c refinement."
    ),
)


def main() -> None:
    which = sys.argv[1] if len(sys.argv) > 1 else "both"
    if which in ("presnap", "both"):
        run_resolver(SPEC_A, build_presnap)
    if which in ("liveball", "both"):
        run_resolver(SPEC_B, build_liveball)


if __name__ == "__main__":
    main()

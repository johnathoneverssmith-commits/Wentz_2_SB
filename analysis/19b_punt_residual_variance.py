"""Per-punter residual variance for M21's Phase D player modifiers.

Punter attributes (`punt_power`, `punt_accuracy`, `coffin_corner`,
`hang_time`) are not fit to the play-by-play the way M21's baseline is —
there is no rating in nflverse to regress against. What the historical data
*can* answer is how much punters actually differ from each other, after
controlling for field position: that spread is the variance budget the
rating-layer modifiers (`src/engine/ratings.ts`) get to spend, so an average
punter reproduces the baseline and an elite one moves outcomes by a
plausible, not invented, amount.

Four residuals, one per attribute's intended role (engine_spec.md MODEL 21
Player modifiers):

  - `punt_power`    -> gross distance, relative to the field-position-band
                       mean every other punt in that band gets.
  - `hang_time`      -> returnability: fair-catch-or-no-return rate, and
                       return yards conditional on a return.
  - `punt_accuracy` / `coffin_corner` -> placement outcomes near the goal
                       line specifically (the situation both attributes are
                       named for): touchback rate and "useful" (downed or
                       out-of-bounds, i.e. not a touchback) rate inside the
                       opponent 20.

A punter's own residual is his career mean minus the field-position-band
expectation, shrunk toward zero by attempt count (empirical-Bayes-lite) so a
punter with a handful of kicks doesn't read as elite or awful off noise.
`sd(shrunk per-punter residuals)` across qualifying punters is the number
`src/engine/ratings.ts`'s punter families calibrate their `beta_per_z`
against — see CLAUDE_PUNTER_ATTRIBUTES_IMPLEMENTATION_PROMPT.md.

Run: analysis/.venv/Scripts/python analysis/19b_punt_residual_variance.py
"""

from __future__ import annotations

import lib_py  # thread-env setup; MUST precede numpy/polars

import json

import numpy as np
import polars as pl

from lib_py.pbp import load_clean
from lib_py.report import ARTIFACTS

# The wide window used elsewhere in this repo for residual-variance anchors
# (docs/decisions.md / CLAUDE.md §13.6) rather than the 2-season locked-train
# split M21's baseline itself was fit on — a variance estimate wants the
# largest stable sample, not a holdout discipline.
SEASONS = tuple(range(2018, 2026))

# A punter needs a real sample before his own mean means anything; this also
# matches the shrinkage constant below (a full "prior" season of attempts).
MIN_ATTEMPTS = 50
# Empirical-Bayes-lite shrinkage: effective_n / (effective_n + K) weight on
# the punter's own mean, rest on the population mean. K is picked so a
# punter right at MIN_ATTEMPTS is trusted about half as much as one who has
# punted twice as often — not fit, just a reasonable damper.
SHRINKAGE_K = 50.0

SOURCE_COLS = [
    "yardline_100", "punt_attempt", "punt_blocked", "punter_player_id",
    "punter_player_name", "kick_distance", "touchback", "punt_out_of_bounds",
    "punt_downed", "punt_fair_catch", "return_yards",
]


def _base() -> pl.DataFrame:
    df = load_clean(SEASONS, base="admin", columns=SOURCE_COLS)
    i8 = lambda c: pl.col(c).cast(pl.Int8, strict=False).fill_null(0)
    return df.filter((i8("punt_attempt") == 1) & (i8("punt_blocked") != 1) & pl.col("punter_player_id").is_not_null())


def _fp_band(col: str = "yardline_100") -> pl.Expr:
    """10-yard field-position band, matching 19_punts.py's distance table."""
    return (pl.col(col) // 10 * 10).cast(pl.Int32)


def _shrink(per_punter: pl.DataFrame, value_col: str, n_col: str, pop_mean: float) -> pl.DataFrame:
    return per_punter.with_columns(
        (
            pl.col(n_col) / (pl.col(n_col) + SHRINKAGE_K) * (pl.col(value_col) - pop_mean)
        ).alias(f"{value_col}_shrunk_residual")
    )


def distance_residuals(df: pl.DataFrame) -> dict:
    """punt_power: gross distance vs. the field-position band's own mean."""
    d = df.with_columns(_fp_band().alias("fp"))
    band_mean = d.group_by("fp").agg(pl.col("kick_distance").mean().alias("band_mean"))
    d = d.join(band_mean, on="fp").with_columns(
        (pl.col("kick_distance") - pl.col("band_mean")).alias("resid")
    )
    per_punter = (
        d.group_by(["punter_player_id", "punter_player_name"])
        .agg(pl.col("resid").mean().alias("mean_resid"), pl.len().alias("n"))
        .filter(pl.col("n") >= MIN_ATTEMPTS)
    )
    per_punter = _shrink(per_punter, "mean_resid", "n", 0.0)
    resid = per_punter["mean_resid_shrunk_residual"].to_numpy()
    return {
        "n_qualifying_punters": per_punter.height,
        "min_attempts": MIN_ATTEMPTS,
        "sd_yards": float(np.std(resid, ddof=1)),
        "p10_yards": float(np.percentile(resid, 10)),
        "p90_yards": float(np.percentile(resid, 90)),
    }


def returnability_residuals(df: pl.DataFrame) -> dict:
    """hang_time: fair-catch-or-downed (no return) rate, and return yards
    conditional on an actual return, both vs. the field-position band mean."""
    d = df.with_columns(
        _fp_band().alias("fp"),
        (
            (pl.col("punt_fair_catch").fill_null(0) == 1) | (pl.col("punt_downed").fill_null(0) == 1)
        ).cast(pl.Float64).alias("no_return"),
    )
    band_mean = d.group_by("fp").agg(pl.col("no_return").mean().alias("band_mean"))
    d = d.join(band_mean, on="fp").with_columns((pl.col("no_return") - pl.col("band_mean")).alias("resid"))
    per_punter = (
        d.group_by(["punter_player_id", "punter_player_name"])
        .agg(pl.col("resid").mean().alias("mean_resid"), pl.len().alias("n"))
        .filter(pl.col("n") >= MIN_ATTEMPTS)
    )
    per_punter = _shrink(per_punter, "mean_resid", "n", 0.0)
    no_return_resid = per_punter["mean_resid_shrunk_residual"].to_numpy()

    returned = df.filter(pl.col("return_yards").is_not_null())
    pop_mean_ry = float(returned["return_yards"].mean())
    per_punter_ry = (
        returned.group_by(["punter_player_id"])
        .agg(pl.col("return_yards").mean().alias("mean_ry"), pl.len().alias("n"))
        .filter(pl.col("n") >= 20)  # fewer returns than attempts; a smaller floor
    )
    per_punter_ry = _shrink(per_punter_ry, "mean_ry", "n", pop_mean_ry)
    ry_resid = per_punter_ry["mean_ry_shrunk_residual"].to_numpy()

    return {
        "no_return_rate": {
            "n_qualifying_punters": per_punter.height,
            "sd": float(np.std(no_return_resid, ddof=1)),
        },
        "return_yards_when_returned": {
            "n_qualifying_punters": per_punter_ry.height,
            "sd_yards": float(np.std(ry_resid, ddof=1)),
            "population_mean": pop_mean_ry,
        },
    }


def placement_residuals(df: pl.DataFrame) -> dict:
    """punt_accuracy / coffin_corner: touchback and useful-placement rate,
    restricted to punts snapped from the opponent's side of the field —
    coffin-corner skill is close to meaningless at midfield, which is the
    reason the attribute exists rather than being folded into punt_power.
    45 rather than a stricter "inside the 40": a real coffin-corner punt is
    already a small fraction of any punter's attempts (418 of 16,701 punts
    in this sample are from inside the 40 at all), and 45 is what it takes
    for enough punters to clear a stable-sample floor."""
    near_gl = df.filter(pl.col("yardline_100") <= 45)
    d = near_gl.with_columns(
        pl.col("touchback").fill_null(0).cast(pl.Float64).alias("tb"),
        (
            (pl.col("punt_downed").fill_null(0) == 1) | (pl.col("punt_out_of_bounds").fill_null(0) == 1)
        ).cast(pl.Float64).alias("useful"),
    )
    band_mean = d.group_by(_fp_band().alias("fp")).agg(
        pl.col("tb").mean().alias("tb_band_mean"), pl.col("useful").mean().alias("useful_band_mean")
    )
    d = d.with_columns(_fp_band().alias("fp")).join(band_mean, on="fp").with_columns(
        (pl.col("tb") - pl.col("tb_band_mean")).alias("tb_resid"),
        (pl.col("useful") - pl.col("useful_band_mean")).alias("useful_resid"),
    )
    per_punter = (
        d.group_by(["punter_player_id", "punter_player_name"])
        .agg(
            pl.col("tb_resid").mean().alias("mean_tb_resid"),
            pl.col("useful_resid").mean().alias("mean_useful_resid"),
            pl.len().alias("n"),
        )
        .filter(pl.col("n") >= 15)  # near-goal-line punts are a fraction of a punter's total
    )
    per_punter = _shrink(per_punter, "mean_tb_resid", "n", 0.0)
    per_punter = _shrink(per_punter, "mean_useful_resid", "n", 0.0)
    return {
        "n_qualifying_punters": per_punter.height,
        "min_attempts": 15,
        "touchback_rate": {"sd": float(np.std(per_punter["mean_tb_resid_shrunk_residual"].to_numpy(), ddof=1))},
        "useful_placement_rate": {
            "sd": float(np.std(per_punter["mean_useful_resid_shrunk_residual"].to_numpy(), ddof=1))
        },
    }


def main() -> None:
    df = _base()
    out = {
        "seasons": list(SEASONS),
        "n_punts": df.height,
        "n_distinct_punters": df["punter_player_id"].n_unique(),
        "punt_power_distance": distance_residuals(df),
        "returnability": returnability_residuals(df),
        "placement_near_goal_line": placement_residuals(df),
    }
    path = ARTIFACTS / "models" / "m21_punter_residual_variance.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, indent=2))
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()

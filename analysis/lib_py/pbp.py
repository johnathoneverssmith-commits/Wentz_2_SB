"""nflverse play-by-play loading + §6 centralized cleaning (Python port).

This MUST stay behaviourally identical to analysis/lib/filters.ts. If one
changes, change both and note it in docs/decisions.md.
"""

from __future__ import annotations

from pathlib import Path
from typing import Iterable, Literal

import polars as pl

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
PRIMARY_SEASONS: tuple[int, ...] = (2023, 2024, 2025)

# Columns whose parquet physical type differs by season (schema audit finding).
_CAST_ON_LOAD = {
    "goal_to_go": pl.Int8,
}

# Columns every §6 filter needs — always read even when a subset is requested.
FILTER_COLS = [
    "play_deleted", "aborted_play", "play_type", "posteam", "down", "yardline_100",
    "season_type", "penalty", "qb_kneel", "qb_spike",
]


def pbp_path(season: int) -> Path:
    return DATA_DIR / f"play_by_play_{season}.parquet"


def load_raw(seasons: Iterable[int], columns: list[str] | None = None) -> pl.DataFrame:
    """Concat the requested seasons. `season` column is always present."""
    frames = []
    for s in seasons:
        cols = None if columns is None else sorted({*columns, *FILTER_COLS, "season"})
        df = pl.read_parquet(pbp_path(s), columns=cols)
        for name, dtype in _CAST_ON_LOAD.items():
            if name in df.columns:
                df = df.with_columns(pl.col(name).cast(dtype, strict=False))
        frames.append(df)
    return pl.concat(frames, how="vertical_relaxed")


# --- §6 filters -------------------------------------------------------------

def _flag(col: str) -> pl.Expr:
    """A 0/1/bool nflverse flag, nulls treated as 0 (matches filters.ts `is0`)."""
    return pl.col(col).cast(pl.Int8, strict=False).fill_null(0) == 1


def admin_exclusion_mask() -> pl.Expr:
    """§6.1 minus the down/yardline checks — for kickoffs / XP / 2pt (§28.2)."""
    return (
        ~_flag("play_deleted")
        & ~_flag("aborted_play")
        & (pl.col("play_type") != "no_play")
        & pl.col("posteam").is_not_null()
        & (pl.col("posteam") != "")
    )


def core_exclusion_mask() -> pl.Expr:
    """§6.1 core row exclusions — a real offensive snap with a real down."""
    return (
        admin_exclusion_mask()
        & pl.col("down").is_not_null()
        & pl.col("yardline_100").is_not_null()
    )


def production_baseline_mask() -> pl.Expr:
    """§6.5 — REG season only."""
    return pl.col("season_type") == "REG"


def penalty_free_mask() -> pl.Expr:
    """§6.2 — physical-outcome models fit on penalty-free plays."""
    return ~_flag("penalty")


def kneel_or_spike_mask() -> pl.Expr:
    """§6.3."""
    return _flag("qb_kneel") | _flag("qb_spike")


def load_clean(
    seasons: Iterable[int],
    *,
    base: Literal["core", "admin"] = "core",
    penalty_free: bool = False,
    columns: list[str] | None = None,
) -> pl.DataFrame:
    """Load seasons with §6.1 (+ §6.5 REG) applied; optionally §6.2 penalty-free."""
    df = load_raw(seasons, columns=columns)
    mask = (core_exclusion_mask() if base == "core" else admin_exclusion_mask()) & production_baseline_mask()
    if penalty_free:
        mask = mask & penalty_free_mask()
    return df.filter(mask)


# --- §6.6 applicable-population denominators -------------------------------

APPLICABLE_POPULATION: dict[str, pl.Expr] = {
    "run_gap": pl.col("play_type") == "run",
    "run_location": pl.col("play_type") == "run",
    "air_yards": pl.col("play_type") == "pass",
    "pass_length": pl.col("play_type") == "pass",
    "pass_location": pl.col("play_type") == "pass",
    "cp": pl.col("play_type") == "pass",
    "cpoe": pl.col("play_type") == "pass",
    "yards_after_catch": _flag("complete_pass"),
    "kick_distance": pl.col("play_type") == "field_goal",
    "field_goal_result": pl.col("play_type") == "field_goal",
    "penalty_type": _flag("penalty"),
    "penalty_yards": _flag("penalty"),
}

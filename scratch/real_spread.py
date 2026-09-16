"""Scratch: real between-team vs within-team scoring variance, 2023-2025.

The engine's points_sd is ~10% low. The question this answers is *where* the
missing variance lives: in how much teams differ from each other (between), or
in how much one team varies week to week (within).
"""
from __future__ import annotations

import lib_py  # noqa: F401  (thread-env setup)

import numpy as np
import polars as pl

from lib_py.pbp import load_clean
from lib_py.split import STANDARD

df = load_clean(
    STANDARD.production,
    base="core",
    columns=["game_id", "season", "home_team", "away_team", "home_score", "away_score"],
)

games = df.select(
    ["game_id", "season", "home_team", "away_team", "home_score", "away_score"]
).unique(subset=["game_id"])

# one row per team-game
rows = pl.concat([
    games.select(
        pl.col("season"),
        pl.col("home_team").alias("team"),
        pl.col("home_score").cast(pl.Float64).alias("pts"),
    ),
    games.select(
        pl.col("season"),
        pl.col("away_team").alias("team"),
        pl.col("away_score").cast(pl.Float64).alias("pts"),
    ),
])

pts = rows["pts"].to_numpy()
print(f"team-games: {len(pts)}  mean {pts.mean():.2f}  sd {pts.std():.3f}")

# Between/within by team-season, which is the unit that matters: a roster is
# the same team for a year, not for three.
g = rows.group_by(["season", "team"]).agg(
    pl.col("pts").mean().alias("m"), pl.col("pts").var(ddof=0).alias("v"), pl.len().alias("n")
)
between = float(np.std(g["m"].to_numpy()))
within = float(np.sqrt(np.mean(g["v"].to_numpy())))
print(f"between-team-season sd: {between:.3f}")
print(f"within-team-season sd:  {within:.3f}")
print(f"check  sqrt(b^2+w^2) =  {np.sqrt(between**2 + within**2):.3f}")

# and by franchise across the window, for comparison
g2 = rows.group_by("team").agg(pl.col("pts").mean().alias("m"))
print(f"between-franchise sd (3yr pooled): {float(np.std(g2['m'].to_numpy())):.3f}")

qs = [5, 10, 25, 50, 75, 90, 95, 99]
print("percentiles:", {q: float(np.percentile(pts, q)) for q in qs})
print(f"share under 10: {float((pts < 10).mean()):.3f}")
print(f"share over 30:  {float((pts > 30).mean()):.3f}")

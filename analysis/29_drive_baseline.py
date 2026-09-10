"""§22 companion — the empirical DRIVE baseline (2023–25).

Extracts one record per drive (start field position, outcome, plays, whether it
crossed midfield) and runs it through `lib_py.drives.drive_table`, the SAME
summariser `23_full_sim_validation.py` uses on the engine's `drives_log`.
Writes `artifacts/validation/drive_baseline.json`.

Run: analysis/.venv/Scripts/python analysis/29_drive_baseline.py
"""

from __future__ import annotations

import lib_py  # noqa: F401  thread pin, must precede numpy

import json

import polars as pl

from lib_py.drives import drive_table, records_from_nflverse
from lib_py.pbp import load_raw
from lib_py.report import ARTIFACTS
from lib_py.split import STANDARD

COLS = ["game_id", "fixed_drive", "fixed_drive_result", "down", "yardline_100",
        "posteam", "play_type", "special_teams_play", "first_down", "drive_first_downs"]


def build_drive_rows(seasons: tuple[int, ...]) -> pl.DataFrame:
    df = load_raw(seasons, columns=COLS)
    df = df.filter(pl.col("posteam").is_not_null() & pl.col("fixed_drive").is_not_null())
    df = df.with_columns(
        (pl.col("game_id") + "_" + pl.col("fixed_drive").cast(pl.Utf8)).alias("drive_id")
    )
    scrim = df.filter(pl.col("down").is_not_null())
    return (
        scrim.sort("drive_id")
        .group_by("drive_id")
        .agg(
            pl.col("game_id").first().alias("game_id"),
            pl.col("yardline_100").first().alias("start_yl"),
            pl.col("fixed_drive_result").first().alias("result"),
            pl.col("posteam").first().alias("posteam"),
            pl.len().alias("plays"),
            (pl.col("yardline_100").min() < 50).alias("crossed_mid"),
            pl.col("first_down").cast(pl.Int32, strict=False).fill_null(0).sum().alias("first_downs"),
        )
    )


def main() -> None:
    seasons = STANDARD.production
    rows = build_drive_rows(seasons)
    n_games = rows["game_id"].n_unique()
    recs = records_from_nflverse(rows)
    table = drive_table(recs, min_plays=1)
    table["seasons"] = list(seasons)
    table["n_games"] = int(n_games)
    table["drives_per_team_game"] = round(table["n"] / (n_games * 2), 3)

    out = ARTIFACTS / "validation" / "drive_baseline.json"
    out.write_text(json.dumps(table, indent=2) + "\n", encoding="utf-8")

    print(f"seasons {list(seasons)}  games {n_games}  drives {table['n']:,} "
          f"({table['drives_per_team_game']}/team-game)")
    print(f"points/drive {table['points_per_drive']}   "
          f"never crossed mid {table['never_crossed_mid']:.2%}")
    sy = table["start_yl"]
    print(f"start_yl  mean {sy['mean']}  p10 {sy['p10']}  p25 {sy['p25']}  "
          f"median {sy['median']}  p75 {sy['p75']}  p90 {sy['p90']}")
    print("\noutcome mix:")
    for k, v in table["outcome_mix"].items():
        print(f"  {k:16s} {v:6.2%}")
    print("\npoints/drive by start field position:")
    print(f"  {'band':>8s} {'n':>7s} {'share':>7s} {'ppd':>7s} {'TD%':>6s} {'plays':>6s}")
    for r in table["fp_bands"]:
        if not r["n"]:
            continue
        print(f"  {r['band']:>8s} {r['n']:7,} {r['share']:7.1%} "
              f"{r['ppd']:7.3f} {r['td_rate']:6.1%} {r['plays']:6.2f}")
    print(f"\nwrote {out.relative_to(ARTIFACTS.parent)}")


if __name__ == "__main__":
    main()

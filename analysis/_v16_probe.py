"""V1.6 probe 2: the empirical DRIVE picture the engine has to reproduce.

Nothing in §22 measures drive start field position, the drive-outcome mix, or
points-per-drive by starting field position -- yet those are what points/drive
decomposes into. Build the empirical side here.
"""

import lib_py  # noqa: F401  thread pin, must precede numpy

import polars as pl

from lib_py.pbp import load_raw
from lib_py.split import STANDARD

COLS = ["game_id", "fixed_drive", "fixed_drive_result", "down", "ydstogo",
        "yards_gained", "posteam", "defteam", "yardline_100", "play_type",
        "drive_start_yard_line", "series", "series_result", "special_teams_play",
        "play_type_nfl", "qb_kneel", "qb_spike"]


def main() -> None:
    df = load_raw(STANDARD.production, columns=COLS)
    df = df.filter(pl.col("posteam").is_not_null() & pl.col("fixed_drive").is_not_null())
    df = df.with_columns(
        (pl.col("game_id") + "_" + pl.col("fixed_drive").cast(pl.Utf8)).alias("drive_id")
    )

    # one row per drive: first scrimmage snap gives the start field position
    scrim = df.filter(pl.col("down").is_not_null())
    drives = (
        scrim.sort(["drive_id"])
        .group_by("drive_id")
        .agg(
            pl.col("yardline_100").first().alias("start_yl"),
            pl.col("fixed_drive_result").first().alias("result"),
            pl.col("posteam").first().alias("posteam"),
            pl.len().alias("plays"),
            pl.col("yardline_100").min().alias("best_yl"),
        )
    )
    n = drives.height
    print(f"drives={n:,}  plays/drive={drives['plays'].mean():.2f}")
    print(f"\nstart field position (yardline_100, 100 = own goal line):")
    print(f"  mean {drives['start_yl'].mean():.2f}   median {drives['start_yl'].median():.1f}")
    q = drives["start_yl"].quantile
    print(f"  p10 {q(0.10):.0f}  p25 {q(0.25):.0f}  p75 {q(0.75):.0f}  p90 {q(0.90):.0f}")

    print("\ndrive outcome mix:")
    mix = (
        drives.group_by("result")
        .agg(pl.len().alias("n"))
        .with_columns((pl.col("n") / n).alias("share"))
        .sort("n", descending=True)
    )
    for r in mix.iter_rows(named=True):
        print(f"  {str(r['result']):24s} {r['share']:6.2%}  ({r['n']:,})")

    # points per drive by starting field position
    PTS = {"Touchdown": 7.0, "Field goal": 3.0, "Safety": -2.0,
           "Opp touchdown": -7.0}
    drives = drives.with_columns(
        pl.col("result").replace_strict(PTS, default=0.0).alias("pts"),
        (pl.col("start_yl") / 10).floor().cast(pl.Int32).alias("fp_band"),
        (pl.col("best_yl") < 50).alias("crossed_mid"),
    )
    print(f"\noverall points/drive = {drives['pts'].mean():.4f}   "
          f"never crossed midfield = {1 - drives['crossed_mid'].mean():.2%}   "
          f"3-and-out (<=3 plays, no score) = "
          f"{drives.filter((pl.col('plays') <= 3) & (pl.col('pts') <= 0)).height / n:.2%}")

    print("\npoints/drive by start field position:")
    by = (
        drives.group_by("fp_band")
        .agg(pl.len().alias("n"), pl.col("pts").mean().alias("ppd"),
             pl.col("plays").mean().alias("plays"),
             (pl.col("result") == "Touchdown").mean().alias("td"))
        .sort("fp_band")
    )
    print(f"  {'own-yards-to-go':>16s} {'n':>7s} {'share':>7s} {'pts/drv':>8s} {'TD%':>7s} {'plays':>6s}")
    for r in by.iter_rows(named=True):
        b = r["fp_band"]
        print(f"  {f'{b*10}-{b*10+9}':>16s} {r['n']:7,} {r['n']/n:7.1%} "
              f"{r['ppd']:8.3f} {r['td']:7.1%} {r['plays']:6.2f}")

    # series-level progression: what the engine's down loop must reproduce
    ser = df.filter(pl.col("down").is_not_null() & pl.col("series").is_not_null())
    ser = ser.with_columns(
        (pl.col("drive_id") + "_" + pl.col("series").cast(pl.Utf8)).alias("series_id")
    )
    sg = ser.group_by("series_id").agg(
        pl.col("down").max().alias("max_down"), pl.len().alias("plays"),
        pl.col("series_result").first().alias("res"))
    print(f"\nseries: {sg.height:,}   plays/series={sg['plays'].mean():.3f}   "
          f"series/drive={sg.height / n:.3f}")
    print("  reached down:", {d: round(
        sg.filter(pl.col("max_down") >= d).height / sg.height, 4) for d in (1, 2, 3, 4)})
    sres = (sg.group_by("res").agg(pl.len().alias("n"))
            .with_columns((pl.col("n") / sg.height).alias("share"))
            .sort("n", descending=True))
    for r in sres.iter_rows(named=True):
        print(f"  {str(r['res']):24s} {r['share']:6.2%}")


if __name__ == "__main__":
    main()

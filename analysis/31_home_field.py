"""How big the home-field advantage is, and where in a game it lives.

The engine gives the home team nothing. Measured over 47,616 simulated games
(`analysis/30_win_probability.ts`), an even matchup is a coin flip to within
noise, and the residual that *is* there is the 1% tie rate rather than an
edge. The real league is not like that, and `docs/decisions.md` -> OQ-10
records the gap.

Closing it needs two numbers this script measures from the same 2018-2025
window the engine is calibrated against, rather than from memory:

  1. **How much.** Home win rate and mean home margin, so the target is the
     league's own number for the era the engine models — not the historical
     ~57% that predates the recent decline.

  2. **Where.** A home-field term has to enter the game model somewhere, and
     the defensible place is wherever the real advantage actually shows up.
     So this splits the obvious channels by `posteam_type`: pre-snap penalties
     (the crowd-noise story), penalties overall (the officiating story),
     completion rate and sack rate (communication), third-down conversion,
     and EPA per play.

Everything is regular season only. The postseason has neutral-site games, a
different home/away mix, and far fewer of them.

Run: analysis/.venv/Scripts/python analysis/31_home_field.py
"""

from __future__ import annotations

import lib_py  # noqa: F401  thread pin, must precede numpy

import json

import polars as pl

from lib_py.pbp import load_raw
from lib_py.report import ARTIFACTS

SEASONS: tuple[int, ...] = (2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025)

GAME_COLS = [
    "game_id", "season", "season_type", "week", "home_team", "away_team",
    "home_score", "away_score", "result",
]

PLAY_COLS = [
    "game_id", "season", "season_type", "posteam", "posteam_type", "play_type",
    "penalty", "penalty_team", "penalty_type", "penalty_yards", "down",
    "complete_pass", "sack", "qb_dropback", "third_down_converted",
    "third_down_failed", "epa", "home_team", "away_team", "rushing_yards",
    "interception", "fumble_lost", "field_goal_result", "field_goal_attempt",
    "kick_distance",
]


def game_level(df: pl.DataFrame) -> dict:
    """One row per game: who hosted, who won, by how much."""
    games = (
        df.filter(pl.col("season_type") == "REG")
        .group_by("game_id")
        .agg(
            pl.col("season").first(),
            pl.col("home_score").max().alias("hs"),
            pl.col("away_score").max().alias("as_"),
        )
        .drop_nulls(["hs", "as_"])
    )
    games = games.with_columns((pl.col("hs") - pl.col("as_")).alias("margin"))
    n = games.height
    wins = games.filter(pl.col("margin") > 0).height
    ties = games.filter(pl.col("margin") == 0).height

    by_season = (
        games.group_by("season")
        .agg(
            pl.len().alias("games"),
            (pl.col("margin") > 0).mean().alias("home_win"),
            (pl.col("margin") == 0).mean().alias("tie"),
            pl.col("margin").mean().alias("mean_margin"),
        )
        .sort("season")
    )

    return {
        "games": n,
        # ties count as half a win, the way a standings percentage does
        "home_win_pct": (wins + ties / 2) / n,
        "home_win_rate_strict": wins / n,
        "tie_rate": ties / n,
        "mean_home_margin": games["margin"].mean(),
        "sd_home_margin": games["margin"].std(),
        "by_season": by_season.to_dicts(),
    }


def split_by_side(plays: pl.DataFrame, name: str, expr: pl.Expr, keep: pl.Expr | None = None) -> dict:
    """Mean of `expr` for the home offense vs the away offense."""
    df = plays if keep is None else plays.filter(keep)
    out = (
        df.filter(pl.col("posteam_type").is_in(["home", "away"]))
        .group_by("posteam_type")
        .agg(pl.len().alias("n"), expr.alias("value"))
    )
    rows = {r["posteam_type"]: r for r in out.to_dicts()}
    home = rows.get("home", {"value": float("nan"), "n": 0})
    away = rows.get("away", {"value": float("nan"), "n": 0})
    return {
        "metric": name,
        "home": home["value"],
        "away": away["value"],
        "home_minus_away": (home["value"] or 0) - (away["value"] or 0),
        "n_home": home["n"],
        "n_away": away["n"],
    }


def penalties_on_offense(plays: pl.DataFrame) -> list[dict]:
    """Pre-snap fouls charged to the team with the ball, by where it's playing.

    False start and delay of game are the crowd-noise channel: they are the
    fouls a road offense commits because it cannot hear its own snap count.
    """
    flagged = plays.filter(
        (pl.col("penalty").cast(pl.Int8, strict=False).fill_null(0) == 1)
        & pl.col("penalty_team").is_not_null()
    )
    on_off = flagged.filter(pl.col("penalty_team") == pl.col("posteam"))
    presnap = on_off.filter(
        pl.col("penalty_type").is_in(["False Start", "Delay of Game", "Illegal Formation",
                                      "Illegal Shift", "Illegal Motion"])
    )
    total_plays = plays.filter(pl.col("posteam_type").is_in(["home", "away"])).group_by(
        "posteam_type"
    ).agg(pl.len().alias("plays"))
    counts = presnap.group_by("posteam_type").agg(pl.len().alias("flags"))
    joined = total_plays.join(counts, on="posteam_type", how="left").with_columns(
        (pl.col("flags").fill_null(0) / pl.col("plays")).alias("rate")
    )
    rows = {r["posteam_type"]: r for r in joined.to_dicts()}

    any_counts = on_off.group_by("posteam_type").agg(pl.len().alias("flags"))
    any_joined = total_plays.join(any_counts, on="posteam_type", how="left").with_columns(
        (pl.col("flags").fill_null(0) / pl.col("plays")).alias("rate")
    )
    any_rows = {r["posteam_type"]: r for r in any_joined.to_dicts()}

    return [
        {
            "metric": "pre-snap fouls per play, offense",
            "home": rows.get("home", {}).get("rate"),
            "away": rows.get("away", {}).get("rate"),
            "home_minus_away": (rows.get("home", {}).get("rate") or 0)
            - (rows.get("away", {}).get("rate") or 0),
        },
        {
            "metric": "any foul on offense per play",
            "home": any_rows.get("home", {}).get("rate"),
            "away": any_rows.get("away", {}).get("rate"),
            "home_minus_away": (any_rows.get("home", {}).get("rate") or 0)
            - (any_rows.get("away", {}).get("rate") or 0),
        },
    ]


def main() -> None:
    df = load_raw(SEASONS, columns=sorted(set(GAME_COLS + PLAY_COLS)))
    games = game_level(df)

    plays = df.filter(
        (pl.col("season_type") == "REG")
        & pl.col("posteam").is_not_null()
        & pl.col("posteam_type").is_not_null()
    )
    scrimmage = plays.filter(pl.col("play_type").is_in(["pass", "run"]))

    channels = [
        *penalties_on_offense(plays),
        split_by_side(
            scrimmage, "EPA per scrimmage play",
            pl.col("epa").mean(),
        ),
        split_by_side(
            scrimmage, "completion rate",
            pl.col("complete_pass").cast(pl.Float64, strict=False).mean(),
            keep=pl.col("play_type") == "pass",
        ),
        split_by_side(
            scrimmage, "sack rate per dropback",
            pl.col("sack").cast(pl.Float64, strict=False).mean(),
            keep=pl.col("qb_dropback").cast(pl.Int8, strict=False).fill_null(0) == 1,
        ),
        split_by_side(
            plays, "third-down conversion",
            pl.col("third_down_converted").cast(pl.Float64, strict=False).mean(),
            keep=(pl.col("down") == 3)
            & (
                (pl.col("third_down_converted").cast(pl.Int8, strict=False).fill_null(0) == 1)
                | (pl.col("third_down_failed").cast(pl.Int8, strict=False).fill_null(0) == 1)
            ),
        ),
        split_by_side(
            scrimmage, "yards per carry",
            pl.col("rushing_yards").cast(pl.Float64, strict=False).mean(),
            keep=pl.col("play_type") == "run",
        ),
        split_by_side(
            scrimmage, "interception rate per dropback",
            pl.col("interception").cast(pl.Float64, strict=False).mean(),
            keep=pl.col("qb_dropback").cast(pl.Int8, strict=False).fill_null(0) == 1,
        ),
        split_by_side(
            plays, "fumble lost per scrimmage play",
            pl.col("fumble_lost").cast(pl.Float64, strict=False).mean(),
            keep=pl.col("play_type").is_in(["pass", "run"]),
        ),
        split_by_side(
            plays, "field goals made",
            pl.col("field_goal_result").eq("made").cast(pl.Float64).mean(),
            keep=pl.col("field_goal_attempt").cast(pl.Int8, strict=False).fill_null(0) == 1,
        ),
        split_by_side(
            plays, "field goal distance attempted",
            pl.col("kick_distance").cast(pl.Float64, strict=False).mean(),
            keep=pl.col("field_goal_attempt").cast(pl.Int8, strict=False).fill_null(0) == 1,
        ),
    ]

    report = {"seasons": list(SEASONS), "games": games, "channels": channels}

    print(f"\nRegular season {SEASONS[0]}-{SEASONS[-1]}: {games['games']} games")
    print(f"  home win pct (ties = half)  {games['home_win_pct'] * 100:.2f}%")
    print(f"  home wins outright          {games['home_win_rate_strict'] * 100:.2f}%")
    print(f"  ties                        {games['tie_rate'] * 100:.2f}%")
    print(f"  mean home margin            {games['mean_home_margin']:+.3f} points")
    print(f"  sd of margin                {games['sd_home_margin']:.2f}")
    print("\n  by season")
    for row in games["by_season"]:
        print(
            f"    {row['season']}  {row['games']:>3} games   "
            f"home {row['home_win'] * 100:>5.1f}%   margin {row['mean_margin']:+.2f}"
        )

    print("\nWhere it lives (home offense vs away offense)")
    for c in channels:
        h, a, d = c["home"], c["away"], c["home_minus_away"]
        print(f"  {c['metric']:<34} home {h:>9.5f}   away {a:>9.5f}   diff {d:>+9.5f}")

    out = ARTIFACTS / "validation" / "home_field.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2, default=float), encoding="utf-8")
    print(f"\nwrote {out}")


if __name__ == "__main__":
    main()

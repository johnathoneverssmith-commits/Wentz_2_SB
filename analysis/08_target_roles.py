"""Model 07 — Target-player / target-role selection (spec §11 M07, §15).

PBP names only the *targeted* receiver, not everyone who ran a route, so a
true route-participation choice model can't be fit from PBP. Instead: rank
receivers by target volume within each team-season into ROLE_1..4 + ROLE_5_PLUS
and learn the empirical target-share per role, overall and by situation.

The current-roster engine orders players into these roles from the depth-chart
/ usage system (receiving ability may order players, but the share prior comes
from here, never from `overall`).

Run: analysis/.venv/Scripts/python analysis/08_target_roles.py
"""

from __future__ import annotations

import lib_py  # thread-env setup; MUST precede numpy/polars

import polars as pl

from lib_py.roles import RoleSpec, build_role_shares, role_report

_i8 = lambda c: pl.col(c).cast(pl.Int8, strict=False).fill_null(0)


def _population(df: pl.DataFrame) -> pl.Expr:
    return (_i8("pass_attempt") == 1) & (_i8("sack") != 1) & (_i8("qb_spike") != 1)


def _depth(col="air_yards") -> pl.Expr:
    ay = pl.col(col)
    return (
        pl.when(ay.is_null()).then(pl.lit("unknown"))
        .when(ay < 0).then(pl.lit("BEHIND_LOS")).when(ay <= 9).then(pl.lit("SHORT"))
        .when(ay <= 19).then(pl.lit("INTERMEDIATE")).otherwise(pl.lit("DEEP"))
    )


SPEC = RoleSpec(
    model_id="M07",
    name="Target-role selection",
    id_col="receiver_player_id",
    n_named_roles=4,
    tail_label="5_PLUS",
    population=_population,
    extra_cols=["pass_attempt", "sack", "qb_spike", "air_yards"],
    contexts={
        "depth": {
            "BEHIND_LOS": _depth() == "BEHIND_LOS",
            "SHORT": _depth() == "SHORT",
            "INTERMEDIATE": _depth() == "INTERMEDIATE",
            "DEEP": _depth() == "DEEP",
        },
        "field": {"red_zone": pl.col("yardline_100") <= 20, "open_field": pl.col("yardline_100") > 20},
        "down": {"third_down": pl.col("down") == 3, "early_down": pl.col("down") <= 2},
        "distance": {
            "short_1_3": pl.col("ydstogo") <= 3,
            "medium_4_7": (pl.col("ydstogo") >= 4) & (pl.col("ydstogo") <= 7),
            "long_8_plus": pl.col("ydstogo") >= 8,
        },
        "clock": {"two_minute": pl.col("half_seconds_remaining") <= 120},
    },
    target_definition=(
        "Historical target counts by `receiver_player_id` per team-season, ranked into "
        "ROLE_1..ROLE_4 + ROLE_5_PLUS; the value is each role's share of team targets."
    ),
    eligible_population="§6.1 core + §6.5 REG, then `pass_attempt == 1`, `sack == 0`, `qb_spike == 0`, `receiver_player_id` present.",
)

if __name__ == "__main__":
    res = build_role_shares(SPEC)
    md = role_report(SPEC, res)
    o = {r["role"]: r for r in res["tidy"].filter(
        (pl.col("dimension") == "overall")).to_dicts()}
    print(f"M07 target roles: {res['events']:,} targets / {res['team_seasons']} team-seasons")
    print("  overall shrunk shares: " + " ".join(
        f"{r}={o[r]['shrunk_mean_share']:.3f}" for r in res["labels"]))
    print(f"  -> {md}")

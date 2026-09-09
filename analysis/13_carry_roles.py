"""Model 12 — Runner selection / designed-carry usage (spec §11 M12, §15).

PBP doesn't name the huddle personnel, so use a carry-share method analogous
to targets: rank rushers by designed-carry volume within each team-season into
ROLE_1..3 + ROLE_OTHER and learn the empirical carry-share per role, overall
and by situation (goal-to-go, short yardage, red zone, late-game lead).

`break_tackle` / `speed` never determine carry frequency in the engine —
ability controls outcomes, usage controls opportunities.

Run: analysis/.venv/Scripts/python analysis/13_carry_roles.py
"""

from __future__ import annotations

import lib_py  # thread-env setup; MUST precede numpy/polars

import polars as pl

from lib_py.roles import RoleSpec, build_role_shares, role_report

_i8 = lambda c: pl.col(c).cast(pl.Int8, strict=False).fill_null(0)


def _population(df: pl.DataFrame) -> pl.Expr:
    return (_i8("rush_attempt") == 1) & (_i8("qb_scramble") != 1) & (_i8("qb_kneel") != 1)


SPEC = RoleSpec(
    model_id="M12",
    name="Carry-role usage",
    id_col="rusher_player_id",
    n_named_roles=3,
    tail_label="OTHER",
    population=_population,
    extra_cols=["rush_attempt", "qb_scramble", "qb_kneel"],
    contexts={
        "goal_to_go": {"gtg": _i8("goal_to_go") == 1},
        "distance": {"short_1_2": pl.col("ydstogo") <= 2, "normal_3_plus": pl.col("ydstogo") >= 3},
        "field": {"red_zone": pl.col("yardline_100") <= 20, "open_field": pl.col("yardline_100") > 20},
        "game_state": {
            "late_lead": (pl.col("game_seconds_remaining") <= 600) & (pl.col("score_differential") > 0),
            "late_trail": (pl.col("game_seconds_remaining") <= 600) & (pl.col("score_differential") < 0),
        },
    },
    target_definition=(
        "Historical designed-carry counts by `rusher_player_id` per team-season, ranked into "
        "ROLE_1..ROLE_3 + ROLE_OTHER; the value is each role's share of team designed carries."
    ),
    eligible_population="§6.1 core + §6.5 REG, then `rush_attempt == 1`, `qb_scramble == 0`, `qb_kneel == 0`, `rusher_player_id` present.",
    min_team_season_events=120,
)

if __name__ == "__main__":
    res = build_role_shares(SPEC)
    md = role_report(SPEC, res)
    o = {r["role"]: r for r in res["tidy"].filter(pl.col("dimension") == "overall").to_dicts()}
    print(f"M12 carry roles: {res['events']:,} carries / {res['team_seasons']} team-seasons")
    print("  overall shrunk shares: " + " ".join(
        f"{r}={o[r]['shrunk_mean_share']:.3f}" for r in res["labels"]))
    print(f"  -> {md}")

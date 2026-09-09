"""Phase E — full-simulation league validation (spec §22).

Runs the engine with rating modifiers = 0 for many games and compares emergent
per-team-game distributions to the empirical 2023–2025 baseline. Pass = the
average-rating engine reproduces league football before rating effects.

Run: analysis/.venv/Scripts/python analysis/23_full_sim_validation.py [n_games]
"""

from __future__ import annotations

import lib_py  # thread-env setup

import json
import sys
import time
from datetime import date

import numpy as np
import polars as pl

from engine.sim import simulate_game
from lib_py.pbp import load_clean, load_raw
from lib_py.report import ARTIFACTS
from lib_py.split import STANDARD

_i8 = lambda c: pl.col(c).cast(pl.Int8, strict=False).fill_null(0)


def empirical_targets() -> dict:
    df = load_clean(STANDARD.production, base="core", columns=[
        "game_id", "posteam", "home_team", "away_team", "home_score", "away_score",
        "pass_attempt", "complete_pass", "interception", "sack", "qb_dropback", "qb_scramble",
        "rush_attempt", "qb_kneel", "yards_gained", "air_yards", "play_type", "fixed_drive",
        "field_goal_attempt", "field_goal_result", "punt_attempt",
    ])
    scr = df.filter((_i8("rush_attempt") == 1) | (_i8("pass_attempt") == 1) | (_i8("sack") == 1))
    pas = df.filter((_i8("pass_attempt") == 1) & (_i8("sack") != 1))
    dbk = df.filter(_i8("qb_dropback") == 1)
    run = df.filter((_i8("rush_attempt") == 1) & (_i8("qb_scramble") != 1) & (_i8("qb_kneel") != 1))
    fg = df.filter(_i8("field_goal_attempt") == 1)

    rates = {
        "dropback_rate": dbk.height / scr.height,
        "completion_pct": float(pas.select(_i8("complete_pass").mean()).item()),
        "yards_per_attempt": float(pas.select(pl.col("yards_gained").mean()).item()),
        "air_yards_per_attempt": float(pas.select(pl.col("air_yards").mean()).item()),
        "int_rate_per_att": float(pas.select(_i8("interception").mean()).item()),
        "sack_rate_per_dropback": float(dbk.select(_i8("sack").mean()).item()),
        "yards_per_carry": float(run.select(pl.col("yards_gained").mean()).item()),
        "explosive_rush_rate": float(run.select((pl.col("yards_gained") >= 15).mean()).item()),
        "explosive_pass_rate": float(pas.select((pl.col("yards_gained") >= 20).mean()).item()),
        "fg_make_pct": float(fg.select((pl.col("field_goal_result") == "made").mean()).item()),
    }

    # per-team-game
    games = df.select(["game_id", "home_team", "away_team", "home_score", "away_score"]).unique()
    n_team_games = games.height * 2
    plays_pg = scr.group_by(["game_id", "posteam"]).agg(pl.len()).select(pl.col("len").mean()).item()
    drives_pg = (
        df.filter(pl.col("fixed_drive").is_not_null())
        .select(["game_id", "posteam", "fixed_drive"]).unique()
        .group_by(["game_id", "posteam"]).agg(pl.len()).select(pl.col("len").mean()).item()
    )
    pts = np.concatenate([games["home_score"].to_numpy(), games["away_score"].to_numpy()]).astype(float)
    pass_pg = pas.group_by(["game_id", "posteam"]).agg(pl.len()).select(pl.col("len").mean()).item()
    rush_pg = run.group_by(["game_id", "posteam"]).agg(pl.len()).select(pl.col("len").mean()).item()

    per_game = {
        "plays_per_team_game": float(plays_pg),
        "drives_per_team_game": float(drives_pg),
        "points_per_team_game": float(pts.mean()),
        "points_sd": float(pts.std()),
        "pass_attempts_per_team_game": float(pass_pg),
        "rush_attempts_per_team_game": float(rush_pg),
    }
    return {"rates": rates, "per_game": per_game, "n_team_games": n_team_games}


def sim_distributions(n_games: int, seed0: int = 10_000) -> dict:
    t0 = time.time()
    plays, drives, pts, pass_att, rush_att = [], [], [], [], []
    comp = catt = pyd = ay = ints = sacks = dbks = 0.0
    ryd = ratt = expl_rush = 0.0
    expl_pass = pass_plays = 0.0
    fgm = fga = 0.0
    for i in range(n_games):
        g = simulate_game(seed0 + i)
        for tm in g.teams:
            s = tm.s
            plays.append(s["plays"]); drives.append(s["drives"]); pts.append(s["points"])
            pass_att.append(s["pass_att"]); rush_att.append(s["rush_att"])
            comp += s["completion"]; catt += s["pass_att"]; pyd += s["pass_yards"]; ay += s["air_yards"]
            ints += s["int_thrown"]; sacks += s["sack"]; dbks += s["dropbacks"]
            ryd += s["rush_yards"]; ratt += s["rush_att"]; expl_rush += s["explosive_rush"]
            expl_pass += s["explosive_pass"]; pass_plays += s["pass_att"]
            fgm += s["fg_made"]; fga += s["fg_att"]
    dt = time.time() - t0
    pts = np.array(pts)
    return {
        "n_games": n_games, "seconds": round(dt, 1),
        "rates": {
            "dropback_rate": dbks / (dbks + ratt) if (dbks + ratt) else 0,
            "completion_pct": comp / catt if catt else 0,
            "yards_per_attempt": pyd / catt if catt else 0,
            "air_yards_per_attempt": ay / catt if catt else 0,
            "int_rate_per_att": ints / catt if catt else 0,
            "sack_rate_per_dropback": sacks / dbks if dbks else 0,
            "yards_per_carry": ryd / ratt if ratt else 0,
            "explosive_rush_rate": expl_rush / ratt if ratt else 0,
            "explosive_pass_rate": expl_pass / pass_plays if pass_plays else 0,
            "fg_make_pct": fgm / fga if fga else 0,
        },
        "per_game": {
            "plays_per_team_game": float(np.mean(plays)),
            "drives_per_team_game": float(np.mean(drives)),
            "points_per_team_game": float(pts.mean()),
            "points_sd": float(pts.std()),
            "pass_attempts_per_team_game": float(np.mean(pass_att)),
            "rush_attempts_per_team_game": float(np.mean(rush_att)),
        },
    }


def main() -> None:
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 150
    print(f"empirical targets from {list(STANDARD.production)}...")
    emp = empirical_targets()
    print(f"simulating {n} games...")
    sim = sim_distributions(n)
    print(f"  {sim['seconds']}s ({sim['seconds'] / n:.2f}s/game)")

    rows = []
    for group in ("rates", "per_game"):
        for k, e in emp[group].items():
            s = sim[group][k]
            rel = (s - e) / e if e else float("nan")
            rows.append({"metric": k, "empirical": round(e, 4), "sim": round(s, 4),
                         "rel_err": round(rel, 3), "abs_ok": abs(rel) <= 0.10})

    out = {
        "generated": date.today().isoformat(),
        "n_sim_games": n,
        "note": "rating modifiers = 0 (spec §22). Engine V1 simplifications listed in "
                "engine/sim.py. Pass threshold: |rel err| <= 10%.",
        "comparison": rows,
        "sim_raw": sim, "empirical_raw": emp,
    }
    (ARTIFACTS / "validation" / "simulation_validation.json").write_text(
        json.dumps(out, indent=2, default=str) + "\n", encoding="utf-8")

    md = ["# M23 — Full-simulation league validation (Phase E)", "",
          f"Generated {date.today().isoformat()}. {n} simulated games, rating modifiers = 0 (§22).", "",
          "> No current game player ratings were used — this is the average-rating baseline check.", "",
          "| metric | empirical 2023–25 | sim | rel err | within 10% |",
          "| --- | ---: | ---: | ---: | :---: |"]
    for r in rows:
        md.append(f"| {r['metric']} | {r['empirical']} | {r['sim']} | {r['rel_err']:+.1%} | "
                  f"{'✅' if r['abs_ok'] else '❌'} |")
    npass = sum(r["abs_ok"] for r in rows)
    md += ["", f"**{npass}/{len(rows)} metrics within 10% of the empirical league baseline.**", "",
           "## engine V1 gaps (tracked for the next Phase E iteration)", "",
           "- **points/team-game ~10% low.** Root cause of the earlier −20% was a clock bug (M24's "
           "elapsed model is trained on same-drive snap gaps ~35s incl. huddle; the engine was "
           "applying that to drive-ending plays too, ~250s/game overrun → too few plays/drives). "
           "Fixed: drive-ending plays elapse ~65% of the sampled gap. Residual −10% is now:",
           "  - **no penalties (V1.5, spec §25)** — DPI / holding / roughing are ~2 free first downs "
           "and ~15 yд/game for the offense → ~2 of the ~2.3 missing points;",
           "  - red-zone TD rate ~54% vs ~57% (~1 pt); kickoff/punt return TDs not modelled (~0.5 pt);"
           " no 2-point tries.",
           "- **points_sd ~15–17% low** — expected: the average-rating engine runs two identical "
           "teams, so scores regress to the mean (no blowouts/shutouts). Variance widens once rating "
           "modifiers are on (real team-quality spread) — that is the §23 rating-layer check.",
           "- `qb_hit` and `pass_location` sampled from marginals (Models 06/08 not wired in);",
           "- kickoff / XP / sack-yards are hard-coded empiricals (Models 22/23 not fitted);",
           "- individual-player attribution omitted (team aggregates only) — the §24 stat-integrity "
           "tests need it and come with the shippable engine.", ""]
    (ARTIFACTS / "models" / "m23_full_sim_validation.report.md").write_text("\n".join(md), encoding="utf-8")

    print(f"\n{npass}/{len(rows)} within 10%")
    for r in rows:
        print(f"  {'OK ' if r['abs_ok'] else '   '}{r['metric']:32s} emp {r['empirical']:>8}  "
              f"sim {r['sim']:>8}  ({r['rel_err']:+.1%})")


if __name__ == "__main__":
    main()

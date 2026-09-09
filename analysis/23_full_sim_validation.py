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
        "field_goal_attempt", "field_goal_result", "punt_attempt", "fixed_drive_result",
        "yardline_100",
    ])
    scr = df.filter((_i8("rush_attempt") == 1) | (_i8("pass_attempt") == 1) | (_i8("sack") == 1))
    pas = df.filter((_i8("pass_attempt") == 1) & (_i8("sack") != 1))
    dbk = df.filter(_i8("qb_dropback") == 1)
    run = df.filter((_i8("rush_attempt") == 1) & (_i8("qb_scramble") != 1) & (_i8("qb_kneel") != 1))
    fg = df.filter(_i8("field_goal_attempt") == 1)

    # red-zone finishing: drives that reach the 20 → offensive TD share.
    rzdrv = (
        df.filter(pl.col("fixed_drive").is_not_null() & pl.col("posteam").is_not_null())
        .group_by(["game_id", "posteam", "fixed_drive"])
        .agg(pl.col("yardline_100").min().alias("min_yl"),
             pl.col("fixed_drive_result").first().alias("res"))
        .filter(pl.col("min_yl") <= 20)
    )
    rz_td_rate = float(rzdrv.select((pl.col("res") == "Touchdown").mean()).item())

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
        "rz_td_rate": rz_td_rate,
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

    # penalties: the RAW stream (load_clean drops penalty / no_play rows).
    praw = load_raw(STANDARD.production, columns=[
        "game_id", "season_type", "play_deleted", "aborted_play", "penalty",
        "penalty_yards", "penalty_type",
    ]).filter(
        (_i8("play_deleted") != 1) & (_i8("aborted_play") != 1)
        & (pl.col("season_type") == "REG") & (_i8("penalty") == 1)
    )
    n_games_emp = games.height
    pen_pg = praw.height / (n_games_emp * 2)
    penyd_pg = float(praw.select(pl.col("penalty_yards").sum()).item()) / (n_games_emp * 2)
    dpi_pg = praw.filter(pl.col("penalty_type") == "Defensive Pass Interference").height / (n_games_emp * 2)

    per_game = {
        "plays_per_team_game": float(plays_pg),
        "drives_per_team_game": float(drives_pg),
        "points_per_team_game": float(pts.mean()),
        "points_sd": float(pts.std()),
        "pass_attempts_per_team_game": float(pass_pg),
        "rush_attempts_per_team_game": float(rush_pg),
        "penalties_per_team_game": float(pen_pg),
        "penalty_yards_per_team_game": float(penyd_pg),
        "dpi_per_team_game": float(dpi_pg),
    }
    return {"rates": rates, "per_game": per_game, "n_team_games": n_team_games}


def sim_distributions(n_games: int, seed0: int = 10_000) -> dict:
    t0 = time.time()
    plays, drives, pts, pass_att, rush_att = [], [], [], [], []
    pen, pen_yd, dpi = [], [], []
    comp = catt = pyd = ay = ints = sacks = dbks = 0.0
    ryd = ratt = expl_rush = 0.0
    expl_pass = pass_plays = 0.0
    fgm = fga = 0.0
    rztrip = rztd = 0.0
    for i in range(n_games):
        g = simulate_game(seed0 + i)
        for tm in g.teams:
            s = tm.s
            plays.append(s["plays"]); drives.append(s["drives"]); pts.append(s["points"])
            pass_att.append(s["pass_att"]); rush_att.append(s["rush_att"])
            pen.append(s["penalty"]); pen_yd.append(s["penalty_yards"]); dpi.append(s["dpi"])
            comp += s["completion"]; catt += s["pass_att"]; pyd += s["pass_yards"]; ay += s["air_yards"]
            ints += s["int_thrown"]; sacks += s["sack"]; dbks += s["dropbacks"]
            ryd += s["rush_yards"]; ratt += s["rush_att"]; expl_rush += s["explosive_rush"]
            expl_pass += s["explosive_pass"]; pass_plays += s["pass_att"]
            fgm += s["fg_made"]; fga += s["fg_att"]
            rztrip += s["rz_trip"]; rztd += s["rz_td"]
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
            "rz_td_rate": rztd / rztrip if rztrip else 0,
        },
        "per_game": {
            "plays_per_team_game": float(np.mean(plays)),
            "drives_per_team_game": float(np.mean(drives)),
            "points_per_team_game": float(pts.mean()),
            "points_sd": float(pts.std()),
            "pass_attempts_per_team_game": float(np.mean(pass_att)),
            "rush_attempts_per_team_game": float(np.mean(rush_att)),
            "penalties_per_team_game": float(np.mean(pen)),
            "penalty_yards_per_team_game": float(np.mean(pen_yd)),
            "dpi_per_team_game": float(np.mean(dpi)),
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
    core = [r for r in rows if r["metric"] not in
            ("penalties_per_team_game", "penalty_yards_per_team_game", "dpi_per_team_game")]
    ncore = sum(r["abs_ok"] for r in core)
    md += ["", f"**{npass}/{len(rows)} metrics within 10%** ({ncore}/{len(core)} of the core "
           "football metrics; the three penalty-volume metrics are the Model 25 V1.5 check).", "",
           "## engine V1 gaps (tracked for the next Phase E iteration)", "",
           "- **penalties/team-game & penalty yд run ~15–20% low.** M25a/M25b are per-raw-stream-"
           "row hazards; the engine's scrimmage-snap population is smaller, and the deterministic "
           "accept/decline trims more. `PENALTY_HAZARD_SCALE` is left at 1.0 on purpose — scaling "
           "it to hit the empirical count pushes points from −10% to −16%, because the physical-"
           "outcome resolvers are fit penalty-FREE (§6.2) and this engine's drive model over-"
           "punishes offensive fouls. Reconciling the two needs gained-conditioned hazards (V1.6).",
           "- **points/team-game ~11% low, diffuse, and NOT the passing game.** The pass "
           "distribution is now calibrated by depth (`QB_HIT_BY_DEPTH` + `M09_COMPLETE_CALIB`): "
           "completion / YPA / air-yд / explosive-pass all within ~6%. That fix *raised* the "
           "points miss from −10% to −11% — M09 was over-completing deep balls, and those "
           "phantom explosives were masking ~1.7 pts of a scoring deficit elsewhere. RZ TD rate "
           "matches (0.53 v 0.56); return TDs and the 0.958 PAT are wired. The engine runs *more* "
           "plays/team-game (67 v 62) yet scores ~1.8/drive v ~2.1 — drives sustain but convert "
           "less. Open candidates: FG-range vs go decisions, mid-field (20–40) yardage, "
           "clock/possession count. No 2-point tries (EV-neutral).",
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

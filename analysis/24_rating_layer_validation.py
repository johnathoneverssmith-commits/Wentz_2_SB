"""Phase E — rating-layer validation (spec §23).

1. Invariants: vary ONE rating family (p90 vs p10 synthetic players), everyone
   else average, and confirm the direction (higher QB accuracy never lowers
   completion %, higher coverage never raises opponent completion %, ...).
2. Magnitude: the p90-vs-p10 performance spread should be near the historical
   p10<->p90 residual span (artifacts/validation/residual_variance_targets.json).
3. League with modifiers on: real 32-team round-robin sample — league averages
   must still match the empirical baseline (centering, §12), score variance
   should widen toward empirical, and roster quality should predict wins.

Run: analysis/.venv/Scripts/python analysis/24_rating_layer_validation.py [n]
"""

from __future__ import annotations

import lib_py  # thread-env

import json
import sys
from datetime import date

import numpy as np

from engine.roster import Roster, team_list
from engine.sim import Game
from lib_py.report import ARTIFACTS

REF = json.loads((ARTIFACTS / "ratings" / "attribute_reference_stats.json").read_text())["attribute_reference_stats"]
RESID = json.loads((ARTIFACTS / "validation" / "residual_variance_targets.json").read_text())["units"]
COEF = json.loads((ARTIFACTS / "ratings" / "rating_effect_coefficients.json").read_text())["families"]

GEN = ["speed", "acceleration", "strength", "agility", "awareness", "injury", "stamina", "toughness", "jumping"]
POS_ATTRS = {
    "QB": ["throw_power", "throw_accuracy_short", "throw_accuracy_mid", "throw_accuracy_deep", "play_action", "break_sack", "scrambling", "clutch"],
    "RB": ["carrying", "break_tackle", "ball_carrier_vision", "juke_move", "stiff_arm", "spin_move", "catching", "pass_block", "yac"],
    "WR": ["catching", "route_running_short", "route_running_mid", "route_running_deep", "release", "catch_in_traffic", "spectacular_catch", "break_tackle", "yac"],
    "TE": ["catching", "route_running_short", "route_running_mid", "route_running_deep", "run_block", "pass_block", "catch_in_traffic", "spectacular_catch", "break_tackle", "yac"],
    "OT": ["pass_block", "run_block", "pass_block_power", "pass_block_finesse", "anchor", "line_calls"],
    "OG": ["pass_block", "run_block", "pass_block_power", "pass_block_finesse", "anchor", "line_calls"],
    "C": ["pass_block", "run_block", "pass_block_power", "pass_block_finesse", "snap_accuracy", "line_calls", "anchor"],
    "EDGE": ["power_moves", "finesse_moves", "block_shedding", "pursuit", "tackle", "run_defense", "hit_power", "play_recognition"],
    "DT": ["power_moves", "finesse_moves", "block_shedding", "pursuit", "tackle", "run_defense", "hit_power", "play_recognition"],
    "ILB": ["tackle", "block_shedding", "pursuit", "play_recognition", "zone_coverage", "man_coverage", "hit_power", "blitz"],
    "OLB": ["tackle", "block_shedding", "pursuit", "play_recognition", "zone_coverage", "man_coverage", "hit_power", "blitz"],
    "CB": ["man_coverage", "zone_coverage", "press", "play_recognition", "pursuit", "tackle"],
    "S": ["zone_coverage", "man_coverage", "tackle", "play_recognition", "pursuit", "hit_power"],
    "K": ["kick_power", "kick_accuracy", "clutch"],
    "P": ["punt_power", "punt_accuracy", "hang_time", "coffin_corner"],
}
DEPTH = {"QB": 3, "RB": 4, "WR": 6, "TE": 4, "OT": 4, "OG": 4, "C": 3, "EDGE": 5, "DT": 5,
         "ILB": 5, "OLB": 2, "CB": 6, "S": 5, "K": 2, "P": 2}
FAMILY_POS = {
    "qb_accuracy": ["QB"], "qb_ball_security": ["QB"],
    "receiver_hands_routes": ["WR", "TE"], "yac_ballcarrier": ["WR", "TE"],
    "coverage": ["CB", "S", "ILB"], "open_field_tackling": ["CB", "S", "ILB"],
    "protection": ["OT", "OG", "C"],
    "pass_rush": ["EDGE", "DT"], "run_defense_front7": ["EDGE", "DT", "ILB"],
    "runner": ["RB"], "kicking": ["K"],
}
Z90 = 1.282


def _avg_attrs(pos: str) -> dict:
    return {a: round(REF[a]["mean"]) for a in GEN + POS_ATTRS[pos] if a in REF}


def synth_roster(team: str, family: str | None = None, direction: int = 0) -> Roster:
    players = []
    shift_attrs = set()
    if family:
        shift_attrs = {a["attribute"] for a in COEF[family]["attributes"]}
    fam_pos = set(FAMILY_POS.get(family, [])) if family else set()
    pid = 0
    for pos, n in DEPTH.items():
        for _ in range(n):
            pid += 1
            at = _avg_attrs(pos)
            if pos in fam_pos:
                for a in shift_attrs:
                    if a in REF and REF[a]["sd"] == REF[a]["sd"]:  # not NaN
                        at[a] = int(round(REF[a]["mean"] + direction * Z90 * REF[a]["sd"]))
            players.append({"id": f"{team}_{pid}", "name": f"{team} {pos}{pid}",
                            "position": pos, "nfl_team": team, "overall": 70, "attributes": at})
    return Roster(team, players)


def _game_stats(g: Game) -> dict:
    a, b = g.teams[0].s, g.teams[1].s
    return {
        "home_comp_pct": a["completion"] / max(a["pass_att"], 1),
        "away_comp_pct": b["completion"] / max(b["pass_att"], 1),
        "home_sack_rate": a["sack"] / max(a["dropbacks"], 1),
        "away_sack_rate": b["sack"] / max(b["dropbacks"], 1),
        "home_ypc": a["rush_yards"] / max(a["rush_att"], 1),
        "away_ypc": b["rush_yards"] / max(b["rush_att"], 1),
        "home_fg_pct": a["fg_made"] / max(a["fg_att"], 1),
        "home_pts": a["points"], "away_pts": b["points"],
    }


def _run(n, home_r, away_r, seed0=50_000):
    out = []
    for i in range(n):
        g = Game(rng=np.random.default_rng(seed0 + i), rosters=[home_r, away_r]).run()
        out.append(_game_stats(g))
    return out


def invariants(n: int) -> list[dict]:
    base = synth_roster("AVG")
    checks = [
        ("qb_accuracy", "home", +1, "home_comp_pct", ">", "higher QB accuracy raises completion %", "m09_qb_completion"),
        ("coverage", "away", +1, "home_comp_pct", "<", "higher coverage lowers opponent completion %", "m09_def_completion"),
        ("protection", "home", +1, "home_sack_rate", "<", "higher pass blocking lowers sack rate", "m04_offense_sack"),
        ("pass_rush", "away", +1, "home_sack_rate", ">", "higher pass rush raises sack rate", "m04_defense_sack"),
        ("runner", "home", +1, "home_ypc", ">", "higher runner ratings raise YPC", "m14_rusher_yards"),
        ("run_defense_front7", "away", +1, "home_ypc", "<", "higher run defense lowers opponent YPC", "m14_defense_rush_yards"),
        ("kicking", "home", +1, "home_fg_pct", ">", "higher kick accuracy raises make %", "m20_kicker_make"),
    ]
    rows = []
    for fam, side, _, metric, op, desc, resid_key in checks:
        hi_h = synth_roster("HI", fam, +1) if side == "home" else base
        hi_a = synth_roster("HI", fam, +1) if side == "away" else base
        lo_h = synth_roster("LO", fam, -1) if side == "home" else base
        lo_a = synth_roster("LO", fam, -1) if side == "away" else base
        hi = np.mean([s[metric] for s in _run(n, hi_h, hi_a)])
        lo = np.mean([s[metric] for s in _run(n, lo_h, lo_a, seed0=60_000)])
        spread = hi - lo
        direction_ok = (spread > 0) if op == ">" else (spread < 0)
        resid_span = abs(RESID[resid_key]["shrunk_p10_to_p90"])
        rows.append({
            "family": fam, "check": desc,
            "p90_metric": round(float(hi), 4), "p10_metric": round(float(lo), 4),
            "p90_minus_p10": round(float(spread), 4),
            "direction_ok": bool(direction_ok),
            "historical_p10_to_p90": round(resid_span, 4),
            "magnitude_ratio": round(abs(spread) / resid_span, 2) if resid_span else None,
        })
    return rows


def league(n_pairs: int = 60) -> dict:
    teams = team_list()
    rng = np.random.default_rng(7)
    pairs = [(teams[i], teams[j]) for i in range(len(teams)) for j in range(len(teams)) if i != j]
    rng.shuffle(pairs)
    pairs = pairs[:n_pairs]
    from engine.roster import roster
    comp_n = comp_d = ypa_n = ypa_d = sack_n = sack_d = ypc_n = ypc_d = 0.0
    pts = []
    hi_wins = games = 0
    from engine.ratings import _ref  # noqa
    for h, a in pairs:
        rh, ra = roster(h), roster(a)
        for k in range(2):
            g = Game(rng=np.random.default_rng(hash((h, a, k)) % (2**32)), rosters=[rh, ra]).run()
            A, B = g.teams[0].s, g.teams[1].s
            for T in (A, B):
                comp_n += T["completion"]; comp_d += T["pass_att"]
                ypa_n += T["pass_yards"]; ypa_d += T["pass_att"]
                sack_n += T["sack"]; sack_d += T["dropbacks"]
                ypc_n += T["rush_yards"]; ypc_d += T["rush_att"]
            pts += [A["points"], B["points"]]
            oh = sum(p["overall"] for p in rh.offense().values() if p) + sum(p["overall"] for p in rh.defense().values() if p)
            oa = sum(p["overall"] for p in ra.offense().values() if p) + sum(p["overall"] for p in ra.defense().values() if p)
            if oh != oa:
                games += 1
                if (g.score[0] > g.score[1]) == (oh > oa):
                    hi_wins += 1
    pts = np.array(pts)
    return {
        "pairs": len(pairs), "team_games": len(pts),
        "completion_pct": comp_n / comp_d, "yards_per_attempt": ypa_n / ypa_d,
        "sack_rate": sack_n / sack_d, "yards_per_carry": ypc_n / ypc_d,
        "points_mean": float(pts.mean()), "points_sd": float(pts.std()),
        "better_roster_win_rate": hi_wins / games if games else None,
    }


def main() -> None:
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 40
    print("1. invariants (synthetic p90 vs p10)...")
    inv = invariants(n)
    print("2. league with modifiers on...")
    lg = league(n_pairs=24)

    emp = {"completion_pct": 0.647, "yards_per_attempt": 7.057, "sack_rate": 0.0663,
           "yards_per_carry": 4.276, "points_mean": 22.564, "points_sd": 9.927}

    out = {"generated": date.today().isoformat(), "n_sims_per_cell": n,
           "invariants": inv, "league_modifiers_on": lg,
           "league_vs_empirical": {k: {"sim": round(lg[k], 4), "emp": emp[k],
                                       "rel_err": round((lg[k] - emp[k]) / emp[k], 3)} for k in emp}}
    (ARTIFACTS / "validation" / "rating_layer_validation.json").write_text(
        json.dumps(out, indent=2, default=str) + "\n", encoding="utf-8")

    md = ["# M24b — Rating-layer validation (Phase E, §23)", "",
          f"Generated {date.today().isoformat()}. {n} sims per synthetic cell; "
          f"{lg['pairs']} real matchups ×2 for the league check.", "",
          "## 1. invariants — synthetic p90 vs p10, everyone else average", "",
          "| family | check | p10 | p90 | Δ (p90−p10) | dir ok | historical p10↔p90 | ratio |",
          "| --- | --- | ---: | ---: | ---: | :---: | ---: | ---: |"]
    for r in inv:
        md.append(f"| {r['family']} | {r['check']} | {r['p10_metric']} | {r['p90_metric']} | "
                  f"{r['p90_minus_p10']:+.4f} | {'✅' if r['direction_ok'] else '❌'} | "
                  f"{r['historical_p10_to_p90']} | {r['magnitude_ratio']} |")
    npass = sum(r["direction_ok"] for r in inv)
    md += ["", f"**{npass}/{len(inv)} monotonicity invariants hold.** "
           "`ratio` ≈ 1 means the synthetic elite-vs-poor spread matches the historical residual span.",
           "", "## 2. league averages with modifiers on (centering check, §12)", "",
           "| metric | sim | empirical | rel err |", "| --- | ---: | ---: | ---: |"]
    for k, v in out["league_vs_empirical"].items():
        md.append(f"| {k} | {v['sim']} | {v['emp']} | {v['rel_err']:+.1%} |")
    md += ["", f"better-roster win rate: **{lg['better_roster_win_rate']:.1%}** "
           f"(50% = ratings do nothing; NFL favourites win ~66–70%).",
           f"  \npoints sd: **{lg['points_sd']:.2f}** vs empirical 9.93 "
           f"(vs {8.5:.1f} with modifiers off — variance should widen).", ""]
    (ARTIFACTS / "models" / "m24b_rating_layer_validation.report.md").write_text("\n".join(md), encoding="utf-8")

    print(f"\ninvariants: {npass}/{len(inv)} directions OK")
    for r in inv:
        print(f"  {'OK ' if r['direction_ok'] else '!! '}{r['family']:22s} Δ={r['p90_minus_p10']:+.4f} "
              f"hist={r['historical_p10_to_p90']:.4f} ratio={r['magnitude_ratio']}")
    print(f"\nleague (modifiers on): comp {lg['completion_pct']:.3f} ypa {lg['yards_per_attempt']:.2f} "
          f"sack {lg['sack_rate']:.4f} ypc {lg['yards_per_carry']:.2f}")
    print(f"  points {lg['points_mean']:.1f} sd {lg['points_sd']:.2f}  "
          f"better-roster win rate {lg['better_roster_win_rate']:.1%}")


if __name__ == "__main__":
    main()

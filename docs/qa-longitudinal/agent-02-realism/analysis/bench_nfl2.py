"""Extra NFL player-season benchmarks (nflverse player_stats 2018-2024, reg season) -> data/nfl_benchmarks2.json"""
import json, os
import numpy as np, pandas as pd
D = os.environ.get("NFLV_DIR", "/tmp/nflv")
PS = pd.concat([pd.read_csv(f"{D}/ps_{y}.csv") for y in range(2018, 2025)]); PS = PS[PS.season_type == "REG"]
o = {}
rb = PS[PS.position == "RB"]
o["RB_300carry_per_season"] = float((rb.carries >= 300).sum() / 7); o["RB_1000yd_per_season"] = float((rb.rushing_yards >= 1000).sum() / 7)
o["RB_rush_td_max_by_season"] = {int(s): float(v) for s, v in rb.groupby("season").rushing_tds.max().items()}
o["RB_10plus_rush_td_per_season"] = float((rb.rushing_tds >= 10).sum() / 7)
r = PS[(PS.position == "RB") & (PS.carries >= 100)]; o["RB_ypc_100car"] = float(r.rushing_yards.sum() / r.carries.sum())
q = PS[(PS.position == "QB") & (PS.attempts >= 200)]
o["QB_rush_td_mean"] = float(q.rushing_tds.mean()); o["QB_carries_mean_per_season"] = float(q.carries.mean()); o["QB_rush_yds_mean_per_season"] = float(q.rushing_yards.mean())
o["QB_pass_td_mean_per_season"] = float(q.passing_tds.mean()); o["QB_pass_int_mean"] = float(q.passing_interceptions.mean())
o["QB_td_max_by_season"] = {int(s): float(v) for s, v in PS[PS.position == "QB"].groupby("season").passing_tds.max().items()}
o["QB_30td_per_season"] = float((PS[PS.position == "QB"].passing_tds >= 30).sum() / 7)
# team shares of receiving yards
rec = PS[PS.position.isin(["WR", "TE", "RB"])].groupby("position").receiving_yards.sum(); o["rec_yds_share"] = {k: float(v / rec.sum()) for k, v in rec.items()}
tg = PS[PS.position.isin(["WR", "TE", "RB"])].groupby("position").targets.sum(); o["target_share"] = {k: float(v / tg.sum()) for k, v in tg.items()}
# total passing TD vs rushing TD per team-game (players' sums: team-game = 32*17*~... use sum over seasons / (32*17*n))
for yrs, g in ((range(2021, 2025), 17),):
    s = PS[PS.season.isin(list(yrs))]
    tgm = 32 * g * len(list(yrs))
    o["pass_td_per_team_game"] = float(s.passing_tds.sum() / tgm); o["rush_td_per_team_game"] = float(s.rushing_tds.sum() / tgm); o["rec_td_per_team_game"] = float(s.receiving_tds.sum() / tgm)
    o["sacks_taken_per_team_game"] = float(s.sacks_suffered.sum() / tgm)
# sacks by position group of the defender
d = PS[PS.position_group.isin(["DL", "LB", "DB"])]
sh = d.groupby("position_group").def_sacks.sum(); o["def_sack_share_by_group"] = {k: float(v / sh.sum()) for k, v in sh.items()}
o["def_sacks_per_team_game_credited"] = float(d.def_sacks.sum() / (32 * 17 * 7 * 1.0) )
tk = d.assign(tk=d.def_tackles_solo + d.def_tackle_assists)
o["tackles_top10_mean_by_season"] = {int(s): float(x.tk.nlargest(10).mean()) for s, x in tk.groupby("season")}
o["tackles_leader_by_season"] = {int(s): float(x.tk.max()) for s, x in tk.groupby("season")}
o["tackles_per_team_game_credited"] = float(tk.tk.sum() / (32 * 17 * 7))
for pg in ("DL", "LB", "DB"):
    x = d[d.position_group == pg]; o[f"{pg}_sacks_mean_per_player_gt8games"] = float(x[x.games >= 8].def_sacks.mean()); o[f"{pg}_int_mean_per_player_gt8games"] = float(x[x.games >= 8].def_interceptions.mean())
for pos in ("CB", "S", "OLB", "ILB", "MLB", "LB", "DE", "DT", "EDGE"):
    x = d[(d.position == pos) & (d.games >= 12)]
    if len(x): o[f"{pos}_n"] = int(len(x)); o[f"{pos}_sacks_mean"] = float(x.def_sacks.mean()); o[f"{pos}_int_mean"] = float(x.def_interceptions.mean()); o[f"{pos}_tackles_mean"] = float((x.def_tackles_solo + x.def_tackle_assists).mean())
o["def_fumbles_forced_leader_by_season"] = {int(s): float(x.def_fumbles_forced.max()) for s, x in d.groupby("season")}
# individual extreme: WR rec td max, 
w = PS[PS.position.isin(["WR", "TE"])]; o["rec_td_max_by_season"] = {int(s): float(x.receiving_tds.max()) for s, x in w.groupby("season")}
o["rec_max_by_season"] = {int(s): float(x.receptions.max()) for s, x in PS[PS.position.isin(["WR", "TE", "RB"])].groupby("season")}
o["pass_yards_per_team_game"] = float(PS[PS.season >= 2021].passing_yards.sum() / (32 * 17 * 4)); o["rush_yards_per_team_game"] = float(PS[PS.season >= 2021].rushing_yards.sum() / (32 * 17 * 4))
json.dump(o, open("data/nfl_benchmarks2.json", "w"), indent=1); print(json.dumps(o, indent=1))
